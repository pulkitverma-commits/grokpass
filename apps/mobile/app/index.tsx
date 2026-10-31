// Chats home (design 04). Rooms come from the core's myRooms(); pending joiners on rooms this phone
// owns are shown as "wants to join" rows with Let in. Refreshes on focus and when the app returns to
// the foreground. No message content is ever on this screen.
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, FlatList, Platform, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Avatar } from '../components/Avatar';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { useChat } from '../components/ChatProvider';
import { Field } from '../components/Field';
import { Icon } from '../components/Icon';
import { ListRow } from '../components/ListRow';
import { Logo } from '../components/Logo';
import { Notice } from '../components/Notice';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { colors, radii, spacing, touchTarget } from '../theme';
import { KIND_NAME, KIND_SHORT, countdown, errorCode, shortId } from '@/lib/format';

type Chat = ReturnType<ReturnType<typeof useChat>['chat']>;
type Room = Awaited<ReturnType<Chat['myRooms']>>[number];
type Pending = { roomId: string; roomTitle: string; deviceId: string };
type Item = { t: 'pending'; p: Pending } | { t: 'room'; r: Room };

export const roomTitle = (r: Pick<Room, 'name' | 'kind' | 'id'>) => r.name || `${KIND_NAME[r.kind]} · ${shortId(r.id)}`;
const kindIcon = (k: Room['kind']) => (k === 'secret' ? 'lock' : k === 'business' ? 'shield' : 'clock');

// Honest copy per platform: Android blocks screenshots in chats (FLAG_SECURE); iOS cannot block them,
// it reports them, and everyone in the chat is told.
const SHOT_NOTE = Platform.select({ android: 'Screenshots are blocked in chats on this phone.', default: 'Screenshots in chats are flagged to everyone in the chat.' });

export default function ChatsScreen() {
  const router = useRouter();
  const { chat, guard } = useChat();
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [query, setQuery] = useState('');
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [admitting, setAdmitting] = useState<string | null>(null);
  // Taken at each load so "ends in" is computed from one clock reading per refresh, not during render.
  const [now, setNow] = useState(() => Date.now());
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const list = await guard(() => chat().myRooms());
      setRooms(list);
      setNow(Date.now());
      setErr('');
      // Owners see who is waiting at the door. One members() call per owned room; errors just hide the row.
      const owned = list.filter((r) => r.role === 'owner' && r.memberState === 'active');
      const found = await Promise.all(owned.map(async (r) => {
        try {
          const ms = await chat().members(r.id);
          return ms.filter((m) => m.state === 'pending' && m.hasKeyPackage).map((m) => ({ roomId: r.id, roomTitle: roomTitle(r), deviceId: m.deviceId }));
        } catch { return []; }
      }));
      setPending(found.flat());
    } catch (e) {
      if (errorCode(e) === 'not_signed_in') router.replace('/welcome');
      else setErr('Chats couldn’t load. Check your connection and try again.');
    } finally {
      loading.current = false;
      setRefreshing(false);
    }
  }, [chat, guard, router]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void load(); });
    return () => sub.remove();
  }, [load]);

  async function letIn(p: Pending) {
    setAdmitting(p.deviceId);
    try {
      await guard(() => chat().admitPending(p.roomId, [p.deviceId]));
      setPending((cur) => cur.filter((x) => x.deviceId !== p.deviceId));
    } catch {
      setErr('Couldn’t let them in. Try again.');
    } finally {
      setAdmitting(null);
    }
  }

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (r: Room) => !q || roomTitle(r).toLowerCase().includes(q) || KIND_NAME[r.kind].toLowerCase().includes(q);
    const ps: Item[] = q ? [] : pending.map((p) => ({ t: 'pending', p }));
    const rs: Item[] = (rooms ?? []).filter(match).map((r) => ({ t: 'room', r }));
    return [...ps, ...rs];
  }, [rooms, pending, query]);

  const header = (
    <View style={styles.top}>
      <Logo />
      <View style={styles.topActions}>
        <Pressable onPress={() => router.push('/join')} accessibilityRole="button" accessibilityLabel="Join with an invite link" style={styles.iconBtn} testID="chats.join">
          <Icon name="qr" size={22} color={colors.text} />
        </Pressable>
        <Pressable onPress={() => router.push('/settings')} accessibilityRole="button" accessibilityLabel="Settings" style={styles.iconBtn} testID="chats.settings">
          <Icon name="settings" size={22} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );

  return (
    <Screen
      testID="chats.screen"
      header={header}
      footer={
        <>
          <Text variant="meta" tone="muted" center>{SHOT_NOTE}</Text>
          <View style={styles.actions}>
            <Button title="One-time secret" variant="ghost" icon="key" block={false} style={styles.secretBtn} onPress={() => router.push('/secret')} testID="chats.secret" />
            <Button title="New chat" icon="plus" block={false} style={styles.newBtn} onPress={() => router.push('/new')} testID="chats.new" />
          </View>
        </>
      }
    >
      <Text variant="display" tone="heading" accessibilityRole="header">Chats</Text>
      <View style={styles.subRow}>
        <Icon name="lock" size={14} color={colors.secure} />
        <Text variant="sub" tone="muted" style={styles.sub}>End-to-end encrypted. Gone when the timer runs out.</Text>
      </View>
      <Field value={query} onChangeText={setQuery} placeholder="Search chats on this phone" accessibilityLabel="Search chats on this phone" autoCapitalize="none" autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing" testID="chats.search" />
      {err ? <View style={styles.err}><Notice tone="error" text={err} /></View> : null}
      <FlatList
        data={items}
        keyExtractor={(i) => (i.t === 'pending' ? `p:${i.p.deviceId}` : `r:${i.r.id}`)}
        style={styles.list}
        contentContainerStyle={items.length ? styles.listBody : styles.listEmpty}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.accent} />}
        ListEmptyComponent={
          rooms === null ? (
            <Text variant="sub" tone="muted" center>Loading…</Text>
          ) : query ? (
            <Text variant="sub" tone="muted" center testID="chats.noMatch">No chats match “{query}”.</Text>
          ) : (
            <View style={styles.empty} testID="chats.empty">
              <Icon name="shield" size={30} color={colors.muted} />
              <Text variant="sub" tone="muted" center>No active chats on this device.</Text>
              <Button title="Start a chat" block={false} onPress={() => router.push('/new')} testID="chats.start" />
            </View>
          )
        }
        renderItem={({ item }) =>
          item.t === 'pending' ? (
            <ListRow
              style={styles.pendingRow}
              divider={false}
              leading={<Avatar icon="user" />}
              title={`Guest ${shortId(item.p.deviceId)} wants to join`}
              subtitle={`${item.p.roomTitle} · used your invite`}
              testID="chats.pending"
              trailing={<Button title="Let in" small block={false} busy={admitting === item.p.deviceId} onPress={() => letIn(item.p)} accessibilityLabel={`Let Guest ${shortId(item.p.deviceId)} into ${item.p.roomTitle}`} testID="chats.letIn" />}
            />
          ) : (
            <ListRow
              leading={<Avatar icon={kindIcon(item.r.kind)} accent={item.r.kind === 'secret'} />}
              title={roomTitle(item.r)}
              subtitle={item.r.memberState === 'pending' ? 'Waiting to be let in' : `${KIND_NAME[item.r.kind]} · ends in ${countdown(new Date(item.r.expiresAt).getTime() - now)}`}
              trailing={<Badge label={KIND_SHORT[item.r.kind]} tone={item.r.kind === 'secret' ? 'secure' : 'neutral'} icon="lock" />}
              onPress={() => router.push(`/room/${item.r.id}`)}
              accessibilityLabel={roomTitle(item.r)}
              accessibilityHint={item.r.memberState === 'pending' ? 'Waiting to be let in' : 'Opens the chat'}
              testID="chats.room"
            />
          )
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: touchTarget },
  topActions: { flexDirection: 'row', gap: spacing.sm },
  iconBtn: { width: touchTarget, height: touchTarget, borderRadius: touchTarget / 2, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.xs, marginBottom: spacing.lg },
  sub: { flex: 1 },
  err: { marginBottom: spacing.md },
  list: { flex: 1, marginHorizontal: -spacing.gutter },
  listBody: { paddingBottom: spacing.lg },
  listEmpty: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  empty: { alignItems: 'center', gap: spacing.lg, padding: spacing.xl, marginHorizontal: spacing.gutter, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  pendingRow: { marginHorizontal: spacing.gutter, marginVertical: spacing.xs, borderRadius: radii.lg, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.ghostBorder },
  actions: { flexDirection: 'row', gap: spacing.sm },
  secretBtn: { flex: 1 },
  newBtn: { flex: 1.4 },
});
