// One-time secret viewer: `https://onepeek.io/s/<id>#<key>` (Universal Link / App Link),
// `onepeek://s/<id>#<key>`, a secret link tapped in a conversation, or one read by the QR scanner.
// Mirrors the website's app/s/[id]/page.tsx: peek first (never burns), then open on a tap, then
// reveal with the sender's options (hold-to-view with a watermark, viewer timer, copy and save
// switches). The key lives in the link's #fragment: it is read from the full launch URL or the
// in-memory hand-off (lib/links), never from route params, and goes only into lib/secrets.
// Decrypted content lives in component state only: it is dropped when the app goes inactive, when
// the screen loses focus, when the timer runs out and on unmount; an image temp file is deleted
// with it. Once the peek has resolved (the key is imported), the launch URL is forgotten
// (`forgetLinkingURL`, P2-2) so the key does not stay in the native initial-URL cache or the Android
// Intent for the life of the process. A recipient-locked secret runs the web's email-code flow
// through lib/secrets (requestUnlockCode / verifyUnlockCode, C4); only the id, the address and the
// code go to the core. Geofenced secrets need a location the app does not read (no expo-location):
// the website instead, through "Open in browser" (P2-8: a Custom Tab on Android, where the system
// browser would resolve the verified App Link straight back into this app; Safari on iOS). The
// sentence under that button says that the link, key included, is handed to the browser. Nothing
// here logs.
import * as Clipboard from 'expo-clipboard';
import { useLinkingURL } from 'expo-linking';
import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { wifiQrPayload } from '@onepeek/core';
import { forgetLinkingURL, useSecureScreen, Watermark } from '@/security';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Header } from '../../components/Header';
import { Icon } from '../../components/Icon';
import { Notice, Toast } from '../../components/Notice';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { colors, radii, spacing, touchTarget } from '../../theme';
import { DATA_URI_LIMIT, dataUri, deleteTemp, extensionOf, fileSize, shareBytes, writeTemp } from '@/lib/files';
import { errorCode, friendlyError } from '@/lib/format';
import { secretLinkFrom, takeHandoff } from '@/lib/links';
import { openSecretLink, peekSecretLink, requestUnlockCode, verifyUnlockCode, type OpenedSecret, type SecretPeek } from '@/lib/secrets';

const WEBSITE_ONLY = ' Open the link in a browser on onepeek.io instead.';
/** Under "Open in browser": the honest consequence of the fallback (the web viewer strips the fragment afterwards, but the browser saw it). */
const BROWSER_NOTE = 'Opens in your browser. The full link, key included, is handed to the browser and will be in its history.';
const KEPT = ' Nothing has been opened or deleted.';

type Phase = 'loading' | 'ready' | 'opening' | 'revealed' | 'vanished' | 'cleared' | 'error';

const INCOMPLETE = 'This link is incomplete. Ask the sender to share the full link.';

/** The web's wording for a peek or open failure (SecretError codes); unknown codes fall back to the generic line. */
function secretError(e: unknown): string {
  const code = errorCode(e);
  if (code === 'gone' || code === 'secret_gone' || code === 'not_found') return friendlyError('secret_gone');
  if (code === 'bad_key' || code === 'decrypt_failed') return friendlyError('bad_key');
  if (code === 'network' || code === 'offline') return `We couldn’t reach OnePeek. Check your connection and try again.${KEPT}`;
  if (code.startsWith('geofence_')) return `This secret only opens inside an area set by the sender, which needs a location check the app doesn’t do.${WEBSITE_ONLY}${KEPT}`;
  if (code === 'timelock_until' || code === 'timelock_window' || code.startsWith('timelock_')) return `This secret can’t be opened yet. Try again later.${KEPT}`;
  if (code === 'country_blocked') return `This secret can’t be opened from where you are. If you’re using a VPN, turn it off and try again.${KEPT}`;
  if (code === 'recipient_locked') return `Confirm your email with a new code first.${KEPT}`;
  if (code === 'feature_unavailable') return `This secret uses a protection the app can’t check yet.${WEBSITE_ONLY}${KEPT}`;
  if (code === 'open_failed') return `We couldn’t open this secret right now.${KEPT} Please try again in a moment.`;
  return friendlyError(code);
}

/** Open errors after which the secret is still there (the server refused before burning). */
function keepsReady(code: string): boolean {
  return code === 'network' || code === 'offline' || code === 'open_failed' || code === 'recipient_locked' || code === 'country_blocked' || code === 'feature_unavailable' || code.startsWith('geofence_') || code.startsWith('timelock_');
}

function notYetText(v: string): string {
  const at = Date.parse(v);
  return Number.isFinite(at) ? `It unlocks ${new Date(at).toLocaleString()}.` : v;
}

export default function SecretViewerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const secretId = String(id ?? '');
  const router = useRouter();
  const linkingUrl = useLinkingURL();
  useSecureScreen(`secret:${secretId}`);

  // The full link: the URL the app was opened with (if it is this secret), else the hand-off from
  // a bubble, the scanner or the share target. Either way it stays in this component's state.
  const [url, setUrl] = useState<string | null>(() => {
    const fromLaunch = secretLinkFrom(linkingUrl);
    if (fromLaunch && fromLaunch.id === secretId) return fromLaunch.url;
    const handed = takeHandoff('secret');
    const parsed = secretLinkFrom(handed);
    return parsed && parsed.id === secretId ? parsed.url : null;
  });
  const [phase, setPhase] = useState<Phase>(url ? 'loading' : 'error');
  const [err, setErr] = useState(url ? '' : INCOMPLETE);
  // A launch URL that arrives after the first render (state adjusted during render, the React pattern).
  const [lastLinking, setLastLinking] = useState(linkingUrl);
  if (linkingUrl !== lastLinking) {
    setLastLinking(linkingUrl);
    const s = secretLinkFrom(linkingUrl);
    if (!url && s && s.id === secretId) { setUrl(s.url); setErr(''); setPhase('loading'); }
  }
  const [peek, setPeek] = useState<SecretPeek | null>(null);
  const [opened, setOpened] = useState<OpenedSecret | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const temp = useRef<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [held, setHeld] = useState(false);
  const [toast, setToast] = useState('');
  const [sharing, setSharing] = useState(false);
  const [viewerPlace, setViewerPlace] = useState('');
  // Recipient lock (the web's lock-step): address → 6-digit code → unlock token for open.
  const [lockEmail, setLockEmail] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [lockCode, setLockCode] = useState('');
  const [lockBusy, setLockBusy] = useState(false);
  const [lockMsg, setLockMsg] = useState('');
  const [unlockToken, setUnlockToken] = useState('');

  // Peek: what the viewer learns before opening (type, size, views, locks). Never the content. Once
  // it has resolved the key has been imported, so the launch URL that carried it is forgotten (P2-2);
  // the link itself stays in this component's state for the open.
  useEffect(() => {
    if (!url) return;
    let alive = true;
    peekSecretLink(url)
      .then((p) => { forgetLinkingURL(); if (alive) { setPeek(p); setPhase('ready'); } })
      .catch((e) => { if (alive) { setErr(secretError(e)); setPhase('error'); } });
    return () => { alive = false; };
  }, [url]);

  /** Drops every decrypted byte from state and disk. `why` picks the state shown afterwards. */
  const clear = useCallback((why: 'vanished' | 'cleared') => {
    if (temp.current) { deleteTemp(temp.current); temp.current = null; }
    setOpened(null); setImageUri(null); setHeld(false); setRemaining(0);
    setPhase((p) => (p === 'revealed' ? why : p));
  }, []);

  // Leaving the foreground (app switcher, a call), losing focus or unmounting clears the secret.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s !== 'active') clear('cleared'); });
    return () => sub.remove();
  }, [clear]);
  useFocusEffect(useCallback(() => () => clear('cleared'), [clear]));
  useEffect(() => () => { if (temp.current) deleteTemp(temp.current); }, []);

  // Viewer timer: count down, then vanish.
  const timer = peek?.header.timer ?? 0;
  useEffect(() => {
    if (phase !== 'revealed' || timer <= 0) return;
    const t = setTimeout(() => { if (remaining <= 1) clear('vanished'); else setRemaining(remaining - 1); }, 1000);
    return () => clearTimeout(t);
  }, [phase, timer, remaining, clear]);

  async function sendCode() {
    if (!url) return;
    const address = lockEmail.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) { setLockMsg('Enter your email address.'); return; }
    setLockBusy(true); setLockMsg('');
    try {
      await requestUnlockCode(url, address);
      setCodeSent(true);
      setLockMsg('If that’s the address the sender chose, a 6-digit code is on its way. Check your inbox and spam folder.');
    } catch (e) {
      const code = errorCode(e);
      if (code === 'wait') setLockMsg('Please wait 30 seconds before asking for another code.');
      else if (code === 'too_many') setLockMsg('Too many codes were requested for this secret. Ask the sender for a new link.');
      else if (code === 'not_configured' || code === 'feature_unavailable') setLockMsg('Email codes aren’t available right now. Please try again later.');
      else if (code === 'gone') { setErr(friendlyError('secret_gone')); setPhase('error'); }
      else setLockMsg('We couldn’t send a code. Check your connection and try again.');
    } finally { setLockBusy(false); }
  }

  async function verifyCode() {
    if (!url || lockCode.length !== 6) return;
    setLockBusy(true); setLockMsg('');
    try {
      // The one-use unlock token (a string, as the core returns it): kept in state for open() only.
      setUnlockToken(await verifyUnlockCode(url, lockCode));
    } catch (e) {
      const code = errorCode(e);
      if (code === 'wrong_code') setLockMsg('That code isn’t right. Try again.');
      else if (code === 'too_many') { setLockMsg('Too many wrong codes. Ask for a new code.'); setCodeSent(false); setLockCode(''); }
      else if (code === 'expired') { setLockMsg('That code has expired. Ask for a new one.'); setCodeSent(false); setLockCode(''); }
      else setLockMsg('We couldn’t check the code. Check your connection and try again.');
    } finally { setLockBusy(false); }
  }

  const needsCode = !!peek?.locked && !unlockToken;

  async function open() {
    if (!url || phase !== 'ready' || !peek || needsCode || peek.notYet) return;
    setPhase('opening'); setErr('');
    try {
      const got = unlockToken ? await openSecretLink(url, { email: lockEmail.trim(), token: unlockToken }) : await openSecretLink(url);
      setViewerPlace((got as { viewerPlace?: string | null }).viewerPlace ?? '');
      if (got.kind === 'file' && got.mime.startsWith('image/')) {
        if (got.bytes.length <= DATA_URI_LIMIT) setImageUri(dataUri(got.bytes, got.mime));
        else { const u = await writeTemp(got.bytes, extensionOf(got.name, got.mime)); temp.current = u; setImageUri(u); }
      }
      setOpened(got);
      if (timer > 0) setRemaining(timer);
      setPhase('revealed');
    } catch (e) {
      const code = errorCode(e);
      // The server refused without burning (locked, not yet, offline): back to ready with the reason.
      if (code === 'recipient_locked') { setUnlockToken(''); setCodeSent(false); setLockCode(''); }
      if (keepsReady(code)) { setErr(secretError(e)); setPhase('ready'); return; }
      setErr(secretError(e)); setPhase('error');
    }
  }

  async function copyText() {
    if (!opened || opened.kind === 'file') return;
    const plain = opened.kind === 'wifi' ? (opened.wifi.password || opened.wifi.ssid) : opened.text;
    try { await Clipboard.setStringAsync(plain); setToast('Copied'); }
    catch { setErr('Couldn’t copy.'); }
  }

  async function save() {
    if (!opened || opened.kind !== 'file' || sharing) return;
    setSharing(true); setErr('');
    try { await shareBytes(opened.bytes, opened.mime, extensionOf(opened.name, opened.mime)); }
    catch { setErr('Couldn’t open the share sheet.'); }
    finally { setSharing(false); }
  }

  /**
   * The website as the fallback the user chose (geofence, a protection this build cannot check).
   * Android: a Custom Tab (`openBrowserAsync`), because `Linking.openURL` of an https://onepeek.io/s/
   * link resolves through the verified App Link straight back into this app. iOS: `openURL`, which
   * hands a Universal Link the app itself owns to Safari. Either way the browser gets the key.
   */
  function openInBrowser() {
    if (!url) return;
    const open = Platform.OS === 'android' ? WebBrowser.openBrowserAsync(url).then(() => undefined) : Linking.openURL(url).then(() => undefined);
    open.catch(() => setErr('Couldn’t open the browser.'));
  }

  const close = () => { clear('cleared'); if (router.canGoBack()) router.back(); else router.replace('/'); };

  const header = peek?.header;
  const isWifi = header?.tpl === 'wifi';
  const isImage = header?.type === 'file' && !!header.mime?.startsWith('image/');
  const guard = !!header?.guard;
  const noCopy = !!header?.noCopy;
  const noSave = !!header?.noSave;
  const maxViews = peek?.maxViews ?? 1;
  const viewsLeft = peek?.viewsLeft ?? 1;
  const finalView = viewsLeft <= 1;
  const low = timer > 0 && remaining <= Math.min(5, Math.ceil(timer / 3));

  const content = opened ? (
    opened.kind === 'text' ? (
      <ScrollView style={styles.textScroll} testID="sview.text"><Text variant="mono" selectable={!noCopy}>{opened.text}</Text></ScrollView>
    ) : opened.kind === 'wifi' ? (
      <View style={styles.wifi} testID="sview.wifi">
        <Row label="Network" value={opened.wifi.ssid} />
        {opened.wifi.security !== 'nopass' ? <Row label="Password" value={opened.wifi.password} mono /> : null}
        <Row label="Security" value={`${opened.wifi.security === 'nopass' ? 'Open network' : opened.wifi.security}${opened.wifi.hidden ? ' · hidden' : ''}`} />
        <View style={styles.qrWrap} accessible accessibilityLabel="Wi-Fi QR code. Scan it with a phone camera to join.">
          <View style={styles.qrBox}><QRCode value={wifiQrPayload(opened.wifi)} size={160} color="#000" backgroundColor="#fff" /></View>
        </View>
      </View>
    ) : imageUri ? (
      <Image source={{ uri: imageUri }} style={styles.image} contentFit="contain" accessibilityLabel="Secret image" cachePolicy="none" testID="sview.image" />
    ) : (
      <View style={styles.fileCard} testID="sview.file">
        <Icon name="file" size={36} color={colors.muted} />
        <Text variant="title" center numberOfLines={2}>{opened.name}</Text>
        <Text variant="meta" tone="muted" center>{fileSize(opened.bytes.length)}</Text>
      </View>
    )
  ) : null;

  return (
    <Screen scroll header={<Header close title={maxViews > 1 ? 'Limited-view secret' : 'One-time secret'} onBack={close} testID="sview.close" />} testID="sview.screen">
      {phase === 'loading' ? <Text variant="sub" tone="muted" center accessibilityLiveRegion="polite">Checking your link…</Text> : null}

      {phase === 'error' ? (
        <View style={styles.stack} testID="sview.error">
          <Text variant="h2" tone="heading" accessibilityRole="header">Nothing to reveal</Text>
          <Notice tone="error" text={err} />
          <Text variant="sub" tone="muted">OnePeek secrets can be opened a set number of times. After that, they’re permanently deleted.</Text>
          <Button title="Send a new secret" variant="ghost" onPress={() => router.replace('/secret')} testID="sview.new" />
        </View>
      ) : null}

      {(phase === 'ready' || phase === 'opening') && header && peek ? (
        <View style={styles.stack}>
          <Text variant="h2" tone="heading" accessibilityRole="header">Someone sent you {isWifi ? 'Wi-Fi details' : 'a secret'}</Text>
          <View style={styles.chips}>
            <Badge label={isWifi ? 'Wi-Fi' : header.type === 'file' ? (isImage ? 'Image' : 'File') : 'Text'} tone="neutral" />
            {header.type === 'file' && header.size ? <Badge label={fileSize(header.size)} tone="neutral" /> : null}
            {timer > 0 ? <Badge label={`vanishes ${timer}s after opening`} tone="secure" icon="clock" /> : null}
            <Badge label={maxViews > 1 ? `${viewsLeft} of ${maxViews} views left` : '1 view'} tone="neutral" />
            {peek.locked ? <Badge label="recipient only" tone="neutral" icon="user" /> : null}
            {guard ? <Badge label="hold to view" tone="neutral" icon="eye" /> : null}
          </View>
          <Text variant="sub" tone="muted">
            It will be decrypted on this phone. {maxViews > 1 ? `This link can be opened ${viewsLeft} more time${viewsLeft === 1 ? '' : 's'}, then it’s deleted from OnePeek.` : 'As soon as you open it, it’s deleted from OnePeek — this link won’t work again.'}{timer > 0 ? ` You’ll have ${timer} second${timer === 1 ? '' : 's'} to view it.` : ''}
          </Text>

          {needsCode ? (
            <View style={styles.box} testID="sview.locked">
              <Text variant="sub">This secret is for {peek.lockHint ?? 'one email address'}. Confirm it’s you with a one-time code.</Text>
              {!codeSent ? (
                <>
                  <Field label="Your email address" value={lockEmail} onChangeText={(v) => { setLockEmail(v); setLockMsg(''); }} placeholder="you@example.com" keyboardType="email-address" inputMode="email" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" testID="sview.lockEmail" />
                  <Button title={lockBusy ? 'Sending…' : 'Email me a code'} busy={lockBusy} disabled={!lockEmail.trim()} onPress={sendCode} testID="sview.sendCode" />
                </>
              ) : (
                <>
                  <Field label="6-digit code" value={lockCode} onChangeText={(v) => { setLockCode(v.replace(/\D/g, '').slice(0, 6)); setLockMsg(''); }} placeholder="123456" keyboardType="number-pad" inputMode="numeric" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} mono testID="sview.lockCode" />
                  <Button title={lockBusy ? 'Checking…' : 'Confirm'} busy={lockBusy} disabled={lockCode.length !== 6} onPress={verifyCode} testID="sview.verifyCode" />
                  <Button title="Use another email" variant="ghost" disabled={lockBusy} onPress={() => { setCodeSent(false); setLockCode(''); setLockMsg(''); }} testID="sview.lockAgain" />
                </>
              )}
              {lockMsg ? <Text variant="meta" tone="muted" accessibilityLiveRegion="polite" testID="sview.lockMsg">{lockMsg}</Text> : null}
            </View>
          ) : null}
          {peek.locked && unlockToken ? <Notice tone="success" icon="check" text="Email confirmed. You can open the secret now." testID="sview.unlocked" /> : null}
          {peek.notYet ? (
            <View style={styles.box} testID="sview.notYet">
              <Text variant="sub">This secret can’t be opened yet. {notYetText(peek.notYet)} Nothing has been opened or deleted.</Text>
            </View>
          ) : null}
          {err ? <Notice tone="error" text={err} /> : null}
          {err.includes('onepeek.io instead') ? (
            <View style={styles.browser}>
              <Button title="Open in browser" variant="ghost" onPress={openInBrowser} testID="sview.browser" />
              <Text variant="meta" tone="muted" center testID="sview.browserNote">{BROWSER_NOTE}</Text>
            </View>
          ) : null}
          <Button title={phase === 'opening' ? 'Decrypting…' : 'Open secret'} busy={phase === 'opening'} disabled={needsCode || !!peek.notYet} onPress={open} testID="sview.open" />
        </View>
      ) : null}

      {phase === 'revealed' && header && opened ? (
        <View style={styles.stack}>
          {timer > 0 ? (
            <View style={styles.countdown} accessibilityLiveRegion="polite" testID="sview.timer">
              <Text variant="meta" tone="muted">Vanishes in</Text>
              <Text variant="h2" tone={low ? 'danger' : 'heading'} mono>{Math.max(0, remaining)}s</Text>
            </View>
          ) : null}

          {guard ? (
            <Pressable
              onPressIn={() => setHeld(true)}
              onPressOut={() => setHeld(false)}
              delayLongPress={120}
              onLongPress={() => {}}
              accessibilityRole="button"
              accessibilityLabel={held ? 'Secret shown while held' : 'Press and hold to view'}
              style={styles.body}
              testID="sview.hold"
            >
              {held ? (
                <>
                  {content}
                  <Watermark viewerName={(unlockToken && lockEmail.trim()) || viewerPlace || 'OnePeek viewer'} deviceCode="this phone" />
                </>
              ) : (
                <View style={styles.holdHint}>
                  <Icon name="eye" size={22} color={colors.muted} />
                  <Text variant="title" tone="muted">Press and hold to view</Text>
                </View>
              )}
            </Pressable>
          ) : (
            <View style={styles.body}>{content}</View>
          )}

          {noCopy || (noSave && header.type === 'file') ? (
            <Text variant="meta" tone="muted">The sender turned off {noCopy && noSave ? 'copying and saving' : noCopy ? 'copying' : 'saving'} for this secret.</Text>
          ) : null}
          {opened.kind !== 'file' && !noCopy ? <Button title={opened.kind === 'wifi' ? 'Copy password' : 'Copy secret'} icon="copy" variant="ghost" onPress={copyText} testID="sview.copy" /> : null}
          {opened.kind === 'file' && !noSave && !(guard && isImage) ? <Button title={sharing ? 'Opening…' : 'Save or share…'} icon="share" variant="ghost" busy={sharing} onPress={save} testID="sview.save" /> : null}
          {err ? <Notice tone="error" text={err} /> : null}
          <Notice tone="info" icon="flame" text={finalView ? 'This secret has been deleted from OnePeek. The link won’t work again.' : `This link can be opened ${viewsLeft - 1} more time${viewsLeft - 1 === 1 ? '' : 's'}. After that it’s deleted.`} />
          <Button title="Close" onPress={close} testID="sview.done" />
        </View>
      ) : null}

      {phase === 'vanished' ? (
        <View style={styles.stack} testID="sview.vanished">
          <Text variant="h2" tone="heading" accessibilityRole="header">The secret has vanished</Text>
          <Text variant="sub" tone="muted">The viewing time set by the sender ran out. It’s gone from this phone{finalView ? ' and from OnePeek' : ''}.</Text>
          <Button title="Close" variant="ghost" onPress={close} testID="sview.done" />
        </View>
      ) : null}

      {phase === 'cleared' ? (
        <View style={styles.stack} testID="sview.cleared">
          <Text variant="h2" tone="heading" accessibilityRole="header">The secret was hidden</Text>
          <Text variant="sub" tone="muted">It left the screen when the app went to the background, and it isn’t kept on this phone. {finalView ? 'It has already been deleted from OnePeek, so the link won’t work again.' : `The link can still be opened ${viewsLeft - 1} more time${viewsLeft - 1 === 1 ? '' : 's'}.`}</Text>
          <Button title="Close" variant="ghost" onPress={close} testID="sview.done" />
        </View>
      ) : null}
      <Toast message={toast} testID="sview.toast" />
    </Screen>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text variant="meta" tone="muted">{label}</Text>
      <Text variant="title" mono={mono} selectable={false} style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  browser: { gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  box: { gap: spacing.md, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  countdown: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surface },
  body: { minHeight: 240, borderRadius: radii.lg, overflow: 'hidden', backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  holdHint: { alignItems: 'center', gap: spacing.sm, minHeight: touchTarget, justifyContent: 'center' },
  textScroll: { alignSelf: 'stretch', maxHeight: 360 },
  wifi: { alignSelf: 'stretch', gap: spacing.md },
  row: { gap: 2 },
  rowValue: { flexShrink: 1 },
  qrWrap: { alignItems: 'center' },
  qrBox: { padding: 12, backgroundColor: '#fff', borderRadius: radii.lg },
  image: { width: '100%', height: 320 },
  fileCard: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
});
