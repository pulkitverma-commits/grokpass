// Conversation (designs 05/06). Mirrors the web room page (app/chat/r/[id]/page.tsx): first sync,
// Realtime pings and a poll fallback, the owner's admit/remove duties, hold-to-read in Secret rooms,
// per-message timers, replies, encrypted files with view-once, screenshot notices, and the room
// menu. Every byte goes through the core; this screen never sees a key or a ciphertext.
//
// What never leaves this screen: message text stays in component state and in the bubbles that
// show it; it is not put in navigation params, accessibility labels, errors or logs.
import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, FlatList, Platform, Pressable, StyleSheet, View } from 'react-native';
import { onScreenshot, shortDeviceCode, useScreenshotAlert, useSecureScreen, useSecurity, Watermark, SCREENSHOT_NOTICE_MINE, screenshotNoticeTheirs } from '@/security';
import { Avatar } from '../../components/Avatar';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { useChat } from '../../components/ChatProvider';
import { Icon } from '../../components/Icon';
import { Notice } from '../../components/Notice';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { AttachSheet } from '../../components/room/AttachSheet';
import { Composer } from '../../components/room/Composer';
import { FileViewer, type Opened } from '../../components/room/FileViewer';
import { MessageBubble, type BubbleMessage } from '../../components/room/MessageBubble';
import { RoomMenu, type Member, type MenuRoom, type MenuView } from '../../components/room/RoomMenu';
import { Sheet } from '../../components/Sheet';
import { Segmented } from '../../components/Segmented';
import { colors, radii, spacing, touchTarget } from '../../theme';
import { MAX_ATTACHMENT_BYTES, pickDocument, pickPhoto, fileSource, type Picked } from '@/lib/files';
import { KIND_SHORT, TIMERS, errorCode, friendlyError, keyChanged, memberName, roomTitle, ttlLabel } from '@/lib/format';
import type { LocalMessage } from '@onepeek/core';

type Msg = LocalMessage;
type Row = { t: 'msg'; m: Msg } | { t: 'alert'; m: Msg };

const FAST_POLL_MS = 4000;
const SLOW_POLL_MS = 15000;

// Honest per-platform copy (Android blocks screenshots with FLAG_SECURE; iOS can only report them).
const SHOT_LINE = Platform.select({ android: 'Screenshots are blocked on this phone.', default: 'Screenshots are flagged to everyone in the chat.' });
const INTRO_SECRET = `Press and hold a message to read it. ${SHOT_LINE} No app can stop a camera, so share carefully.`;
const INTRO_QUICK = `Messages are encrypted on each device and disappear on a timer. ${SHOT_LINE}`;

/** Runs `fn` one at a time; calls made while it runs collapse into one more run afterwards (the web's useCoalesced). */
function useCoalesced(fn: () => Promise<void>) {
  const running = useRef(false);
  const again = useRef(false);
  const latest = useRef(fn);
  useEffect(() => { latest.current = fn; });
  return useCallback(async () => {
    if (running.current) { again.current = true; return; }
    running.current = true;
    try {
      do { again.current = false; await latest.current(); } while (again.current);
    } finally { running.current = false; }
  }, []);
}

export default function RoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const roomId = String(id ?? '');
  const router = useRouter();
  const { chat, guard } = useChat();
  const { inactive } = useSecurity();
  useSecureScreen(`room:${roomId}`);

  const [room, setRoom] = useState<MenuRoom | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [me, setMe] = useState('');
  const [joined, setJoined] = useState(false);
  const [synced, setSynced] = useState(false);
  const [ended, setEnded] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [ttl, setTtl] = useState(60);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [err, setErr] = useState('');
  const [menu, setMenu] = useState<MenuView>(null);
  const [timerOpen, setTimerOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [attachErr, setAttachErr] = useState('');
  const [fileBusy, setFileBusy] = useState<string | null>(null);
  const [viewer, setViewer] = useState<Opened | 'gone' | null>(null);
  const outgoing = useRef(new Map<string, Msg>());
  const roomTtl = useRef<number | null>(null);
  const list = useRef<FlatList<Row>>(null);

  const secret = room?.kind === 'secret';
  useScreenshotAlert(joined && !ended ? roomId : null, room?.ttl ?? ttl);

  /** Stored messages plus any still on their way out. */
  const showStored = useCallback(async () => {
    const stored = (await chat().messages(roomId)) as Msg[];
    const ids = new Set(stored.map((m) => m.id));
    for (const k of Array.from(outgoing.current.keys())) if (ids.has(k)) outgoing.current.delete(k);
    setMsgs([...stored, ...Array.from(outgoing.current.values())]);
  }, [chat, roomId]);

  const leaveToChats = useCallback(() => { router.replace('/'); }, [router]);

  const refreshOnce = useCallback(async () => {
    try {
      const r = await guard(() => chat().sync(roomId));
      if (r.removed) { setEnded((e) => e ?? 'This chat has ended, or you were removed.'); return; }
      const rooms = await chat().myRooms();
      const current = rooms.find((x) => x.id === roomId) ?? null;
      if (!current) { setEnded((e) => e ?? 'This chat has ended.'); await chat().forgetRoom(roomId); return; }
      setRoom(current);
      // The composer follows the room default whenever the default itself changes (as on the web).
      if (roomTtl.current !== current.ttl) { roomTtl.current = current.ttl; setTtl(current.ttl); }
      setJoined(current.memberState === 'active' && !!(await chat().keystore.get(`room:${roomId}:state`)));
      setSynced(true);
      if (current.role === 'owner') {
        // The owner's device keeps the group in step: admit joiners (Business rooms wait for approval)
        // and cryptographically remove anyone the server has already removed. Same condition as the web.
        if (current.kind !== 'business') await chat().admitPending(roomId);
        await chat().commitRemovals(roomId);
      }
      setMembers(await chat().members(roomId));
      await showStored();
    } catch (e) {
      if (errorCode(e) === 'not_signed_in') router.replace('/welcome');
    }
  }, [chat, guard, roomId, router, showStored]);
  const refresh = useCoalesced(refreshOnce);

  const pullOnce = useCallback(async () => {
    try {
      const r = await guard(() => chat().sync(roomId));
      if (r.removed) { setEnded((e) => e ?? 'This chat has ended, or you were removed.'); return; }
      if (r.newMessages || r.newAlerts || r.joined) await showStored();
      if (r.joined) void refresh();
    } catch (e) {
      if (errorCode(e) === 'not_signed_in') router.replace('/welcome');
    }
  }, [chat, guard, roomId, router, showStored, refresh]);
  const pull = useCoalesced(pullOnce);

  // First load, Realtime pings, polling fallback, foreground refresh, and the clock.
  useEffect(() => {
    let alive = true;
    chat().ensureDevice().then((d) => alive && setMe(d.id)).catch(() => {});
    void refresh();
    const off = chat().subscribe(roomId, (event: string) => {
      if (event === 'burned') { setEnded((e) => e ?? 'The owner burned this chat.'); chat().forgetRoom(roomId).catch(() => {}); return; }
      if (event === 'msg') void pull(); else void refresh();
    });
    const active = () => AppState.currentState === 'active';
    const fast = setInterval(() => { if (active()) void pull(); }, FAST_POLL_MS);
    const slow = setInterval(() => { if (active()) void refresh(); }, SLOW_POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void pull(); });
    return () => { alive = false; off(); clearInterval(fast); clearInterval(slow); clearInterval(tick); sub.remove(); };
  }, [chat, roomId, refresh, pull]);

  // Anything held lets go when a screenshot is taken; while the app is inactive nothing counts as held.
  useEffect(() => onScreenshot(() => setHeld(null)), []);
  const heldNow = inactive ? null : held;

  // Expired messages leave the screen (filtered out of `live`) and the device (dropMessage); the
  // state list is pruned by the next showStored().
  const live = useMemo(() => msgs.filter((m) => m.expiresAt === null || m.expiresAt > now), [msgs, now]);
  const deadKey = msgs.filter((m) => m.expiresAt !== null && m.expiresAt <= now).map((m) => m.id).join(',');
  useEffect(() => {
    if (!deadKey) return;
    for (const mid of deadKey.split(',')) chat().dropMessage(roomId, mid).catch(() => {});
  }, [deadKey, roomId, chat]);
  const byId = useMemo(() => new Map(live.map((m) => [m.id, m])), [live]);
  const rows = useMemo<Row[]>(() => live.map((m) => (m.alert ? { t: 'alert', m } : { t: 'msg', m })), [live]);

  /** Starts the recipient-side countdown (first hold in Secret rooms; on screen elsewhere). */
  const open = useCallback(async (m: Msg) => {
    if (m.mine || m.expiresAt !== null || inactive) return;
    try {
      const opened = (await chat().markOpened(roomId, m)) as Msg;
      setMsgs((cur) => cur.map((x) => (x.id === m.id ? opened : x)));
    } catch { /* retried on the next hold */ }
  }, [chat, roomId, inactive]);

  // Quick and Business rooms count a message as read once it is on screen; Secret rooms on hold.
  const unreadKey = live.filter((m) => !m.mine && !m.alert && m.expiresAt === null).map((m) => m.id).join(',');
  useEffect(() => {
    if (!room || secret || inactive || !unreadKey) return;
    const t = setTimeout(() => { for (const m of live) if (!m.mine && !m.alert && m.expiresAt === null) void open(m); }, 0);
    return () => clearTimeout(t);
  }, [room, secret, inactive, unreadKey, live, open]);

  const hold = useCallback((m: BubbleMessage) => {
    if (inactive) return;
    setHeld(m.id);
    const full = byId.get(m.id);
    if (full && full.expiresAt === null) void open(full);
  }, [inactive, open, byId]);
  const release = useCallback(() => setHeld(null), []);

  async function send() {
    const body = text.trim();
    if (!body || !joined) return;
    setErr('');
    const reply = replyTo;
    const msgId = Crypto.randomUUID();
    const draft: Msg = { id: msgId, seq: Number.MAX_SAFE_INTEGER, mine: true, sender: me, body, ttl, sentAt: Date.now(), expiresAt: null, replyTo: reply?.id, pending: true };
    outgoing.current.set(msgId, draft);
    setMsgs((cur) => [...cur, draft]);
    setText(''); setReplyTo(null);
    try {
      const m = (await guard(() => chat().send(roomId, body, ttl, reply?.id, msgId))) as Msg | undefined;
      outgoing.current.delete(msgId);
      if (m) setMsgs((cur) => (cur.some((x) => x.id === msgId) ? cur.map((x) => (x.id === msgId ? m : x)) : [...cur, m]));
      void chat().notifyRoom(roomId);
    } catch (e) {
      outgoing.current.delete(msgId);
      setMsgs((cur) => cur.filter((x) => x.id !== msgId));
      setText((t) => t || body);
      setReplyTo((r) => r ?? reply);
      setErr(friendlyError(errorCode(e)));
    }
  }

  async function pick(kind: 'photo' | 'file') {
    setAttachErr('');
    try {
      const p = kind === 'photo' ? await pickPhoto() : await pickDocument();
      if (!p) return;
      if (p.size > MAX_ATTACHMENT_BYTES) { setAttachErr('Files can be up to 50 MB.'); return; }
      setPicked(p);
    } catch { setAttachErr('Couldn’t open the picker.'); }
  }

  async function sendPicked(viewOnce: boolean) {
    if (!picked) return;
    const p = picked;
    setAttachOpen(false); setPicked(null); setErr(''); setFileBusy('sending');
    try {
      const m = (await guard(() => chat().sendFile(roomId, fileSource(p), ttl, viewOnce))) as Msg;
      setMsgs((cur) => [...cur, m]);
      void chat().notifyRoom(roomId);
    } catch (e) {
      setErr(friendlyError(errorCode(e)));
    } finally { setFileBusy(null); }
  }

  async function openFile(bm: BubbleMessage) {
    const m = byId.get(bm.id);
    if (!m?.file || fileBusy) return;
    if (m.file.viewOnce && m.viewed) { setViewer('gone'); return; }
    setErr(''); setFileBusy(m.id);
    if (secret && !m.mine && m.expiresAt === null) void open(m);
    try {
      const got = await guard(() => chat().openFile(roomId, m));
      const f = m.file;
      if (f.viewOnce) {
        await chat().markViewed(roomId, m).catch(() => {});
        setMsgs((cur) => cur.map((x) => (x.id === m.id ? { ...x, viewed: true } : x)));
      }
      setViewer({ bytes: got.bytes, mime: got.mime, name: f.name, size: f.size, viewOnce: f.viewOnce });
    } catch (e) {
      const code = errorCode(e);
      if (code === 'gone' && m.file.viewOnce) {
        setMsgs((cur) => cur.map((x) => (x.id === m.id ? { ...x, viewed: true } : x)));
        setViewer('gone');
      } else setErr(friendlyError(code));
    } finally { setFileBusy(null); }
  }

  const nameOf = useCallback((device: string) => {
    if (device === me) return 'You';
    const m = members.find((x) => x.deviceId === device);
    return memberName(m?.nickname, device);
  }, [me, members]);

  const title = room ? roomTitle(room) : '…';
  const myName = members.find((x) => x.deviceId === me)?.nickname || `Device ${me ? shortDeviceCode(me) : '…'}`;
  const deviceCode = me ? shortDeviceCode(me) : '';
  const activeCount = members.filter((m) => m.state === 'active').length;
  const holding = heldNow !== null || (viewer !== null && viewer !== 'gone');

  if (ended) {
    return (
      <Screen testID="room.screen">
        <View style={styles.ended} testID="room.ended">
          <Icon name="flame" size={32} color={colors.muted} />
          <Text variant="h2" tone="heading" center accessibilityRole="header">{ended}</Text>
          <Text variant="sub" tone="muted" center>Its keys and messages have been removed from this device.</Text>
          <Button title="Back to chats" onPress={leaveToChats} block={false} testID="room.back" />
        </View>
      </Screen>
    );
  }

  const header = (
    <View style={styles.head}>
      <Pressable onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/'); }} accessibilityRole="button" accessibilityLabel="Back to chats" hitSlop={8} style={styles.headBtn} testID="room.back">
        <Icon name="chevronLeft" size={24} color={colors.text} />
      </Pressable>
      <Avatar icon={secret ? 'lock' : room?.kind === 'business' ? 'shield' : 'clock'} accent={secret} size={40} />
      <View style={styles.headMain}>
        <View style={styles.titleRow}>
          <Text variant="title" tone="heading" numberOfLines={1} style={styles.title} accessibilityRole="header" testID="room.title">{title}</Text>
          {room ? <Badge label={KIND_SHORT[room.kind]} tone={secret ? 'secure' : 'neutral'} /> : null}
        </View>
        <View style={styles.secureRow}>
          <Icon name="lock" size={12} color={colors.secure} />
          <Text variant="meta" tone="secure" numberOfLines={1}>Encrypted · {ttlLabel(room?.ttl ?? ttl)} {room?.mode === 'on_send' ? 'after sending' : 'after reading'}{activeCount ? ` · ${activeCount} in chat` : ''}</Text>
        </View>
      </View>
      <Pressable onPress={() => setMenu('menu')} disabled={!room} accessibilityRole="button" accessibilityLabel="Room menu" hitSlop={8} style={styles.headBtn} testID="room.menu">
        <Icon name="more" size={24} color={colors.text} />
      </Pressable>
    </View>
  );

  return (
    <Screen testID="room.screen" padded={false} header={header}>
      <View style={styles.listWrap}>
        <FlatList
          ref={list}
          data={rows}
          keyExtractor={(r) => r.m.id}
          contentContainerStyle={styles.listBody}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
          ListHeaderComponent={
            <View style={styles.intro}>
              <Text variant="meta" tone="muted" center style={styles.introBox}>{secret ? INTRO_SECRET : INTRO_QUICK}</Text>
              {members.filter((m) => m.state === 'active' && keyChanged(m)).map((m) => (
                <Pressable key={m.deviceId} onPress={() => setMenu('verify')} accessibilityRole="button" style={styles.introBox}>
                  <Text variant="meta" tone="danger" center>{nameOf(m.deviceId)}’s security key changed. Verify again.</Text>
                </Pressable>
              ))}
              {synced && !joined ? <Text variant="meta" tone="muted" center style={styles.introBox} testID="room.waiting">Waiting for the owner to let you in. Messages will appear once you’re admitted.</Text> : null}
            </View>
          }
          renderItem={({ item }) => item.t === 'alert' ? (
            <View style={styles.alert} accessibilityLiveRegion="polite" testID="room.notice">
              <Icon name="eye" size={14} color={colors.danger} />
              <Text variant="meta" tone="danger">{item.m.mine ? SCREENSHOT_NOTICE_MINE : screenshotNoticeTheirs(nameOf(item.m.sender))}</Text>
            </View>
          ) : (
            <MessageBubble
              m={item.m}
              parent={item.m.replyTo ? byId.get(item.m.replyTo) : undefined}
              secret={!!secret}
              held={heldNow === item.m.id}
              now={now}
              senderName={nameOf(item.m.sender)}
              fileBusy={fileBusy === item.m.id}
              onHoldStart={hold}
              onHoldEnd={release}
              onOpenFile={openFile}
              onReply={(m) => setReplyTo(byId.get(m.id) ?? null)}
            />
          )}
        />
        {secret && holding && me ? <Watermark viewerName={myName} deviceCode={deviceCode} /> : null}
      </View>
      {fileBusy === 'sending' ? <Text variant="meta" tone="muted" center style={styles.sending} accessibilityLiveRegion="polite">Encrypting and sending the file…</Text> : null}
      {err ? <View style={styles.err}><Notice tone="error" text={err} testID="room.error" /></View> : null}
      <Composer
        text={text}
        onChangeText={setText}
        onSend={send}
        onAttach={() => { setAttachErr(''); setPicked(null); setAttachOpen(true); }}
        onTimer={() => setTimerOpen(true)}
        ttl={ttl}
        joined={joined}
        synced={synced}
        busy={fileBusy === 'sending'}
        replyPreview={replyTo ? (replyTo.file ? (secret ? 'File' : replyTo.file.name) : replyTo.body.slice(0, 40)) : null}
        onCancelReply={() => setReplyTo(null)}
      />

      <Sheet open={timerOpen} onClose={() => setTimerOpen(false)} title="Message timer" testID="room.timerSheet">
        <Segmented label="Message timer" value={ttl} onChange={(v) => { setTtl(v); setTimerOpen(false); }} testID="room.timer.options" options={TIMERS.map((t) => ({ value: t.s, label: t.label, testID: `room.timer.${t.s}` }))} />
        <Text variant="meta" tone="muted" style={styles.timerHint}>Applies to the next messages you send. The room default is in the menu.</Text>
      </Sheet>

      <AttachSheet open={attachOpen} onClose={() => { setAttachOpen(false); setPicked(null); }} secret={!!secret} ttl={ttl} picked={picked} error={attachErr} onPickPhoto={() => pick('photo')} onPickFile={() => pick('file')} onSend={sendPicked} />

      <FileViewer item={viewer} secret={!!secret} viewerName={myName} deviceCode={deviceCode} onClose={() => setViewer(null)} />

      {room ? (
        <RoomMenu view={menu} setView={setMenu} room={room} title={title} members={members} me={me} ttl={ttl} setTtl={setTtl} onChange={() => { void refresh(); }} onGone={() => { setMenu(null); leaveToChats(); }} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, minHeight: touchTarget + 8 },
  headBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  headMain: { flex: 1, minWidth: 0, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flexShrink: 1 },
  secureRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  listWrap: { flex: 1, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, overflow: 'hidden' },
  listBody: { paddingHorizontal: spacing.gutter, paddingTop: spacing.md, paddingBottom: spacing.lg },
  intro: { gap: spacing.sm, marginBottom: spacing.sm },
  introBox: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surface },
  alert: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, marginVertical: 6, borderRadius: radii.pill, backgroundColor: colors.dangerSoft },
  sending: { paddingVertical: 4 },
  err: { paddingHorizontal: spacing.gutter, paddingBottom: spacing.sm },
  timerHint: { marginTop: spacing.sm, marginHorizontal: spacing.xs },
  ended: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
});
