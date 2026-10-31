// New chat (design 08): kind, message timer and when it starts, chat lifetime, optional name,
// access code for Secret rooms, nickname. Creates the room and a first invite, then shows the invite
// sheet; Done opens the room.
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { useChat } from '../components/ChatProvider';
import { Field } from '../components/Field';
import { Header } from '../components/Header';
import { InviteSheet } from '../components/InviteSheet';
import { Notice } from '../components/Notice';
import { Screen } from '../components/Screen';
import { SectionLabel } from '../components/SectionLabel';
import { Segmented } from '../components/Segmented';
import { Text } from '../components/Text';
import { colors, radii, spacing } from '../theme';
import { LIFETIMES, TIMERS, errorCode, friendlyError } from '@/lib/format';

type Kind = 'quick' | 'secret' | 'business';
type Mode = 'on_open' | 'on_send';

const KINDS: { kind: Kind; title: string; desc: string; icon: 'clock' | 'lock' | 'shield'; testID: string }[] = [
  { kind: 'quick', title: 'Quick Chat', desc: 'Share a link and talk. Messages vanish a minute after they’re read.', icon: 'clock', testID: 'new.kind.quick' },
  { kind: 'secret', title: 'Secret Chat', desc: 'Adds an access code, hidden previews and a 30-second default.', icon: 'lock', testID: 'new.kind.secret' },
  { kind: 'business', title: 'Business Room', desc: 'Invite only. You approve each person and verify identities.', icon: 'shield', testID: 'new.kind.business' },
];

const INVITE = { expiresIn: 86400, maxUses: 1 } as const;

export default function NewChatScreen() {
  const router = useRouter();
  const { chat, guard } = useChat();
  const [kind, setKind] = useState<Kind>('secret');
  const [ttl, setTtl] = useState(30);
  const [mode, setMode] = useState<Mode>('on_open');
  const [lifetime, setLifetime] = useState(86400);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [nick, setNick] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [codeErr, setCodeErr] = useState('');
  const [created, setCreated] = useState<{ roomId: string; link: string } | null>(null);

  /** Each kind brings its own default timer and start mode, as on the web. */
  function pickKind(k: Kind) {
    setKind(k);
    setTtl(k === 'secret' ? 30 : k === 'business' ? 3600 : 60);
    setMode(k === 'business' ? 'on_send' : 'on_open');
  }

  async function create() {
    setErr(''); setCodeErr('');
    if (kind === 'secret' && code.trim().length < 6) { setCodeErr('Choose an access code of at least 6 characters.'); return; }
    setBusy(true);
    try {
      // `nickname` is being added to the core's createRoom (Phase 1); until the merged core declares
      // it, it rides along as an extra property and is ignored by an older core.
      const opts: Parameters<ReturnType<typeof chat>['createRoom']>[0] & { nickname?: string } = {
        kind, ttl, mode, lifetime, accessCode: kind === 'secret' ? code.trim() : null, name: name.trim() || null,
      };
      if (nick.trim()) opts.nickname = nick.trim().slice(0, 40);
      const roomId = await guard(() => chat().createRoom(opts));
      const invite = await guard(() => chat().createInvite(roomId, { ...INVITE, approval: kind === 'business' }));
      setCreated({ roomId, link: invite.link });
    } catch (e) {
      setErr(friendlyError(errorCode(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      scroll
      header={<Header title="New chat" />}
      testID="new.screen"
      footer={<Button title={busy ? 'Creating keys…' : 'Create chat and invite'} busy={busy} onPress={create} testID="new.create" />}
    >
      <Text variant="sub" tone="muted" style={styles.sub}>Everything is end-to-end encrypted. Pick how private it should feel.</Text>

      <View style={styles.kinds} accessibilityRole="radiogroup" accessibilityLabel="Chat type">
        {KINDS.map((k) => {
          const on = kind === k.kind;
          return (
            <Pressable key={k.kind} onPress={() => pickKind(k.kind)} accessibilityRole="radio" accessibilityState={{ checked: on, selected: on }} accessibilityLabel={`${k.title}. ${k.desc}`} testID={k.testID} style={({ pressed }) => [styles.kind, on && styles.kindOn, pressed && styles.pressed]}>
              <Avatar icon={k.icon} accent={on} size={44} />
              <View style={styles.kindText}>
                <Text variant="title">{k.title}</Text>
                <Text variant="meta" tone="muted">{k.desc}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <SectionLabel>Messages disappear after</SectionLabel>
      <Segmented label="Message timer" value={ttl} onChange={setTtl} testID="new.timer" options={TIMERS.map((t) => ({ value: t.s, label: t.label, testID: `new.timer.${t.s}` }))} />
      <View style={styles.gap} />
      <Segmented label="Timer starts" value={mode} onChange={setMode} testID="new.mode" options={[{ value: 'on_open', label: 'once read', testID: 'new.mode.read' }, { value: 'on_send', label: 'once sent', testID: 'new.mode.sent' }]} />
      <Text variant="meta" tone="muted" style={styles.hint}>Unread messages are deleted after 7 days at most.</Text>

      <SectionLabel>Chat ends after</SectionLabel>
      <Segmented label="Chat lifetime" value={lifetime} onChange={setLifetime} testID="new.lifetime" options={LIFETIMES.map((l) => ({ value: l.s, label: l.label, testID: `new.lifetime.${l.s}` }))} />

      <View style={styles.fields}>
        {kind === 'secret' ? (
          <Field label="Access code" value={code} onChangeText={(v) => { setCode(v); setCodeErr(''); }} mono placeholder="At least 6 characters" autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" maxLength={64} error={codeErr} helper="Share it separately from the link — say it, don’t send it in the same place." testID="new.code" />
        ) : null}
        <Field label="Name (only on your device)" value={name} onChangeText={setName} placeholder="Optional" maxLength={60} autoComplete="off" testID="new.name" />
        <Field label="Your name in this chat" value={nick} onChangeText={setNick} placeholder="Optional" maxLength={40} autoComplete="off" helper="Sent encrypted to the other members only." testID="new.nick" />
      </View>
      {err ? <Notice tone="error" text={err} testID="new.error" /> : null}

      {created ? (
        <InviteSheet open link={created.link} kind={kind} expiresLabel="1 day" usesLabel="once" onDone={() => router.replace(`/room/${created.roomId}`)} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sub: { marginBottom: spacing.lg },
  kinds: { gap: spacing.sm },
  kind: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: spacing.lg, borderRadius: radii.lg, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface },
  kindOn: { borderColor: colors.accent },
  kindText: { flex: 1, gap: 2 },
  pressed: { opacity: 0.85 },
  gap: { height: spacing.sm },
  hint: { marginTop: spacing.sm, marginHorizontal: spacing.xs },
  fields: { marginTop: spacing.xxl },
});
