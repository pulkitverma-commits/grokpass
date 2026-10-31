// Settings (design 12). Account, privacy and security (lock state from the security module, Lock
// now, Panic Exit), chats (notifications through `push`, devices with chat keys), what each
// protection honestly does (PROTECTION_COPY), sign out, reset this phone, version. The push token
// is opaque: it goes from expo-notifications to the lib's `push.register` and is never shown or logged.
// Panic Exit is a single tap, as on the web: a mistaken tap only costs an unlock.
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, Switch, View } from 'react-native';
import { PROTECTION_COPY, useSecurity } from '@/security';
import { Avatar } from '../components/Avatar';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { useChat } from '../components/ChatProvider';
import { Header } from '../components/Header';
import { Icon } from '../components/Icon';
import { ListRow } from '../components/ListRow';
import { Notice } from '../components/Notice';
import { Screen } from '../components/Screen';
import { SectionLabel } from '../components/SectionLabel';
import { Text } from '../components/Text';
import { colors, radii, spacing, touchTarget } from '../theme';
import { auth, push, type AuthSession } from '@/lib/chat';
import { errorCode, friendlyError } from '@/lib/format';

type Device = { id: string; label: string; created_at: string; last_seen: string; revoked_at: string | null };

const LOCK_NAME: Record<string, string> = { face: 'Face ID lock', fingerprint: 'Fingerprint lock', passcode: 'Passcode lock', none: 'No screen lock' };

export default function SettingsScreen() {
  const router = useRouter();
  const { chat, guard } = useChat();
  const { biometrics, deviceInsecure, lockNow, panic } = useSecurity();
  const [session, setSession] = useState<AuthSession | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [notify, setNotify] = useState(false);
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [notifyErr, setNotifyErr] = useState('');
  const [devices, setDevices] = useState<Device[]>([]);
  const [thisDevice, setThisDevice] = useState('');
  const [confirmDevice, setConfirmDevice] = useState<Device | null>(null);
  const [deviceBusy, setDeviceBusy] = useState<string | null>(null);

  const loadDevices = useCallback(async () => {
    try {
      const [list, me] = await Promise.all([chat().listDevices(), chat().ensureDevice().catch(() => null)]);
      setDevices(list);
      setThisDevice(me?.id ?? '');
    } catch { /* no session or offline: the section stays empty */ }
  }, [chat]);

  useEffect(() => {
    auth.getSession().then(setSession).catch(() => setSession(null));
    push.current().then(setNotify).catch(() => {});
    Promise.resolve().then(loadDevices);
  }, [loadDevices]);

  async function signOut() {
    setErr(''); setBusy(true);
    try { await auth.signOut(); router.replace('/welcome'); }
    catch { setErr('Sign out didn’t finish. Try again.'); setBusy(false); }
  }

  async function toggleNotify(on: boolean) {
    if (notifyBusy) return;
    setNotifyBusy(true); setNotifyErr('');
    try {
      if (on) {
        const perm = await Notifications.requestPermissionsAsync();
        if (!perm.granted) { setNotifyErr('Notifications are off for OnePeek in the phone settings.'); return; }
        const token = await Notifications.getDevicePushTokenAsync();
        await push.register(Platform.OS === 'ios' ? 'ios' : 'android', String(token.data));
        setNotify(true);
      } else {
        await push.unregister();
        setNotify(false);
      }
    } catch (e) {
      setNotifyErr(errorCode(e) === 'not_signed_in' ? 'Sign in to get notifications on this phone.' : 'Notifications couldn’t be changed. Try again.');
    } finally { setNotifyBusy(false); }
  }

  async function revoke(d: Device) {
    setDeviceBusy(d.id); setErr('');
    try {
      await guard(() => chat().revokeDevice(d.id));
      setConfirmDevice(null);
      if (d.id === thisDevice) { router.replace('/welcome'); return; }
      await loadDevices();
    } catch (e) { setErr(friendlyError(errorCode(e))); }
    finally { setDeviceBusy(null); }
  }

  const who = session === undefined ? '' : !session ? 'Not signed in' : session.isAnonymous ? 'You’re using chat as a guest on this device.' : `Signed in as ${session.email ?? 'your account'}`;
  const version = Constants.expoConfig?.version ?? '';
  const live = devices.filter((d) => !d.revoked_at);

  return (
    <Screen scroll header={<Header title="Settings" />} testID="settings.screen">
      <View style={styles.card}>
        <ListRow divider={false} leading={<Avatar name={session?.email ?? (session?.isAnonymous ? 'Guest' : null)} size={46} accent />} title={session?.isAnonymous ? 'Guest' : (session?.email ?? 'Account')} subtitle={who} testID="settings.account" />
      </View>

      <SectionLabel>Privacy and security</SectionLabel>
      <View style={styles.card}>
        <ListRow leading={<Icon name={biometrics === 'face' ? 'face' : biometrics === 'fingerprint' ? 'fingerprint' : 'lock'} size={20} color={deviceInsecure ? colors.danger : colors.accent} />}
          title={LOCK_NAME[deviceInsecure ? 'none' : biometrics] ?? 'Lock'}
          subtitle={deviceInsecure ? 'This phone has no passcode or biometrics, so OnePeek cannot ask for one.' : 'Every time OnePeek opens, and after 1 minute in the background'}
          trailing={<Badge label={deviceInsecure ? 'Off' : 'Always on'} tone={deviceInsecure ? 'danger' : 'secure'} />} testID="settings.lock" />
        <ListRow title="Screen protection" subtitle={Platform.OS === 'android' ? 'Screenshots and recordings blocked in chats' : 'Screenshots reported to the chat; recordings hidden'} trailing={<Badge label={Platform.OS === 'android' ? 'Always on' : 'Reported'} tone="secure" />} testID="settings.protection" />
        <ListRow title="Lock now" subtitle="Hide chats until you unlock with the phone" onPress={lockNow} chevron testID="settings.lockNow" />
        <ListRow title="Panic Exit" subtitle="Chats lock on this device until you unlock them. Nothing is deleted." tone="danger" onPress={panic} chevron divider={false} testID="panic" />
      </View>

      <SectionLabel>Chats</SectionLabel>
      <View style={styles.card}>
        <ListRow title="Notifications" subtitle="“New message in a private chat”, never content" testID="settings.notifications"
          trailing={<Switch value={notify} disabled={notifyBusy} onValueChange={toggleNotify} trackColor={{ true: colors.accent, false: colors.segOn }} thumbColor={colors.white} accessibilityLabel="Notifications" testID="settings.notify" />} />
        <ListRow title="Reset chats on this phone" subtitle="Forgets every chat and key stored here. Other devices are not affected." chevron onPress={() => router.push('/reset')} testID="settings.reset" divider={__DEV__} />
        {__DEV__ ? <ListRow title="Run the Phase 0 crypto spike" subtitle="Development builds only" chevron onPress={() => router.push('/spike')} testID="settings.spike" divider={false} /> : null}
      </View>
      {notifyErr ? <View style={styles.gap}><Notice tone="error" text={notifyErr} testID="settings.notifyError" /></View> : null}

      <SectionLabel>Devices with chat keys</SectionLabel>
      <View style={styles.card}>
        {live.length === 0 ? <ListRow divider={false} title="No devices yet" subtitle="One is set up when you start or join a chat." /> : null}
        {live.map((d, i) => (
          <ListRow key={d.id} leading={<Icon name={d.id === thisDevice ? 'phone' : 'lock'} size={20} color={colors.muted} />} title={`${d.label || 'Device'}${d.id === thisDevice ? ' · this phone' : ''}`}
            subtitle={`Last active ${new Date(d.last_seen).toLocaleDateString()}`} divider={i < live.length - 1} testID="settings.device"
            trailing={<Button title="Sign out" small variant="ghost" block={false} busy={deviceBusy === d.id} onPress={() => setConfirmDevice(d)} accessibilityLabel={`Sign ${d.label || 'this device'} out of chat`} testID="settings.device.revoke" />} />
        ))}
      </View>
      {confirmDevice ? (
        <View style={styles.confirmBox} testID="settings.device.confirmBox">
          <Text variant="sub">{confirmDevice.id === thisDevice ? 'Sign this phone out of chat? Its chat keys are destroyed and it leaves every chat.' : 'Sign that device out of chat? It leaves every chat and can’t read new messages.'}</Text>
          <View style={styles.rowBtns}>
            <Button title="Sign out" variant="destructive" small block={false} style={styles.flex} busy={deviceBusy === confirmDevice.id} onPress={() => revoke(confirmDevice)} testID="settings.device.confirm" />
            <Button title="Keep" variant="ghost" small block={false} style={styles.flex} onPress={() => setConfirmDevice(null)} testID="settings.device.keep" />
          </View>
        </View>
      ) : null}

      <SectionLabel>What OnePeek can and cannot do</SectionLabel>
      <View style={[styles.card, styles.copy]} accessible accessibilityLabel={`${PROTECTION_COPY.androidScreenshots} ${PROTECTION_COPY.iosScreenshots} ${PROTECTION_COPY.appSwitcher} ${PROTECTION_COPY.camera}`} testID="settings.protectionCopy">
        <Text variant="meta" tone="muted">{Platform.OS === 'android' ? PROTECTION_COPY.androidScreenshots : PROTECTION_COPY.iosScreenshots}</Text>
        <Text variant="meta" tone="muted">{PROTECTION_COPY.appSwitcher}</Text>
        <Text variant="meta" tone="muted">{PROTECTION_COPY.camera}</Text>
      </View>

      <SectionLabel>Account</SectionLabel>
      <View style={styles.card}>
        <ListRow title={busy ? 'Signing out…' : 'Sign out'} subtitle={session?.isAnonymous ? 'A guest session can’t be signed back into; its chats stay on this phone until they expire.' : undefined} onPress={busy ? undefined : signOut} testID="settings.signOut" divider={false} />
      </View>
      {err ? <View style={styles.gap}><Notice tone="error" text={err} /></View> : null}

      <Text variant="meta" tone="muted" center style={styles.foot}>
        OnePeek{version ? ` ${version}` : ''} · Your chat keys stay in this phone’s secure storage and are never backed up to the cloud.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  copy: { padding: spacing.lg, gap: spacing.sm },
  gap: { marginTop: spacing.md },
  confirmBox: { marginTop: spacing.sm, gap: spacing.md, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.dangerSoft },
  rowBtns: { flexDirection: 'row', gap: spacing.sm, minHeight: touchTarget },
  flex: { flex: 1 },
  foot: { marginTop: spacing.xxl, paddingHorizontal: spacing.lg },
});
