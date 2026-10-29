'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../components/Icon';
import QrCode from '../../../components/QrCode';
import { panicExit } from '../../ChatShell';
import * as chat from '@/lib/chat/client';
import type { LocalMessage, RoomSummary } from '@/lib/chat/client';
import { KIND_NAME, TIMERS, countdown, friendlyError, shortId, ttlLabel } from '../../format';

type Member = Awaited<ReturnType<typeof chat.members>>[number];
type Sheet = null | 'menu' | 'invite' | 'timer' | 'members' | 'verify' | 'burn' | 'leave' | 'file';
type Viewer = { url: string; name: string; mime: string; size: number; viewOnce: boolean; text?: string };

function fileSize(n: number) {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

export default function ConversationPage() {
  const { id: roomId } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const [room, setRoom] = useState<RoomSummary | null>(null);
  const [msgs, setMsgs] = useState<LocalMessage[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [me, setMe] = useState<string>('');
  // Off until the first sync confirms we've been let in and hold the room's keys.
  const [joined, setJoined] = useState(false);
  const [synced, setSynced] = useState(false);
  const [ended, setEnded] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [ttl, setTtl] = useState(60);
  const [replyTo, setReplyTo] = useState<LocalMessage | null>(null);
  const [sheet, setSheet] = useState<Sheet>(search.get('invite') ? 'invite' : null);
  const [now, setNow] = useState(Date.now());
  const [err, setErr] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [fileBusy, setFileBusy] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Messages shown on screen while they are still being sent, by id.
  const outgoing = useRef(new Map<string, LocalMessage>());

  const isOwner = room?.role === 'owner';
  const secret = room?.kind === 'secret';
  const keyWarnings = members.filter(chat.keyChanged);

  /** Shows stored messages plus any still on their way out. */
  const showStored = useCallback(async () => {
    const stored = await chat.messages(roomId);
    const ids = new Set(stored.map(m => m.id));
    for (const id of Array.from(outgoing.current.keys())) if (ids.has(id)) outgoing.current.delete(id);
    setMsgs([...stored, ...Array.from(outgoing.current.values())]);
  }, [roomId]);

  /** Fast path for a new-message ping: one fetch, decrypt, show. */
  const pullOnce = useCallback(async () => {
    try {
      const r = await chat.sync(roomId);
      if (r.removed) { setEnded(e => e ?? 'This chat has ended, or you were removed.'); return; }
      if (r.newMessages || r.joined) await showStored();
      if (r.joined) void refresh();
    } catch (e) {
      if (e instanceof chat.ChatError && e.code === 'not_signed_in') router.replace('/chat');
    }
  }, [roomId, router, showStored]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Full refresh: room details, members, and the owner's admit/remove duties. */
  const refreshOnce = useCallback(async () => {
    try {
      const r = await chat.sync(roomId);
      if (r.removed) { setEnded(e => e ?? 'This chat has ended, or you were removed.'); return; }
      const rooms = await chat.myRooms();
      const current = rooms.find(x => x.id === roomId) ?? null;
      if (!current) { setEnded(e => e ?? 'This chat has ended.'); await chat.forgetRoom(roomId); return; }
      setRoom(current);
      setJoined(current.memberState === 'active' && !!(await chat.keystore.get(`room:${roomId}:state`)));
      setSynced(true);
      if (current.role === 'owner') {
        // Owner's device keeps the group in step: admit joiners (Business rooms wait for approval)
        // and cryptographically remove anyone the server has already removed.
        if (current.kind !== 'business') await chat.admitPending(roomId);
        await chat.commitRemovals(roomId);
      }
      setMembers(await chat.members(roomId));
      await showStored();
    } catch (e) {
      if (e instanceof chat.ChatError && e.code === 'not_signed_in') router.replace('/chat');
    }
  }, [roomId, router, showStored]);

  // A ping that arrives mid-sync is queued, not dropped, so no message waits for the next poll.
  const pull = useCoalesced(pullOnce);
  const refresh = useCoalesced(refreshOnce);

  // First load, Realtime pings, and a poll as a fallback for missed pings.
  useEffect(() => {
    let alive = true;
    chat.ensureDevice().then(d => alive && setMe(d.id)).catch(() => router.replace('/chat'));
    refresh();
    const off = chat.subscribe(roomId, (event) => {
      if (event === 'burned') { setEnded(e => e ?? 'The owner burned this chat.'); chat.forgetRoom(roomId); return; }
      if (event === 'msg') pull(); else refresh();
    });
    const visible = () => document.visibilityState === 'visible';
    const fast = setInterval(() => { if (visible()) pull(); }, 4000);
    const slow = setInterval(() => { if (visible()) refresh(); }, 15000);
    const back = () => { if (visible()) pull(); };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('focus', back);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false; off(); clearInterval(fast); clearInterval(slow); clearInterval(tick);
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('focus', back);
    };
  }, [roomId, refresh, pull, router]);

  useEffect(() => { if (room) setTtl(room.ttl); }, [room?.ttl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Expired messages leave the screen and the device.
  useEffect(() => {
    const dead = msgs.filter(m => m.expiresAt !== null && m.expiresAt <= now);
    if (!dead.length) return;
    dead.forEach(m => chat.dropMessage(roomId, m.id));
    const t = setTimeout(() => setMsgs(list => list.filter(m => !dead.some(d => d.id === m.id))), 450);
    return () => clearTimeout(t);
  }, [now, msgs, roomId]);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs.length]);

  const open = useCallback(async (m: LocalMessage) => {
    if (m.mine || m.expiresAt || document.visibilityState !== 'visible') return;
    const opened = await chat.markOpened(roomId, m);
    setMsgs(list => list.map(x => x.id === m.id ? opened : x));
  }, [roomId]);

  // Quick and Business rooms count a message as read once it is on screen; Secret rooms on tap.
  useEffect(() => {
    if (secret || !listRef.current) return;
    const io = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) {
        const m = msgs.find(x => x.id === (e.target as HTMLElement).dataset.id);
        if (m) open(m);
      }
    }, { root: listRef.current, threshold: 0.8 });
    listRef.current.querySelectorAll('[data-unread]').forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [msgs, secret, open]);

  async function send() {
    if (!text.trim()) return;
    setErr('');
    const body = text;
    const reply = replyTo;
    // Show it straight away; it is encrypted and sent in the background.
    const id = crypto.randomUUID();
    const draft: LocalMessage = {
      id, seq: Number.MAX_SAFE_INTEGER, mine: true, sender: me, body: body.trim(), ttl,
      sentAt: Date.now(), expiresAt: null, replyTo: reply?.id, pending: true,
    };
    outgoing.current.set(id, draft);
    setMsgs(list => [...list, draft]);
    setText('');
    setReplyTo(null);
    try {
      const m = await chat.send(roomId, body, ttl, reply?.id, id);
      outgoing.current.delete(id);
      if (m) setMsgs(list => list.some(x => x.id === id) ? list.map(x => x.id === id ? m : x) : [...list, m]);
    } catch (e) {
      outgoing.current.delete(id);
      setMsgs(list => list.filter(x => x.id !== id));
      setText(t => t || body);
      setReplyTo(r => r ?? reply);
      setErr(friendlyError(e instanceof chat.ChatError ? e.code : ''));
    }
  }

  function pickFile(f: File | undefined) {
    if (!f) return;
    setErr('');
    if (f.size > chat.MAX_ATTACHMENT_BYTES) { setErr('Files can be up to 50 MB.'); return; }
    setPendingFile(f);
    setSheet('file');
  }

  async function sendPendingFile(viewOnce: boolean) {
    if (!pendingFile) return;
    const f = pendingFile;
    setSheet(null); setPendingFile(null); setErr(''); setFileBusy('sending');
    try {
      const m = await chat.sendFile(roomId, f, ttl, viewOnce);
      setMsgs(list => [...list, m]);
    } catch (e) {
      setErr(friendlyError(e instanceof chat.ChatError ? e.code : ''));
    } finally { setFileBusy(null); }
  }

  async function openFile(m: LocalMessage) {
    if (!m.file || fileBusy) return;
    setErr(''); setFileBusy(m.id);
    try {
      const blob = await chat.openFile(roomId, m);
      const f = m.file;
      const text = f.mime.startsWith('text/') && blob.size < 200_000 ? await blob.text() : undefined;
      setViewer({ url: URL.createObjectURL(blob), name: f.name, mime: f.mime, size: f.size, viewOnce: f.viewOnce, text });
      if (f.viewOnce) setMsgs(list => list.map(x => x.id === m.id ? { ...x, viewed: true } : x));
    } catch (e) {
      const code = e instanceof chat.ChatError ? e.code : '';
      if (code === 'gone' && m.file.viewOnce) setMsgs(list => list.map(x => x.id === m.id ? { ...x, viewed: true } : x));
      setErr(code === 'gone' ? 'That file has already been opened or has expired.' : friendlyError(code));
    } finally { setFileBusy(null); }
  }

  function closeViewer() {
    if (viewer) URL.revokeObjectURL(viewer.url);
    setViewer(null);
  }

  const nameOf = useCallback((device: string) => {
    if (device === me) return 'You';
    const m = members.find(x => x.deviceId === device);
    return m?.nickname || `Guest ${shortId(device)}`;
  }, [me, members]);

  const title = room ? (room.name || KIND_NAME[room.kind]) : '…';
  const byId = useMemo(() => new Map(msgs.map(m => [m.id, m])), [msgs]);

  if (ended) return (
    <div className="c-convo"><div className="c-empty" style={{ margin: 'auto' }}>
      <Icon name="flame" size={30} /><p>{ended}</p><p className="c-hint">Its keys and messages have been removed from this device.</p>
      <Link className="c-btn" href="/chat">Back to chats</Link>
    </div></div>
  );

  return (
    <div className="c-convo">
      <header className="c-chead">
        <Link href="/chat" className="c-back" aria-label="Back to chats">‹</Link>
        <div className="c-chead-title">
          <strong>{title}</strong>
          <span className="c-secure"><Icon name="lock" size={11} />End-to-end encrypted · {ttlLabel(room?.ttl ?? ttl)} {room?.mode === 'on_send' ? 'after sending' : 'after reading'}</span>
        </div>
        <button className="c-icon-btn" aria-label="Room menu" onClick={() => setSheet('menu')}>⋯</button>
      </header>

      <div className="c-msgs" ref={listRef} aria-live="polite">
        <p className="c-notice">Messages are encrypted on each device and disappear on a timer. Anyone in the chat can still take a screenshot or photo.</p>
        {keyWarnings.map(m => (
          <p key={m.deviceId} className="c-notice" style={{ color: 'var(--c-danger)' }}>
            {nameOf(m.deviceId)}’s security key changed. <button className="c-link" onClick={() => setSheet('verify')}>Verify again</button>
          </p>
        ))}
        {synced && !joined && <p className="c-notice">Waiting for the owner to let you in. Messages will appear once you’re admitted.</p>}
        {msgs.map(m => {
          const left = m.expiresAt === null ? null : m.expiresAt - now;
          const hidden = secret && !m.mine && m.expiresAt === null;
          const parent = m.replyTo ? byId.get(m.replyTo) : undefined;
          return (
            <div key={m.id} data-id={m.id} {...(!m.mine && m.expiresAt === null ? { 'data-unread': '' } : {})}
              className={`c-msg ${m.mine ? 'mine' : 'theirs'}${m.pending ? ' pending' : ''}${left !== null && left <= 0 ? ' leaving' : ''}`}>
              <div className={`c-bubble${hidden ? ' hidden' : ''}`} onClick={() => hidden && open(m)} role={hidden ? 'button' : undefined} aria-label={hidden ? 'Tap to reveal message' : undefined}>
                {parent && <div className="c-reply">{parent.file ? parent.file.name : parent.body}</div>}
                {hidden ? 'Tap to reveal' : m.file ? (
                  <button type="button" className="c-file" onClick={() => openFile(m)}
                    disabled={(m.file.viewOnce && (m.mine || m.viewed)) || fileBusy === m.id}>
                    <span className="c-file-icon"><Icon name={m.file.mime.startsWith('image/') ? 'image' : 'file'} size={18} /></span>
                    <span className="c-file-main">
                      <strong>{m.file.viewOnce ? (m.mine ? 'View-once file' : m.viewed ? 'Opened' : 'View-once file') : m.file.name}</strong>
                      <small>{fileBusy === m.id ? 'Decrypting…' : m.file.viewOnce
                        ? (m.mine ? `Sent · ${fileSize(m.file.size)}` : m.viewed ? 'Already viewed' : `Tap to view once · ${fileSize(m.file.size)}`)
                        : `${fileSize(m.file.size)} · tap to open`}</small>
                    </span>
                  </button>
                ) : m.body}
              </div>
              <div className="c-meta">
                {!m.mine && members.length > 2 && <span>{nameOf(m.sender)}</span>}
                {m.pending ? <span>Sending…</span> : <>
                  <span className={`c-timer${left !== null && left < 10_000 ? ' soon' : ''}`}>
                    {left === null ? `${ttlLabel(m.ttl)} once read` : countdown(left)}
                  </span>
                  {!hidden && <button onClick={() => setReplyTo(m)}>Reply</button>}
                </>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="c-composer">
        {replyTo && <div className="c-replying"><span>Replying to “{replyTo.body.slice(0, 40)}”</span><button className="c-link" onClick={() => setReplyTo(null)}>Cancel</button></div>}
        <div className="c-compose-row">
          <button className="c-ttl" onClick={() => setSheet('timer')} aria-label={`Message timer: ${ttlLabel(ttl)}`}><Icon name="clock" size={13} /> {ttlLabel(ttl)}</button>
          <button className="c-attach" onClick={() => fileInput.current?.click()} disabled={!joined || !!fileBusy} aria-label="Send an encrypted file" title="Send a file">
            <Icon name="file" size={17} />
          </button>
          <input ref={fileInput} type="file" hidden onChange={e => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
          <textarea rows={1} value={text} placeholder={joined ? 'Message' : synced ? 'Waiting to be let in…' : 'Loading…'} disabled={!joined} maxLength={4000}
            autoComplete="off" autoCorrect="on" spellCheck
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button className="c-send" onClick={send} disabled={!joined || !text.trim()} aria-label="Send"><Icon name="send" size={17} /></button>
        </div>
        {fileBusy === 'sending' && <p className="c-hint">Encrypting and sending the file…</p>}
        {err && <p className="c-error">{err}</p>}
      </div>

      {sheet && (
        <div className="c-sheet-bg" onClick={() => setSheet(null)}>
          <div className="c-sheet" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <div className="c-grabber" />
            {sheet === 'menu' && room && (
              <>
                <h2>{title}</h2>
                <ul className="c-menu">
                  <li><button onClick={() => setSheet('timer')}><Icon name="clock" />Message timer<small>{ttlLabel(room.ttl)}</small></button></li>
                  {(isOwner || room.kind === 'quick') && <li><button onClick={() => setSheet('invite')}><Icon name="user" />Invite someone</button></li>}
                  <li><button onClick={() => setSheet('verify')}><Icon name="shield" />Verify people</button></li>
                  <li><button onClick={() => setSheet('members')}><Icon name="eye" />Room details<small>{members.filter(m => m.state === 'active').length} in chat</small></button></li>
                </ul>
                <div style={{ height: 12 }} />
                <ul className="c-menu">
                  <li><button onClick={panicExit}><Icon name="lock" />Panic Exit<small>locks this device</small></button></li>
                  {isOwner
                    ? <li><button className="danger" onClick={() => setSheet('burn')}><Icon name="flame" />Burn chat</button></li>
                    : <li><button className="danger" onClick={() => setSheet('leave')}><Icon name="ban" />Leave chat</button></li>}
                </ul>
              </>
            )}
            {sheet === 'file' && pendingFile && <FileSheet file={pendingFile} ttl={ttl} secret={secret} onSend={sendPendingFile} onCancel={() => { setPendingFile(null); setSheet(null); }} />}
            {sheet === 'timer' && room && <TimerSheet room={room} ttl={ttl} setTtl={setTtl} isOwner={isOwner} close={() => setSheet(null)} />}
            {sheet === 'invite' && room && <InviteSheet room={room} />}
            {sheet === 'members' && room && <MembersSheet room={room} members={members} me={me} nameOf={nameOf} isOwner={isOwner} onChange={refresh} />}
            {sheet === 'verify' && <VerifySheet roomId={roomId} members={members.filter(m => m.deviceId !== me && m.state === 'active')} nameOf={nameOf} onChange={refresh} />}
            {sheet === 'burn' && <ConfirmSheet title="Burn this chat?" danger="Burn chat"
              body="Every message, invite and file is deleted from OnePeek’s servers now, everyone loses access, and this device forgets its keys. Copies someone already saved or photographed can’t be recalled."
              onConfirm={async () => { await chat.burn(roomId); router.replace('/chat'); }} onCancel={() => setSheet('menu')} />}
            {sheet === 'leave' && <ConfirmSheet title="Leave this chat?" danger="Leave"
              body="You’ll stop receiving messages and this device forgets the chat’s keys. You’ll need a new invite to come back."
              onConfirm={async () => { await chat.leave(roomId); router.replace('/chat'); }} onCancel={() => setSheet('menu')} />}
          </div>
        </div>
      )}

      {viewer && (
        <div className="c-viewer" role="dialog" aria-modal="true" aria-label={viewer.name} onContextMenu={e => viewer.viewOnce && e.preventDefault()}>
          {viewer.mime.startsWith('image/') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={viewer.url} alt={viewer.name} draggable={false} />
          ) : viewer.text !== undefined ? <pre>{viewer.text}</pre> : (
            <div className="c-empty"><Icon name="file" size={34} /><p>{viewer.name}<br /><small>{fileSize(viewer.size)}</small></p></div>
          )}
          {viewer.viewOnce && <p>View once: this is the only time it opens. Closing it removes it from this device.</p>}
          <div className="c-viewer-bar">
            {!viewer.viewOnce && <a className="c-btn" href={viewer.url} download={viewer.name}>Save to device</a>}
            {viewer.viewOnce && !viewer.mime.startsWith('image/') && viewer.text === undefined && <a className="c-btn" href={viewer.url} download={viewer.name}>Save to device</a>}
            <button className="c-btn ghost" onClick={closeViewer}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function FileSheet({ file, ttl, secret, onSend, onCancel }: { file: File; ttl: number; secret: boolean; onSend: (viewOnce: boolean) => void; onCancel: () => void }) {
  const [viewOnce, setViewOnce] = useState(secret);
  return (
    <>
      <h2>Send a file</h2>
      <div className="c-pending-file">
        <span className="c-file-icon" style={{ background: 'var(--c-seg-on)', color: 'var(--c-accent)' }}><Icon name={file.type.startsWith('image/') ? 'image' : 'file'} size={18} /></span>
        <span className="c-file-main"><strong>{file.name}</strong><small style={{ color: 'var(--c-muted)' }}>{fileSize(file.size)} · disappears {ttlLabel(ttl)} after it’s read</small></span>
      </div>
      <label className="c-check">
        <input type="checkbox" checked={viewOnce} onChange={e => setViewOnce(e.target.checked)} />
        <span>View once<small>It can be opened one time, then it’s gone for everyone. You won’t be able to open it either.</small></span>
      </label>
      <p className="c-hint">Encrypted on this device before upload. OnePeek never sees the file, its name or its key.</p>
      <div style={{ height: 14 }} />
      <button className="c-btn block" onClick={() => onSend(viewOnce)}>Encrypt and send</button>
      <div style={{ height: 8 }} />
      <button className="c-btn ghost block" onClick={onCancel}>Cancel</button>
    </>
  );
}

function TimerSheet({ room, ttl, setTtl, isOwner, close }: { room: RoomSummary; ttl: number; setTtl: (n: number) => void; isOwner: boolean; close: () => void }) {
  const [mode, setMode] = useState(room.mode);
  return (
    <>
      <h2>Message timer</h2>
      <div className="c-seg" role="group" aria-label="Timer">
        {TIMERS.map(t => <button key={t.s} aria-pressed={ttl === t.s} onClick={() => setTtl(t.s)}>{t.label}</button>)}
      </div>
      <p className="c-hint">Applies to the next messages you send.</p>
      {isOwner && (
        <>
          <p className="c-label" style={{ marginTop: 18 }}>Room default · countdown starts</p>
          <div className="c-seg" role="group" aria-label="Countdown starts">
            <button aria-pressed={mode === 'on_open'} onClick={() => setMode('on_open')}>once read</button>
            <button aria-pressed={mode === 'on_send'} onClick={() => setMode('on_send')}>once sent</button>
          </div>
          <div style={{ height: 14 }} />
          <button className="c-btn block" onClick={async () => { await chat.setTimer(room.id, ttl, mode); close(); }}>Save as room default</button>
        </>
      )}
    </>
  );
}

function InviteSheet({ room }: { room: RoomSummary }) {
  const [link, setLink] = useState('');
  const [expires, setExpires] = useState(86400);
  const [uses, setUses] = useState(1);
  const [copied, setCopied] = useState(false);
  const [invites, setInvites] = useState<Awaited<ReturnType<typeof chat.listInvites>>>([]);
  const [err, setErr] = useState('');
  const load = useCallback(() => chat.listInvites(room.id).then(setInvites).catch(() => {}), [room.id]);
  useEffect(() => { load(); }, [load]);

  async function make() {
    setErr('');
    try {
      const r = await chat.createInvite(room.id, { expiresIn: expires, maxUses: uses, approval: room.kind === 'business' });
      setLink(r.link); load();
    } catch (e) { setErr(friendlyError(e instanceof chat.ChatError ? e.code : '')); }
  }

  return (
    <>
      <h2>Invite someone</h2>
      {!link ? (
        <>
          <p className="c-label">Link works for</p>
          <div className="c-seg"><>{[{ s: 3600, l: '1 hour' }, { s: 86400, l: '1 day' }, { s: 604800, l: '7 days' }].map(o =>
            <button key={o.s} aria-pressed={expires === o.s} onClick={() => setExpires(o.s)}>{o.l}</button>)}</></div>
          <p className="c-label" style={{ marginTop: 14 }}>Can be used</p>
          <div className="c-seg">{[1, 5, 20].map(n => <button key={n} aria-pressed={uses === n} onClick={() => setUses(n)}>{n === 1 ? 'once' : `${n} times`}</button>)}</div>
          {room.kind === 'business' && <p className="c-hint">You’ll approve each person before they can read anything.</p>}
          <div style={{ height: 14 }} />
          <button className="c-btn block" onClick={make}>Create invite link</button>
          {err && <p className="c-error">{err}</p>}
        </>
      ) : (
        <>
          <div className="c-qr"><QrCode value={link} size={180} /></div>
          <div className="c-linkbox"><code>{link.replace(/#.*/, '#••••••')}</code>
            <button className="c-btn sm" onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
              <Icon name="copy" size={14} />{copied ? 'Copied' : 'Copy'}</button>
          </div>
          <p className="c-hint">Only this chat. {room.kind === 'secret' ? 'They’ll also need the access code — share it another way.' : 'Anyone with the link can join until it’s used up or expires.'}</p>
        </>
      )}
      {invites.some(i => !i.revoked_at && new Date(i.expires_at) > new Date()) && (
        <>
          <p className="c-label" style={{ marginTop: 18 }}>Active invites</p>
          <ul className="c-menu">
            {invites.filter(i => !i.revoked_at && new Date(i.expires_at) > new Date()).map(i => (
              <li key={i.id}><button onClick={async () => { await chat.revokeInvite(i.id); load(); }}>
                {i.uses}/{i.max_uses} used · ends {countdown(new Date(i.expires_at).getTime() - Date.now())}<small>Revoke</small></button></li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function MembersSheet({ room, members, me, nameOf, isOwner, onChange }: { room: RoomSummary; members: Member[]; me: string; nameOf: (d: string) => string; isOwner: boolean; onChange: () => void }) {
  const pending = members.filter(m => m.state === 'pending');
  return (
    <>
      <h2>Room details</h2>
      <p className="c-hint" style={{ margin: '0 4px 14px' }}>{KIND_NAME[room.kind]} · ends in {countdown(new Date(room.expiresAt).getTime() - Date.now())} · messages {ttlLabel(room.ttl)} {room.mode === 'on_send' ? 'after sending' : 'after reading'}</p>
      {pending.length > 0 && isOwner && (
        <>
          <p className="c-label">Waiting to join</p>
          <ul className="c-menu">{pending.map(m => (
            <li key={m.deviceId}><button onClick={async () => { await chat.admitPending(room.id, [m.deviceId]); onChange(); }}>
              <Icon name="user" />Guest {shortId(m.deviceId)}<small>Let in</small></button></li>
          ))}</ul>
          <div style={{ height: 12 }} />
        </>
      )}
      <p className="c-label">In this chat</p>
      <ul className="c-menu">{members.filter(m => m.state === 'active').map(m => (
        <li key={m.deviceId}><button disabled={!isOwner || m.deviceId === me} onClick={async () => {
          if (confirm(`Remove ${nameOf(m.deviceId)}? They lose access to new messages immediately.`)) { await chat.removeMember(room.id, m.deviceId); onChange(); }
        }}>
          <Icon name={m.verified && !chat.keyChanged(m) ? 'check' : 'user'} />{nameOf(m.deviceId)}{m.role === 'owner' ? ' · owner' : ''}
          {isOwner && m.deviceId !== me && <small>Remove</small>}
        </button></li>
      ))}</ul>
    </>
  );
}

function VerifySheet({ roomId, members, nameOf, onChange }: { roomId: string; members: Member[]; nameOf: (d: string) => string; onChange: () => void }) {
  const [who, setWho] = useState<Member | null>(members.length === 1 ? members[0] : null);
  const [num, setNum] = useState('');
  useEffect(() => { if (who) chat.safetyNumberWith(roomId, who.deviceId).then(setNum); }, [who, roomId]);

  if (!members.length) return <><h2>Verify people</h2><p className="c-sub">Nobody else is in this chat yet.</p></>;
  if (!who) return (
    <>
      <h2>Verify people</h2>
      <ul className="c-menu">{members.map(m => <li key={m.deviceId}><button onClick={() => setWho(m)}><Icon name="shield" />{nameOf(m.deviceId)}
        <small>{m.verified ? (chat.keyChanged(m) ? 'Key changed' : 'Verified') : 'Not verified'}</small></button></li>)}</ul>
    </>
  );
  const groups = num.match(/.{5}/g) ?? [];
  return (
    <>
      <h2>Verify {nameOf(who.deviceId)}</h2>
      <p className="c-sub">Compare these numbers in person or on a call. If they match on both screens, nobody is intercepting this chat.</p>
      {num ? <div className="c-digits" aria-label="Safety number">{groups.map((g, i) => <span key={i}>{g}</span>)}</div> : <p className="c-empty">Calculating…</p>}
      <div className="c-qr"><QrCode value={`onepeek-verify:${num}`} size={150} /></div>
      <button className="c-btn block" disabled={!num} onClick={async () => { await chat.markVerified(roomId, who.deviceId); onChange(); setWho(null); }}>They match — mark verified</button>
    </>
  );
}

function ConfirmSheet({ title, body, danger, onConfirm, onCancel }: { title: string; body: string; danger: string; onConfirm: () => Promise<void>; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <>
      <h2>{title}</h2>
      <p className="c-sub">{body}</p>
      <button className="c-btn danger block" disabled={busy} onClick={async () => {
        setBusy(true); setErr('');
        try { await onConfirm(); } catch (e) { setErr(friendlyError(e instanceof chat.ChatError ? e.code : '')); setBusy(false); }
      }}>{busy ? 'Working…' : danger}</button>
      <div style={{ height: 8 }} />
      <button className="c-btn ghost block" onClick={onCancel} disabled={busy}>Cancel</button>
      {err && <p className="c-error">{err}</p>}
    </>
  );
}

/** Runs `fn` one at a time. Calls made while it runs collapse into one more run afterwards. */
function useCoalesced(fn: () => Promise<void>) {
  const running = useRef(false);
  const again = useRef(false);
  const latest = useRef(fn);
  latest.current = fn;
  return useCallback(async () => {
    if (running.current) { again.current = true; return; }
    running.current = true;
    try {
      do { again.current = false; await latest.current(); } while (again.current);
    } finally { running.current = false; }
  }, []);
}
