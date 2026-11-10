// QR scanner (design 11): invites open the join flow, one-time secrets open the viewer, a safety
// number (`onepeek-verify:<60 digits>`) is compared with the people in the chat this was opened
// from (`?room=<id>`), and anything else is "Not a OnePeek code". Decoding happens on the phone in
// expo-camera; no frame and no payload is sent anywhere by this screen. A secret link goes to the
// viewer through the in-memory hand-off, never through route params.
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { useChat } from '../components/ChatProvider';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { colors, radii, spacing, touchTarget } from '../theme';
import { errorCode, friendlyError, memberName, scanMatchLine } from '@/lib/format';
import { classify, stashHandoff } from '@/lib/links';

type Found =
  | { kind: 'invite'; url: string }
  | { kind: 'secret'; url: string; id: string }
  | { kind: 'verify'; match: { deviceId: string; name: string; pinned: boolean } | null; checking: boolean }
  | { kind: 'none' };

const WHAT = 'Scans invites, one-time secrets and safety numbers. The camera image never leaves this phone.';

export default function ScanScreen() {
  const { room } = useLocalSearchParams<{ room?: string }>();
  const roomId = typeof room === 'string' && room ? room : null;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { chat, guard } = useChat();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [found, setFound] = useState<Found | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const close = useCallback(() => { if (router.canGoBack()) router.back(); else router.replace('/'); }, [router]);

  /** Compares scanned digits with each other member's safety number in the room this was opened from. */
  const checkVerify = useCallback(async (digits: string) => {
    if (!roomId) { setFound({ kind: 'verify', match: null, checking: false }); return; }
    setFound({ kind: 'verify', match: null, checking: true });
    try {
      const me = (await chat().ensureDevice()).id;
      const members = (await chat().members(roomId)).filter((m) => m.state === 'active' && m.deviceId !== me);
      // F2-7: only a room whose owner is pinned gets the plain wording (anything else: the cautious one).
      const pinned = (await chat().myRooms()).find((r) => r.id === roomId)?.ownerPinned === true;
      for (const m of members) {
        const n = await chat().safetyNumberWith(roomId, m.deviceId);
        if (n === digits) { setFound({ kind: 'verify', match: { deviceId: m.deviceId, name: memberName(m.nickname, m.deviceId), pinned }, checking: false }); return; }
      }
      setFound({ kind: 'verify', match: null, checking: false });
    } catch (e) {
      setErr(friendlyError(errorCode(e)));
      setFound({ kind: 'verify', match: null, checking: false });
    }
  }, [chat, roomId]);

  const onScan = useCallback((data: string) => {
    if (found) return;
    const c = classify(data);
    Haptics.notificationAsync(c.kind === 'none' ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (c.kind === 'invite') setFound({ kind: 'invite', url: c.url });
    else if (c.kind === 'secret') setFound({ kind: 'secret', url: c.url, id: c.id });
    else if (c.kind === 'verify') void checkVerify(c.digits);
    else setFound({ kind: 'none' });
  }, [found, checkVerify]);

  // The torch is a camera setting: it goes off with the screen.
  useEffect(() => () => setTorch(false), []);

  function openFound() {
    if (!found) return;
    if (found.kind === 'invite') { stashHandoff('invite', found.url); router.replace('/chat/join'); }
    else if (found.kind === 'secret') { stashHandoff('secret', found.url); router.replace(`/s/${found.id}`); }
  }

  async function markVerified() {
    if (!roomId || !found || found.kind !== 'verify' || !found.match || busy) return;
    setBusy(true); setErr('');
    try { await guard(() => chat().markVerified(roomId, found.match!.deviceId)); close(); }
    catch (e) { setErr(friendlyError(errorCode(e))); setBusy(false); }
  }

  if (!permission) return <Screen testID="scan.screen" />;

  if (!permission.granted) {
    return (
      <Screen testID="scan.screen" header={<Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close" style={styles.roundBtn} testID="scan.close"><Icon name="close" size={22} color={colors.text} /></Pressable>}>
        <View style={styles.permission} testID="scan.permission">
          <Icon name="qr" size={36} color={colors.muted} />
          <Text variant="h2" tone="heading" center accessibilityRole="header">Camera access needed</Text>
          <Text variant="sub" tone="muted" center>{WHAT}</Text>
          {permission.canAskAgain
            ? <Button title="Allow camera" block={false} onPress={() => { requestPermission().catch(() => {}); }} testID="scan.allow" />
            : <Button title="Open Settings" block={false} variant="ghost" onPress={() => { Linking.openSettings().catch(() => {}); }} testID="scan.settings" />}
        </View>
      </Screen>
    );
  }

  return (
    <View style={styles.root} testID="scan.screen">
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={found ? undefined : (r) => onScan(r.data)}
        testID="scan.camera"
      />
      <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close" style={styles.roundBtn} testID="scan.close"><Icon name="close" size={22} color={colors.text} /></Pressable>
        <Text variant="title" tone="heading">Scan</Text>
        <Pressable onPress={() => setTorch((t) => !t)} accessibilityRole="switch" accessibilityState={{ checked: torch }} accessibilityLabel="Torch" style={[styles.roundBtn, torch && styles.roundOn]} testID="scan.torch"><Icon name="alert" size={22} color={torch ? colors.accentText : colors.text} /></Pressable>
      </View>
      <View style={styles.middle} pointerEvents="none">
        <View style={styles.frame}>
          <View style={[styles.corner, styles.tl]} /><View style={[styles.corner, styles.tr]} /><View style={[styles.corner, styles.bl]} /><View style={[styles.corner, styles.br]} />
        </View>
        <Text variant="sub" center style={styles.hintText}>Point at a OnePeek QR code</Text>
      </View>
      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        {found ? (
          <View style={styles.card} accessibilityLiveRegion="polite" testID="scan.result">
            {found.kind === 'invite' ? (
              <>
                <ResultHead icon="lock" title="Invite to a chat" sub="Opens the join screen; you may need an access code." />
                <Button title="Open invite" onPress={openFound} testID="scan.open" />
              </>
            ) : found.kind === 'secret' ? (
              <>
                <ResultHead icon="key" title="One-time secret" sub="Opens the secret. Nothing is opened or deleted until you tap Open there." />
                <Button title="Open secret" onPress={openFound} testID="scan.open" />
              </>
            ) : found.kind === 'verify' ? (
              found.checking ? (
                <ResultHead icon="shield" title="Safety number" sub="Comparing with the people in this chat…" />
              ) : found.match ? (
                <>
                  <ResultHead icon="check" title={`Matches ${found.match.name}`} sub={scanMatchLine(found.match.name, found.match.pinned)} accent />
                  <Button title={busy ? 'Saving…' : 'They match — mark verified'} busy={busy} onPress={markVerified} testID="scan.verify" />
                </>
              ) : (
                <>
                  <ResultHead icon="ban" title={roomId ? 'Doesn’t match anyone in this chat' : 'Safety number'} sub={roomId ? 'Compare the numbers out loud before trusting this chat.' : 'Open Verify people in a chat’s menu and scan from there to compare.'} danger={!!roomId} />
                  <Button title="Scan again" variant="ghost" onPress={() => { setFound(null); setErr(''); }} testID="scan.again" />
                </>
              )
            ) : (
              <>
                <ResultHead icon="ban" title="Not a OnePeek code" sub="Only OnePeek invites, secrets and safety numbers open here." />
                <Button title="Scan again" variant="ghost" onPress={() => setFound(null)} testID="scan.again" />
              </>
            )}
            {err ? <Text variant="meta" tone="danger">{err}</Text> : null}
          </View>
        ) : null}
        <Text variant="meta" tone="muted" center style={styles.what}>{WHAT}</Text>
      </View>
    </View>
  );
}

function ResultHead({ icon, title, sub, accent, danger }: { icon: 'lock' | 'key' | 'shield' | 'check' | 'ban'; title: string; sub: string; accent?: boolean; danger?: boolean }) {
  return (
    <View style={styles.resultHead}>
      <Avatar icon={icon} accent={accent} />
      <View style={styles.resultText}>
        <Text variant="title" tone={danger ? 'danger' : 'heading'} numberOfLines={2}>{title}</Text>
        <Text variant="meta" tone="muted">{sub}</Text>
      </View>
    </View>
  );
}

const C = 28;
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.gutter },
  roundBtn: { width: touchTarget + 4, height: touchTarget + 4, borderRadius: (touchTarget + 4) / 2, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' },
  roundOn: { backgroundColor: colors.accent },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xl },
  frame: { width: 240, height: 240 },
  corner: { position: 'absolute', width: C, height: C, borderColor: colors.accent },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: radii.md },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: radii.md },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: radii.md },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: radii.md },
  hintText: { color: colors.heading },
  bottom: { paddingHorizontal: spacing.gutter, gap: spacing.md },
  card: { gap: spacing.md, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  resultHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  resultText: { flex: 1, gap: 2 },
  what: { marginHorizontal: spacing.lg },
  permission: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
});
