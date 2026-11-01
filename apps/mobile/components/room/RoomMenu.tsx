// Room menu sheet and its sub-views (U7): members (let in / remove), invite (options, existing
// invites, revoke), safety number with QR and "mark verified", message timer and room default,
// rename (owner, local only), Panic Exit, leave and burn with confirmation. Wording is the web's
// room page. All data goes through the core client; nothing here reads message content.
// Phase 2: block a member on this phone (a local list in the keystore; the room screen hides their
// messages here, nothing is sent and they are not told), report the chat (ids only, lib/report),
// and scan the other person's safety-number QR from Verify people.
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSecurity } from '@/security';
import { colors, radii, spacing } from '../../theme';
import { Button } from '../Button';
import { useChat } from '../ChatProvider';
import { Field } from '../Field';
import { Icon, type IconName } from '../Icon';
import { InviteSheet } from '../InviteSheet';
import { ListRow } from '../ListRow';
import { Notice } from '../Notice';
import { SectionLabel } from '../SectionLabel';
import { Segmented } from '../Segmented';
import { Sheet } from '../Sheet';
import { Text } from '../Text';
import { KEY_HISTORY_NOTE, KIND_NAME, LIFETIMES, TIMERS, UNLISTED_NOTE, countdown, errorCode, friendlyError, keyChanged, memberName, readersLine, readersOf, ttlLabel, verifyHint } from '@/lib/format';
import { REPORT_REASONS, reportRoom, type ReportReason } from '@/lib/report';

export type MenuView = null | 'menu' | 'members' | 'invite' | 'verify' | 'timer' | 'rename' | 'leave' | 'burn' | 'report';

/** Keystore key of this phone's block list for a room: an array of device ids. Local to this phone. */
export const blockedKey = (roomId: string) => `room:${roomId}:blocked`;

export type Member = {
  deviceId: string; role: 'owner' | 'member'; state: 'pending' | 'active';
  signaturePub: Uint8Array; hasKeyPackage: boolean; nickname: string | null; verified: string | null;
  keyMismatch?: boolean; keyHistory?: boolean; inGroup?: boolean; unlisted?: boolean;
};

export type MenuRoom = { id: string; kind: 'quick' | 'secret' | 'business'; role: 'owner' | 'member'; ttl: number; mode: 'on_open' | 'on_send'; expiresAt: string; name: string | null; ownerPinned?: boolean };

type Props = {
  view: MenuView;
  setView: (v: MenuView) => void;
  room: MenuRoom;
  title: string;
  members: Member[];
  me: string;
  ttl: number;
  setTtl: (n: number) => void;
  /** Device ids blocked on this phone (from the keystore); the room screen hides their messages. */
  blocked?: string[];
  /** Re-syncs room, members and messages after a change. */
  onChange: () => void;
  /** After leave or burn succeeded: the room is gone from this device. */
  onGone: () => void;
};

const MENU_TITLE: Record<Exclude<MenuView, null>, string> = {
  menu: '', members: 'Room details', invite: 'Invite someone', verify: 'Verify people', timer: 'Message timer', rename: 'Name this chat', leave: 'Leave this chat?', burn: 'Burn this chat?', report: 'Report this chat',
};

export function RoomMenu({ view, setView, room, title, members, me, ttl, setTtl, blocked = [], onChange, onGone }: Props) {
  const isOwner = room.role === 'owner';
  const active = members.filter((m) => m.state === 'active');
  const close = () => setView(null);
  return (
    <Sheet open={view !== null} onClose={close} title={view ? MENU_TITLE[view] || title : undefined} testID="room.menuSheet">
      {view === 'menu' ? <Menu room={room} isOwner={isOwner} activeCount={active.length} setView={setView} /> : null}
      {view === 'members' ? <Members room={room} members={members} me={me} isOwner={isOwner} blocked={blocked} onChange={onChange} /> : null}
      {view === 'report' ? <Report room={room} onDone={close} /> : null}
      {view === 'invite' ? <Invite room={room} /> : null}
      {view === 'verify' ? <Verify roomId={room.id} members={active.filter((m) => m.deviceId !== me)} readers={readersOf(members)} ownerPinned={room.ownerPinned === true} onChange={onChange} onClose={close} /> : null}
      {view === 'timer' ? <Timer room={room} ttl={ttl} setTtl={setTtl} isOwner={isOwner} onSaved={() => { onChange(); close(); }} /> : null}
      {view === 'rename' ? <Rename room={room} onSaved={() => { onChange(); close(); }} /> : null}
      {view === 'leave' ? (
        <Confirm
          body="You’ll stop receiving messages and this device forgets the chat’s keys. You’ll need a new invite to come back."
          danger="Leave"
          confirmTestID="room.leave.confirm"
          run={(chat) => chat.leave(room.id)}
          onDone={onGone}
          onCancel={() => setView('menu')}
        />
      ) : null}
      {view === 'burn' ? (
        <Confirm
          body="Every message, invite and file is deleted from OnePeek’s servers now, everyone loses access, and this device forgets its keys. Copies someone already saved or photographed can’t be recalled."
          danger="Burn chat"
          confirmTestID="room.burn.confirm"
          run={(chat) => chat.burn(room.id)}
          onDone={onGone}
          onCancel={() => setView('menu')}
        />
      ) : null}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------- menu

function Item({ icon, title, sub, onPress, tone, testID }: { icon: IconName; title: string; sub?: string; onPress: () => void; tone?: 'text' | 'danger'; testID?: string }) {
  return <ListRow leading={<Icon name={icon} size={20} color={tone === 'danger' ? colors.danger : colors.text} />} title={title} subtitle={sub} onPress={onPress} tone={tone} chevron testID={testID} />;
}

function Menu({ room, isOwner, activeCount, setView }: { room: MenuRoom; isOwner: boolean; activeCount: number; setView: (v: MenuView) => void }) {
  const { panic } = useSecurity();
  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Item icon="clock" title="Message timer" sub={`${ttlLabel(room.ttl)} ${room.mode === 'on_send' ? 'after sending' : 'after reading'}`} onPress={() => setView('timer')} testID="room.menu.timer" />
        {isOwner || room.kind === 'quick' ? <Item icon="user" title="Invite someone" onPress={() => setView('invite')} testID="room.menu.invite" /> : null}
        <Item icon="shield" title="Verify people" sub="Compare safety numbers" onPress={() => setView('verify')} testID="room.menu.verify" />
        <Item icon="eye" title="Room details" sub={`${activeCount} in chat`} onPress={() => setView('members')} testID="room.menu.members" />
        {isOwner ? <Item icon="key" title="Name this chat" sub="Only on your device" onPress={() => setView('rename')} testID="room.menu.rename" /> : null}
      </View>
      <View style={styles.card}>
        <Item icon="lock" title="Panic Exit" sub="Locks this device" onPress={panic} testID="room.panic" />
        <Item icon="alert" title="Report chat" sub="Sends only the chat’s id, never messages" onPress={() => setView('report')} testID="room.menu.report" />
        {isOwner
          ? <Item icon="flame" title="Burn chat" tone="danger" onPress={() => setView('burn')} testID="room.burn" />
          : <Item icon="ban" title="Leave chat" tone="danger" onPress={() => setView('leave')} testID="room.leave" />}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------- members

function Members({ room, members, me, isOwner, blocked, onChange }: { room: MenuRoom; members: Member[]; me: string; isOwner: boolean; blocked: string[]; onChange: () => void }) {
  const { chat, guard } = useChat();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Member | null>(null);
  const [confirmBlock, setConfirmBlock] = useState<Member | null>(null);

  /** Toggles a device on this phone's block list (keystore only; nothing leaves the phone). */
  function toggleBlock(m: Member) {
    const next = blocked.includes(m.deviceId) ? blocked.filter((d) => d !== m.deviceId) : [...blocked, m.deviceId];
    return run(m.deviceId, () => chat().keystore.put(blockedKey(room.id), next));
  }
  const [err, setErr] = useState('');
  const [now] = useState(() => Date.now());
  const pending = members.filter((m) => m.state === 'pending');
  const active = members.filter((m) => m.state === 'active');

  async function run(id: string, work: () => Promise<unknown>) {
    setBusy(id); setErr('');
    try { await guard(work); onChange(); }
    catch (e) { setErr(friendlyError(errorCode(e))); }
    finally { setBusy(null); setConfirmRemove(null); }
  }

  return (
    <View style={styles.stack}>
      <Text variant="meta" tone="muted" style={styles.hint}>
        {KIND_NAME[room.kind]} · ends in {countdown(new Date(room.expiresAt).getTime() - now)} · messages {ttlLabel(room.ttl)} {room.mode === 'on_send' ? 'after sending' : 'after reading'}
      </Text>
      {pending.length > 0 && isOwner ? (
        <>
          <SectionLabel>Waiting to join</SectionLabel>
          <View style={styles.card}>
            {pending.map((m) => (
              <ListRow key={m.deviceId} leading={<Icon name="user" size={20} color={colors.muted} />} title={memberName(m.nickname, m.deviceId)} subtitle="Used your invite"
                trailing={<Button title="Let in" small block={false} busy={busy === m.deviceId} onPress={() => run(m.deviceId, () => chat().admitPending(room.id, [m.deviceId]))} testID="members.letIn" />} testID="members.pending" />
            ))}
          </View>
        </>
      ) : null}
      <SectionLabel>In this chat</SectionLabel>
      <View style={styles.card}>
        {active.map((m) => {
          const changed = keyChanged(m);
          const name = memberName(m.nickname, m.deviceId) + (m.deviceId === me ? ' (you)' : '') + (m.role === 'owner' ? ' · owner' : '');
          const isBlocked = blocked.includes(m.deviceId);
          const status = isBlocked ? 'Blocked on this phone' : m.keyMismatch ? 'Key mismatch' : m.unlisted ? UNLISTED_NOTE : changed ? 'Key changed' : m.verified ? 'Verified' : 'Not verified';
          const who = memberName(m.nickname, m.deviceId);
          return (
            <ListRow key={m.deviceId} leading={<Icon name={isBlocked ? 'ban' : m.verified && !changed ? 'check' : 'user'} size={20} color={isBlocked || changed ? colors.danger : m.verified ? colors.secure : colors.muted} />}
              title={name} subtitle={`${status} · device ${memberName(null, m.deviceId).slice(6)}`} testID="members.row"
              trailing={m.deviceId !== me ? (
                <View style={styles.rowBtns}>
                  {isBlocked
                    ? <Button title="Unblock" small variant="ghost" block={false} busy={busy === m.deviceId} onPress={() => toggleBlock(m)} accessibilityLabel={`Unblock ${who}`} testID="members.unblock" />
                    : <Button title="Block" small variant="ghost" block={false} busy={busy === m.deviceId} onPress={() => setConfirmBlock(m)} accessibilityLabel={`Block ${who}`} testID="members.block" />}
                  {isOwner ? <Button title="Remove" small variant="ghost" block={false} busy={busy === m.deviceId} onPress={() => setConfirmRemove(m)} accessibilityLabel={`Remove ${who}`} testID="members.remove" /> : null}
                </View>
              ) : undefined} />
          );
        })}
      </View>
      {confirmRemove ? (
        <View style={styles.confirmBox} testID="members.remove.confirm">
          <Text variant="sub">Remove {memberName(confirmRemove.nickname, confirmRemove.deviceId)}? They lose access to new messages immediately.</Text>
          <View style={styles.rowBtns}>
            <Button title="Remove" variant="destructive" small block={false} style={styles.flex} busy={busy === confirmRemove.deviceId} onPress={() => run(confirmRemove.deviceId, () => chat().removeMember(room.id, confirmRemove.deviceId))} testID="members.remove.yes" />
            <Button title="Keep" variant="ghost" small block={false} style={styles.flex} onPress={() => setConfirmRemove(null)} testID="members.remove.no" />
          </View>
        </View>
      ) : null}
      {confirmBlock ? (
        <View style={styles.confirmBox} testID="members.block.confirm">
          <Text variant="sub">Block {memberName(confirmBlock.nickname, confirmBlock.deviceId)} on this phone? Their messages are hidden here only. They stay in the chat, keep seeing it, and aren’t told.{isOwner ? ' To take them out of the chat for everyone, use Remove.' : ''}</Text>
          <View style={styles.rowBtns}>
            <Button title="Block" variant="destructive" small block={false} style={styles.flex} busy={busy === confirmBlock.deviceId} onPress={() => { const m = confirmBlock; setConfirmBlock(null); void toggleBlock(m); }} testID="members.block.yes" />
            <Button title="Keep" variant="ghost" small block={false} style={styles.flex} onPress={() => setConfirmBlock(null)} testID="members.block.no" />
          </View>
        </View>
      ) : null}
      {err ? <Notice tone="error" text={err} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------- report

function Report({ room, onDone }: { room: MenuRoom; onDone: () => void }) {
  const [reason, setReason] = useState<ReportReason>('spam');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  return (
    <View style={styles.stack}>
      <Text variant="sub" tone="muted">Tell OnePeek this chat needs a look. Only the chat’s id and your reason are sent: no messages, names or files, which OnePeek can’t read anyway.</Text>
      <Segmented label="Reason" value={reason} onChange={setReason} testID="report.reason" options={REPORT_REASONS.map((r) => ({ value: r.value, label: r.label, testID: `report.reason.${r.value}` }))} />
      {sent ? (
        <Notice tone="success" icon="check" text="Thanks. The report has been sent." testID="report.sent" />
      ) : (
        <Button title={busy ? 'Sending…' : 'Send report'} busy={busy} style={styles.topGap} onPress={async () => {
          setBusy(true); setErr('');
          try { await reportRoom(room.id, reason); setSent(true); }
          catch (e) { setErr(friendlyError(errorCode(e))); }
          finally { setBusy(false); }
        }} testID="report.send" />
      )}
      {err ? <Notice tone="error" text={err} testID="report.error" /> : null}
      <Button title={sent ? 'Done' : 'Cancel'} variant="ghost" disabled={busy} onPress={onDone} testID="report.done" />
    </View>
  );
}

// ---------------------------------------------------------------------------- invite

type InviteRow = { id: string; expires_at: string; max_uses: number; uses: number; requires_approval: boolean; revoked_at: string | null };

function Invite({ room }: { room: MenuRoom }) {
  const { chat, guard } = useChat();
  const [expires, setExpires] = useState(86400);
  const [uses, setUses] = useState(1);
  const [link, setLink] = useState('');
  const [invites, setInvites] = useState<{ rows: InviteRow[]; at: number }>({ rows: [], at: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(() => { chat().listInvites(room.id).then((rows) => setInvites({ rows, at: Date.now() })).catch(() => {}); }, [chat, room.id]);
  useEffect(() => { load(); }, [load]);

  async function make() {
    setBusy(true); setErr('');
    try {
      const r = await guard(() => chat().createInvite(room.id, { expiresIn: expires, maxUses: uses, approval: room.kind === 'business' }));
      setLink(r.link); load();
    } catch (e) { setErr(friendlyError(errorCode(e))); }
    finally { setBusy(false); }
  }

  const live = invites.rows.filter((i) => !i.revoked_at && new Date(i.expires_at).getTime() > invites.at);
  return (
    <View style={styles.stack}>
      <Text variant="meta" tone="muted" style={styles.hint}>Link works for</Text>
      <Segmented label="Link works for" value={expires} onChange={setExpires} testID="invite.expires" options={LIFETIMES.map((l) => ({ value: l.s, label: l.label, testID: `invite.expires.${l.s}` }))} />
      <Text variant="meta" tone="muted" style={styles.hint}>Can be used</Text>
      <Segmented label="Can be used" value={uses} onChange={setUses} testID="invite.uses" options={[1, 5, 20].map((n) => ({ value: n, label: n === 1 ? 'once' : `${n} times`, testID: `invite.uses.${n}` }))} />
      {room.kind === 'business' ? <Text variant="meta" tone="muted" style={styles.hint}>You’ll approve each person before they can read anything.</Text> : null}
      <Button title={busy ? 'Creating…' : 'Create invite link'} busy={busy} onPress={make} style={styles.topGap} testID="invite.create" />
      {err ? <Notice tone="error" text={err} /> : null}
      {live.length ? (
        <>
          <SectionLabel>Active invites</SectionLabel>
          <View style={styles.card}>
            {live.map((i) => (
              <ListRow key={i.id} leading={<Icon name="link" size={20} color={colors.muted} />} title={`${i.uses}/${i.max_uses} used · ends in ${countdown(new Date(i.expires_at).getTime() - invites.at)}`} testID="invite.row"
                trailing={<Button title="Revoke" small variant="ghost" block={false} onPress={() => chat().revokeInvite(i.id).then(load).catch(() => setErr('Couldn’t revoke that invite.'))} testID="invite.revoke" />} />
            ))}
          </View>
        </>
      ) : null}
      {link ? <InviteSheet open link={link} kind={room.kind} expiresLabel={LIFETIMES.find((l) => l.s === expires)?.label ?? '1 day'} usesLabel={uses === 1 ? 'once' : `${uses} times`} onDone={() => setLink('')} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------- verify (safety number)

function Verify({ roomId, members, readers, ownerPinned, onChange, onClose }: { roomId: string; members: Member[]; readers: number; ownerPinned: boolean; onChange: () => void; onClose: () => void }) {
  const { chat, guard } = useChat();
  const router = useRouter();
  const [who, setWho] = useState<Member | null>(members.length === 1 ? members[0]! : null);
  const [num, setNum] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function select(m: Member | null) { setWho(m); setNum(''); setErr(''); }
  useEffect(() => {
    if (!who) return;
    let alive = true;
    chat().safetyNumberWith(roomId, who.deviceId).then((n) => alive && setNum(n))
      .catch((e) => alive && setErr(errorCode(e) === 'member_key_mismatch' ? friendlyError('member_key_mismatch') : 'The safety number couldn’t be calculated.'));
    return () => { alive = false; };
  }, [who, roomId, chat]);

  if (!members.length) return <Text variant="sub" tone="muted">Nobody else is in this chat yet.</Text>;
  if (!who) {
    return (
      <View style={styles.card}>
        {members.map((m) => (
          <ListRow key={m.deviceId} leading={<Icon name="shield" size={20} color={colors.muted} />} title={memberName(m.nickname, m.deviceId)}
            subtitle={m.keyMismatch ? 'Key mismatch' : m.unlisted ? 'Not listed by the server' : m.verified ? (keyChanged(m) ? 'Key changed' : 'Verified') : 'Not verified'} chevron onPress={() => select(m)} testID="verify.member" />
        ))}
      </View>
    );
  }
  const groups = num.match(/.{1,5}/g) ?? [];
  const name = memberName(who.nickname, who.deviceId);
  return (
    <View style={styles.stack}>
      <Text variant="title" tone="heading">Verify {name}</Text>
      <Text variant="sub" tone="muted">{verifyHint(name, ownerPinned)}</Text>
      {who.unlisted ? <Notice tone="error" text={`${UNLISTED_NOTE}.`} /> : null}
      {who.keyHistory ? <Notice tone="info" text={KEY_HISTORY_NOTE} /> : null}
      {num ? (
        <View style={styles.digits} accessible accessibilityLabel={`Safety number ${groups.join(' ')}`} testID="verify.number">
          {groups.map((g, i) => <Text key={i} variant="h2" mono style={styles.digit}>{g}</Text>)}
        </View>
      ) : <Text variant="sub" tone="muted" center accessibilityLiveRegion="polite">Calculating…</Text>}
      {num ? <Text variant="meta" tone="muted" center testID="verify.readers">{readersLine(readers)}</Text> : null}
      {num ? (
        <View style={styles.qrWrap} accessible accessibilityLabel="Safety number as a QR code">
          <View style={styles.qrBox}><QRCode value={`onepeek-verify:${num}`} size={150} color="#000" backgroundColor="#fff" /></View>
        </View>
      ) : null}
      {err ? <Notice tone="error" text={err} /> : null}
      <Button title="They match — mark verified" disabled={!num} busy={busy} onPress={async () => {
        setBusy(true); setErr('');
        try { await guard(() => chat().markVerified(roomId, who.deviceId)); onChange(); select(null); }
        catch (e) { setErr(friendlyError(errorCode(e))); }
        finally { setBusy(false); }
      }} testID="verify.mark" />
      <Button title="Scan their code" icon="qr" variant="ghost" onPress={() => { onClose(); router.push({ pathname: '/scan', params: { room: roomId } }); }} testID="verify.scan" />
      {members.length > 1 ? <Button title="Someone else" variant="ghost" onPress={() => select(null)} testID="verify.back" /> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------- timer

function Timer({ room, ttl, setTtl, isOwner, onSaved }: { room: MenuRoom; ttl: number; setTtl: (n: number) => void; isOwner: boolean; onSaved: () => void }) {
  const { chat, guard } = useChat();
  const [mode, setMode] = useState(room.mode);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <View style={styles.stack}>
      <Segmented label="Message timer" value={ttl} onChange={setTtl} testID="timer.ttl" options={TIMERS.map((t) => ({ value: t.s, label: t.label, testID: `timer.ttl.${t.s}` }))} />
      <Text variant="meta" tone="muted" style={styles.hint}>Applies to the next messages you send.</Text>
      {isOwner ? (
        <>
          <SectionLabel>Room default · countdown starts</SectionLabel>
          <Segmented label="Countdown starts" value={mode} onChange={setMode} testID="timer.mode" options={[{ value: 'on_open' as const, label: 'once read', testID: 'timer.mode.read' }, { value: 'on_send' as const, label: 'once sent', testID: 'timer.mode.sent' }]} />
          <Button title="Save as room default" busy={busy} style={styles.topGap} onPress={async () => {
            setBusy(true); setErr('');
            try { await guard(() => chat().setTimer(room.id, ttl, mode)); onSaved(); }
            catch (e) { setErr(friendlyError(errorCode(e))); setBusy(false); }
          }} testID="timer.save" />
          {err ? <Notice tone="error" text={err} /> : null}
        </>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------- rename

function Rename({ room, onSaved }: { room: MenuRoom; onSaved: () => void }) {
  const { chat, guard } = useChat();
  const [name, setName] = useState(room.name ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <View style={styles.stack}>
      <Field label="Name (only on your device)" value={name} onChangeText={setName} placeholder="Optional" maxLength={60} autoComplete="off" autoFocus testID="rename.name" />
      <Button title="Save" busy={busy} onPress={async () => {
        setBusy(true); setErr('');
        try { await guard(() => chat().setRoomName(room.id, name)); onSaved(); }
        catch (e) { setErr(friendlyError(errorCode(e))); setBusy(false); }
      }} testID="rename.save" />
      {err ? <Notice tone="error" text={err} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------- confirm

type Chat = ReturnType<ReturnType<typeof useChat>['chat']>;

function Confirm({ body, danger, confirmTestID, run, onDone, onCancel }: { body: string; danger: string; confirmTestID: string; run: (chat: Chat) => Promise<unknown>; onDone: () => void; onCancel: () => void }) {
  const { chat, guard } = useChat();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <View style={styles.stack}>
      <Text variant="sub" tone="muted">{body}</Text>
      <Button title={busy ? 'Working…' : danger} variant="destructive" busy={busy} onPress={async () => {
        setBusy(true); setErr('');
        try { await guard(() => run(chat())); onDone(); }
        catch (e) { setErr(friendlyError(errorCode(e))); setBusy(false); }
      }} testID={confirmTestID} />
      <Button title="Cancel" variant="ghost" disabled={busy} onPress={onCancel} testID="confirm.cancel" />
      {err ? <Notice tone="error" text={err} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  card: { backgroundColor: colors.bg, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  hint: { marginHorizontal: spacing.xs },
  topGap: { marginTop: spacing.sm },
  confirmBox: { gap: spacing.md, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.dangerSoft },
  rowBtns: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  digits: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  digit: { letterSpacing: 1.5 },
  qrWrap: { alignItems: 'center' },
  qrBox: { padding: 12, backgroundColor: '#fff', borderRadius: radii.lg },
});
