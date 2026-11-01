// "Send as a one-time secret" (design 07). Text or a photo/file, either sent inside the current
// chat (view-once file, or text behind the room's own hold-to-read) or turned into a onepeek.io
// link through lib/secrets with the same options as the website: views, expiry, viewer timer,
// hold-to-view (guard), copy and save switches. The link's #fragment is the decryption key: it is
// drawn masked, and the full string goes only to the clipboard, the system share sheet or the chat
// send the user taps, never into a label, a param or a log. The secret text never leaves component
// state except into createSecretLink or the chat send.
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { useState } from 'react';
import { Pressable, Share, StyleSheet, Switch, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { colors, radii, spacing, touchTarget } from '../theme';
import { Button } from './Button';
import { Field } from './Field';
import { Icon } from './Icon';
import { Notice, Toast } from './Notice';
import { SectionLabel } from './SectionLabel';
import { Segmented } from './Segmented';
import { Sheet } from './Sheet';
import { Text } from './Text';
import { MAX_ATTACHMENT_BYTES, deletePicked, fileSize, fileSource, pickDocument, pickPhoto, type Picked } from '@/lib/files';
import { LIFETIMES, SECRET_TIMERS, SECRET_VIEWS, errorCode, friendlyError, maskLink, ttlLabel } from '@/lib/format';
import { createSecretLink, type SecretInput, type SecretLink, type SecretOptions } from '@/lib/secrets';

const MAX_TEXT_CHARS = 50_000;   // the web's MAX_TEXT_CHARS

type Wifi = { ssid: string; password: string; security: 'WPA' | 'WEP' | 'nopass'; hidden: boolean };
const WIFI_SECURITY = [{ value: 'WPA' as const, label: 'WPA/WPA2/WPA3' }, { value: 'WEP' as const, label: 'WEP' }, { value: 'nopass' as const, label: 'No password' }];

/** The Wi-Fi template input. C4's `SecretInput` carries `{ kind: 'wifi', wifi }`; this branch's placeholder type predates it, hence the cast. */
const wifiInput = (w: Wifi): SecretInput => ({ kind: 'wifi', wifi: { ssid: w.ssid.trim(), password: w.security === 'nopass' ? '' : w.password, security: w.security, hidden: w.hidden } } as unknown as SecretInput);

/** What "Send in this chat" hands back to the room screen (which owns the actual send). */
export type InChatSecret = { kind: 'text'; text: string } | { kind: 'file'; picked: Picked };

export type SecretTarget = {
  roomId: string;
  /** The composer's current timer, so the copy can say what happens in this chat. */
  ttl: number;
  /** Secret rooms hide text behind hold-to-read; elsewhere text lands in the open. */
  secret: boolean;
};

type Props = {
  /** The chat this was opened from, or null from the Chats home (link only). */
  target: SecretTarget | null;
  initialText?: string;
  /** A file handed over by another app (share target); not under the pickers' cache, never deleted here. */
  initialFile?: Picked | null;
  /** Hide the pickers and "Send in this chat": the share target already chose what to send. */
  fixed?: boolean;
  onSendInChat?: (s: InChatSecret) => Promise<void>;
  onSendLinkInChat?: (link: string) => Promise<void>;
  onDone: () => void;
};

/** Secret text stays out of the keyboard's dictionary and autofill (same flags as the Secret-room composer). */
const SECRET_INPUT = { autoCorrect: false, spellCheck: false, autoCapitalize: 'none', autoComplete: 'off', importantForAutofill: 'no', textContentType: 'none' } as const;

export function SecretComposer({ target, initialText = '', initialFile = null, fixed = false, onSendInChat, onSendLinkInChat, onDone }: Props) {
  const [text, setText] = useState(initialText);
  const [picked, setPicked] = useState<Picked | null>(initialFile);
  const [mode, setMode] = useState<'text' | 'wifi'>('text');
  const [wifi, setWifi] = useState<Wifi>({ ssid: '', password: '', security: 'WPA', hidden: false });
  const [views, setViews] = useState<number>(1);
  const [expires, setExpires] = useState<number>(86400);
  const [timer, setTimer] = useState<number>(0);
  const [guard, setGuard] = useState(false);
  const [allowCopy, setAllowCopy] = useState(true);
  const [allowSave, setAllowSave] = useState(true);
  const [busy, setBusy] = useState<'link' | 'chat' | null>(null);
  const [err, setErr] = useState('');
  const [link, setLink] = useState<SecretLink | null>(null);

  const isFile = !!picked;
  const isWifi = !isFile && mode === 'wifi';
  const wifiReady = !!wifi.ssid.trim() && (wifi.security === 'nopass' || !!wifi.password);
  const canSend = isFile ? true : isWifi ? wifiReady : text.trim().length > 0;
  const tooLong = !isFile && !isWifi && text.length > MAX_TEXT_CHARS;

  async function pick(kind: 'photo' | 'file') {
    setErr('');
    try {
      const p = kind === 'photo' ? await pickPhoto() : await pickDocument();
      if (!p) return;
      if (p.size > MAX_ATTACHMENT_BYTES) { deletePicked(p); setErr('Files can be up to 50 MB.'); return; }
      setPicked((prev) => { if (prev !== initialFile) deletePicked(prev); return p; });
    } catch { setErr('Couldn’t open the picker.'); }
  }

  function removePicked() {
    setPicked((prev) => { if (prev !== initialFile) deletePicked(prev); return null; });
  }

  function options(): SecretOptions {
    const o: SecretOptions = { ttlSeconds: expires, views };
    if (timer > 0) o.timer = timer;
    if (guard) o.guard = true;
    if (!isFile && !allowCopy) o.noCopy = true;
    if (isFile && !allowSave) o.noSave = true;
    return o;
  }

  async function makeLink() {
    if (!canSend || tooLong || busy) return;
    setErr(''); setBusy('link');
    const p = picked;
    try {
      const made = await createSecretLink(p ? { kind: 'file', file: fileSource(p) } : isWifi ? wifiInput(wifi) : { kind: 'text', text }, options());
      setLink(made);
      setText(''); setWifi((w) => ({ ...w, password: '' }));
      if (p && p !== initialFile) deletePicked(p);
      if (p) setPicked(null);
    } catch (e) {
      setErr(friendlyError(errorCode(e)));
    } finally { setBusy(null); }
  }

  async function sendInChat() {
    if (!onSendInChat || !canSend || tooLong || busy) return;
    setErr(''); setBusy('chat');
    try {
      // In a chat a Wi-Fi secret is plain text (the viewer's QR exists only for links).
      const wifiText = `Wi-Fi: ${wifi.ssid.trim()}${wifi.security === 'nopass' ? ' (no password)' : ` / ${wifi.password}`}${wifi.hidden ? ' (hidden network)' : ''}`;
      await onSendInChat(picked ? { kind: 'file', picked } : { kind: 'text', text: isWifi ? wifiText : text });
      setText(''); setPicked(null);
      onDone();
    } catch (e) {
      setErr(friendlyError(errorCode(e)));
    } finally { setBusy(null); }
  }

  const expiresLabel = LIFETIMES.find((l) => l.s === expires)?.label ?? '1 day';
  const viewsLabel = SECRET_VIEWS.find((v) => v.n === views)?.label ?? 'Once';
  const inChatCopy = target
    ? isFile
      ? `In this chat it goes as a view-once file that disappears ${ttlLabel(target.ttl)} after it’s opened.`
      : target.secret
        ? `In this chat it’s a message they press and hold to read, gone ${ttlLabel(target.ttl)} after reading.`
        : `In this chat it’s a normal message that disappears ${ttlLabel(target.ttl)} after reading. Use a link for one-time opening.`
    : null;

  return (
    <View style={styles.stack} testID="secret.composer">
      {!fixed ? (
        <View style={styles.sources}>
          <Pressable onPress={() => pick('photo')} accessibilityRole="button" accessibilityLabel="Choose a photo" style={({ pressed }) => [styles.source, pressed && styles.pressed]} testID="secret.photo">
            <Icon name="image" size={22} color={colors.accent} />
            <Text variant="title">Photo</Text>
          </Pressable>
          <Pressable onPress={() => pick('file')} accessibilityRole="button" accessibilityLabel="Choose a file" style={({ pressed }) => [styles.source, pressed && styles.pressed]} testID="secret.file">
            <Icon name="file" size={22} color={colors.accent} />
            <Text variant="title">File</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.titleRow}>
        <Icon name="key" size={22} color={colors.accent} />
        <Text variant="h2" tone="heading" accessibilityRole="header">Send as a one-time secret</Text>
      </View>
      <Text variant="sub" tone="muted">Opens a set number of times, then it’s gone for everyone. Encrypted on this phone; OnePeek never sees it or the key.</Text>

      {!picked && !fixed ? <Segmented label="Secret type" value={mode} onChange={setMode} testID="secret.mode" options={[{ value: 'text', label: 'Text or password', testID: 'secret.mode.text' }, { value: 'wifi', label: 'Wi-Fi', testID: 'secret.mode.wifi' }]} /> : null}
      {isWifi ? (
        <View style={styles.wifiForm} testID="secret.wifi">
          <Field label="Network name" value={wifi.ssid} onChangeText={(v) => setWifi({ ...wifi, ssid: v })} placeholder="e.g. Office-5G" maxLength={64} {...SECRET_INPUT} testID="secret.wifi.ssid" />
          {wifi.security !== 'nopass' ? <Field label="Password" value={wifi.password} onChangeText={(v) => setWifi({ ...wifi, password: v })} placeholder="Wi-Fi password" maxLength={128} mono {...SECRET_INPUT} testID="secret.wifi.password" /> : null}
          <Segmented label="Security" value={wifi.security} onChange={(v) => setWifi({ ...wifi, security: v })} testID="secret.wifi.security" options={WIFI_SECURITY.map((o) => ({ ...o, testID: `secret.wifi.security.${o.value}` }))} />
          <ToggleRow title="Hidden network" sub="The network doesn’t broadcast its name." value={wifi.hidden} onChange={(v) => setWifi({ ...wifi, hidden: v })} testID="secret.wifi.hidden" />
          <Text variant="meta" tone="muted" style={styles.hint}>With a link, the viewer gets the password and a QR code their phone can scan to join.</Text>
        </View>
      ) : picked ? (
        <View style={styles.pickedRow} accessible accessibilityLabel={`Selected file, ${fileSize(picked.size)}`} testID="secret.picked">
          <View style={styles.fileIcon}><Icon name={(picked.mime ?? '').startsWith('image/') ? 'image' : 'file'} size={20} color={colors.accent} /></View>
          <View style={styles.fileMain}>
            <Text variant="title" numberOfLines={1}>{picked.name}</Text>
            <Text variant="meta" tone="muted">{fileSize(picked.size)} · encrypted before upload</Text>
          </View>
          {!fixed ? <Button title="Remove" small variant="ghost" block={false} onPress={removePicked} testID="secret.remove" /> : null}
        </View>
      ) : (
        <Field
          label="Secret"
          value={text}
          onChangeText={(v) => { setText(v); setErr(''); }}
          placeholder="Password, API key, note…"
          multiline
          numberOfLines={4}
          maxLength={MAX_TEXT_CHARS + 1}
          editable={!fixed || !initialText}
          error={tooLong ? 'That secret is too long (max 50,000 characters).' : undefined}
          style={styles.textArea}
          {...SECRET_INPUT}
          testID="secret.text"
        />
      )}

      <SectionLabel>Can be opened</SectionLabel>
      <Segmented label="Can be opened" value={views} onChange={setViews} testID="secret.views" options={SECRET_VIEWS.map((v) => ({ value: v.n, label: v.label, testID: `secret.views.${v.n}` }))} />
      <SectionLabel>Expires if unopened</SectionLabel>
      <Segmented label="Expires if unopened" value={expires} onChange={setExpires} testID="secret.expires" options={LIFETIMES.map((l) => ({ value: l.s, label: l.label, testID: `secret.expires.${l.s}` }))} />
      <SectionLabel>Viewer timer</SectionLabel>
      <Segmented label="Viewer timer" value={timer} onChange={setTimer} testID="secret.timer" options={SECRET_TIMERS.map((t) => ({ value: t.s, label: t.label, testID: `secret.timer.${t.s}` }))} />
      <Text variant="meta" tone="muted" style={styles.hint}>{timer > 0 ? `Once opened, the secret vanishes after ${timer} seconds.` : 'No countdown: the secret stays on screen until the viewer leaves.'}</Text>

      <ToggleRow title="Hold to view" sub="Blurred until the viewer presses and holds, with a watermark." value={guard} onChange={setGuard} testID="secret.guard" />
      {isFile
        ? <ToggleRow title="Allow saving" sub="Off: the viewer can look but not download the file." value={allowSave} onChange={setAllowSave} testID="secret.allowSave" />
        : <ToggleRow title="Allow copying" sub="Off: the viewer gets no Copy button. Nothing stops a camera." value={allowCopy} onChange={setAllowCopy} testID="secret.allowCopy" />}

      <View style={styles.burn}>
        <Icon name="flame" size={16} color={colors.danger} />
        <Text variant="meta" tone="muted" style={styles.burnText}>{views > 1 ? `The link burns after ${views} views, even if it hasn’t expired yet.` : 'The link burns after one view, even if it hasn’t expired yet.'}</Text>
      </View>
      {inChatCopy ? <Text variant="meta" tone="muted" style={styles.hint}>{inChatCopy}</Text> : null}
      {err ? <Notice tone="error" text={err} testID="secret.error" /> : null}

      <View style={styles.actions}>
        <Button title={busy === 'link' ? 'Encrypting…' : 'Share as link'} icon="link" variant={target && !fixed ? 'ghost' : 'primary'} busy={busy === 'link'} disabled={!canSend || tooLong || busy === 'chat'} onPress={makeLink} testID="secret.link" />
        {target && onSendInChat && !fixed ? <Button title={busy === 'chat' ? 'Sending…' : 'Send in this chat'} busy={busy === 'chat'} disabled={!canSend || tooLong || busy === 'link'} onPress={sendInChat} testID="secret.sendChat" /> : null}
      </View>

      {link ? (
        <SecretLinkSheet
          link={link.url}
          viewsLabel={viewsLabel}
          expiresLabel={expiresLabel}
          onSendInChat={onSendLinkInChat}
          onDone={() => { setLink(null); onDone(); }}
        />
      ) : null}
    </View>
  );
}

function ToggleRow({ title, sub, value, onChange, testID }: { title: string; sub: string; value: boolean; onChange: (v: boolean) => void; testID: string }) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Text variant="title">{title}</Text>
        <Text variant="meta" tone="muted">{sub}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.accent, false: colors.segOn }} thumbColor={colors.white} accessibilityLabel={title} testID={testID} />
    </View>
  );
}

// ---------------------------------------------------------------------------- the result

/** Fail closed: only the literal `true` the `e2e` EAS profile's config writes unmasks the link (W3-2). */
function isE2EBuild(): boolean {
  return (Constants.expoConfig?.extra as { e2e?: unknown } | undefined)?.e2e === true;
}

type ResultProps = { link: string; viewsLabel: string; expiresLabel: string; onSendInChat?: (link: string) => Promise<void>; onDone: () => void };

export function SecretLinkSheet({ link, viewsLabel, expiresLabel, onSendInChat, onDone }: ResultProps) {
  const E2E = isE2EBuild();
  const [toast, setToast] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function copy() {
    try { await Clipboard.setStringAsync(link); setToast('Copied'); }
    catch { setErr('Couldn’t copy the link.'); }
  }
  async function share() {
    try { await Share.share({ message: link, url: link }); }
    catch { setErr('Couldn’t open the share sheet.'); }
  }
  async function sendHere() {
    if (!onSendInChat || busy) return;
    setBusy(true); setErr('');
    try { await onSendInChat(link); onDone(); }
    catch (e) { setErr(friendlyError(errorCode(e))); }
    finally { setBusy(false); }
  }

  return (
    <Sheet open onClose={onDone} title="Your one-time link" testID="secret.result">
      <View style={styles.qrWrap} accessible accessibilityLabel="Secret link as a QR code. Scan it with a phone camera to open the secret.">
        <View style={styles.qrBox}><QRCode value={link} size={180} color="#000" backgroundColor="#fff" /></View>
      </View>
      <View style={styles.linkBox}>
        <Text variant="mono" tone="muted" numberOfLines={E2E ? undefined : 1} ellipsizeMode={E2E ? undefined : 'middle'} style={styles.link} testID="secret.resultLink" accessibilityLabel="Secret link, hidden">{E2E ? link : maskLink(link)}</Text>
        <Button title="Copy" icon="copy" small block={false} onPress={copy} testID="secret.copy" />
      </View>
      <Text variant="meta" tone="muted" style={styles.hint}>Can be opened {viewsLabel.toLowerCase()} and expires in {expiresLabel} if unopened. The key is in the link itself, so share it the way you’d share the secret.</Text>
      {err ? <View style={styles.errBox}><Notice tone="error" text={err} /></View> : null}
      <View style={styles.actions}>
        {onSendInChat ? <Button title={busy ? 'Sending…' : 'Send link in this chat'} busy={busy} onPress={sendHere} testID="secret.sendLink" /> : null}
        <Button title="Share link" icon="share" variant={onSendInChat ? 'ghost' : 'primary'} onPress={share} testID="secret.share" />
        <Button title="Done" variant="ghost" onPress={onDone} testID="secret.done" />
      </View>
      <Toast message={toast} testID="secret.toast" />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  sources: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  source: { flex: 1, minHeight: touchTarget + 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radii.md, backgroundColor: colors.fill, borderWidth: 1, borderColor: colors.line },
  pressed: { opacity: 0.85 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pickedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.fill },
  fileIcon: { width: 40, height: 40, borderRadius: radii.sm, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  fileMain: { flex: 1, gap: 2 },
  textArea: { minHeight: 110, textAlignVertical: 'top' },
  wifiForm: { marginTop: spacing.md },
  hint: { marginHorizontal: spacing.xs },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md, minHeight: touchTarget },
  toggleText: { flex: 1, gap: 2 },
  burn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.dangerSoft },
  burnText: { flex: 1 },
  actions: { gap: spacing.sm, marginTop: spacing.lg },
  qrWrap: { alignItems: 'center', marginVertical: spacing.md },
  qrBox: { padding: 12, backgroundColor: '#fff', borderRadius: radii.lg },
  linkBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.fill, borderRadius: radii.md, paddingLeft: 14, paddingRight: 6, paddingVertical: 6 },
  link: { flex: 1 },
  errBox: { marginTop: spacing.sm },
});
