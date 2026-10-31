// Join (design 09). The invite token only ever comes from a link's #fragment: either the deep link
// that opened the app (passed in by the route) or a link the user pastes here. It is handed to the
// core and never displayed, stored or sent anywhere else.
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radii, spacing } from '../theme';
import { Avatar } from './Avatar';
import { Badge } from './Badge';
import { Button } from './Button';
import { useChat } from './ChatProvider';
import { Field } from './Field';
import { Header } from './Header';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { Notice } from './Notice';
import { Screen } from './Screen';
import { Text } from './Text';
import { auth } from '@/lib/chat';
import { KIND_NAME, errorCode, friendlyError, inviteTokenFrom } from '@/lib/format';

type Info = { needs_code: boolean; kind: 'quick' | 'secret' | 'business' };

const STEPS = ['Enter the code you were told separately', 'The owner’s phone lets you in', 'Compare safety numbers if you want proof'];

export function JoinScreen({ initialToken }: { initialToken: string | null }) {
  const router = useRouter();
  const { chat, guard } = useChat();
  const [token, setToken] = useState<string | null>(initialToken);
  const [pasted, setPasted] = useState('');
  const [info, setInfo] = useState<Info | null | undefined>(initialToken ? undefined : null);
  const [nick, setNick] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [guest, setGuest] = useState(false);

  useEffect(() => { auth.getSession().then((s) => setGuest(!s || s.isAnonymous)).catch(() => setGuest(true)); }, []);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    guard(() => chat().peekInvite(token)).then((i) => alive && setInfo(i)).catch(() => alive && setInfo(null));
    return () => { alive = false; };
  }, [token, chat, guard]);

  function usePasted() {
    const t = inviteTokenFrom(pasted);
    if (!t) { setErr('That doesn’t look like an OnePeek invite link.'); return; }
    setErr(''); setInfo(undefined); setToken(t);
  }

  async function join() {
    if (!token) return;
    setErr(''); setBusy(true);
    try {
      const room = await guard(() => chat().redeemInvite(token, nick, info?.needs_code ? code : undefined));
      router.replace(`/room/${room}`);
    } catch (e) {
      setErr(friendlyError(errorCode(e)));
      setBusy(false);
    }
  }

  // No token yet: ask for the link (Welcome → "I have an invite link", or the QR button on Chats).
  if (!token) {
    return (
      <Screen scroll header={<Header close title="Join a chat" />} testID="join.screen" footer={<Button title="Continue" onPress={usePasted} disabled={!pasted.trim()} testID="join.continue" />}>
        <Text variant="sub" tone="muted" style={styles.sub}>Paste the invite link you were sent. Scanning a QR code arrives in a later update.</Text>
        <Field label="Invite link" value={pasted} onChangeText={(v) => { setPasted(v); setErr(''); }} placeholder="https://onepeek.io/chat/join#…" autoCapitalize="none" autoCorrect={false} keyboardType="url" textContentType="URL" mono error={err} testID="join.link" />
      </Screen>
    );
  }

  if (info === undefined) {
    return (
      <Screen header={<Header close />} testID="join.screen">
        <Text variant="sub" tone="muted" center style={styles.checking} accessibilityLiveRegion="polite">Checking invite…</Text>
      </Screen>
    );
  }

  if (info === null) {
    return (
      <Screen header={<Header close />} testID="join.screen" footer={<Button title="Paste a different link" variant="ghost" onPress={() => { setToken(null); setPasted(''); setErr(''); }} testID="join.again" />}>
        <View style={[styles.card, styles.invalid]} testID="join.invalid">
          <Icon name="ban" size={30} color={colors.muted} />
          <Text variant="sub" tone="muted" center>This invite isn’t valid any more. It may have expired, been used, or been revoked.</Text>
        </View>
      </Screen>
    );
  }

  const secret = info.kind === 'secret';
  return (
    <Screen
      scroll
      header={<Header close right={<Logo size={22} />} />}
      testID="join.screen"
      footer={
        <>
          <Button title={busy ? 'Joining…' : 'Join chat'} busy={busy} onPress={join} disabled={info.needs_code && !code.trim()} testID="join.submit" />
          {guest ? <Text variant="meta" tone="muted" center>You join as a guest. No account, no phone number.</Text> : null}
        </>
      }
    >
      <View style={styles.card}>
        <Avatar icon={secret ? 'lock' : info.kind === 'business' ? 'shield' : 'clock'} size={64} accent={secret} />
        <Text variant="h1" tone="heading" center accessibilityRole="header">You’re invited to a {KIND_NAME[info.kind]}</Text>
        <Text variant="sub" tone="muted" center>No account needed. Keys are created on this device.</Text>
        <View style={styles.pills}>
          <Badge label="End-to-end encrypted" tone="secure" icon="lock" />
          {secret ? <Badge label="Hold to read" /> : null}
          {info.kind === 'business' ? <Badge label="Owner approves you" /> : null}
        </View>
      </View>

      {info.needs_code ? (
        <Field label="Access code" value={code} onChangeText={setCode} placeholder="Ask the person who invited you" mono autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" autoFocus testID="join.code" />
      ) : null}
      <Field label="Your name in this chat" value={nick} onChangeText={setNick} placeholder="Optional" maxLength={40} autoComplete="off" helper="Sent encrypted to the other members only." autoFocus={!info.needs_code} testID="join.nick" />

      <View style={styles.steps}>
        {(info.needs_code ? STEPS : STEPS.slice(1)).map((s, i) => (
          <View key={s} style={styles.step} accessible accessibilityLabel={`Step ${i + 1}: ${s}`}>
            <View style={styles.stepNum}><Text variant="meta" tone="muted" mono>{i + 1}</Text></View>
            <Text variant="sub" style={styles.stepText}>{s}</Text>
          </View>
        ))}
      </View>
      {err ? <Notice tone="error" text={err} testID="join.error" /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sub: { marginBottom: spacing.lg },
  checking: { marginTop: spacing.xxl * 2 },
  card: { alignItems: 'center', gap: spacing.md, padding: spacing.xl, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, marginBottom: spacing.xl },
  invalid: { marginTop: spacing.xl },
  pills: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'center', marginTop: spacing.xs },
  steps: { gap: spacing.md, marginTop: spacing.sm, marginBottom: spacing.lg },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' },
  stepText: { flex: 1 },
});
