'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getClientId } from '@/lib/quota';
import { newRequestKeys, decryptWithPrivateKey, fromB64Url, toB64Url } from '@/lib/crypto';
import Icon from './Icon';

type ReqRow = { id: string; note: string; recipient: string | null; public_key: string; created_at: string; expires_at: string; responded_at: string | null; opened_at: string | null };
type RStatus = 'waiting' | 'answered' | 'read' | 'expired';

const KEY_PREFIX = 'onepeek.reqkey.';
const TTLS = [{ id: 3600, label: '1 hour' }, { id: 86400, label: '24 hours' }, { id: 604800, label: '7 days' }];

function getKey(id: string) { try { return localStorage.getItem(KEY_PREFIX + id); } catch { return null; } }
function setKey(id: string, k: string) { try { localStorage.setItem(KEY_PREFIX + id, k); } catch { /* ignore */ } }
function dropKey(id: string) { try { localStorage.removeItem(KEY_PREFIX + id); } catch { /* ignore */ } }

/** True when the private key belongs to the request's public key. */
function keyMatches(privateB64: string, publicB64: string) {
  try {
    const jwk = JSON.parse(new TextDecoder().decode(fromB64Url(privateB64))) as { x: string; y: string };
    const x = fromB64Url(jwk.x), y = fromB64Url(jwk.y);
    const raw = new Uint8Array(65); raw[0] = 4; raw.set(x, 1); raw.set(y, 33);
    return toB64Url(raw) === publicB64;
  } catch { return false; }
}

function rel(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24); return `${d} day${d === 1 ? '' : 's'} ago`;
}

const LABEL: Record<RStatus, string> = { waiting: 'Waiting', answered: 'Answered', read: 'Read', expired: 'Expired' };

export default function RequestsPanel({ userId, onQuota }: { userId: string; onQuota?: () => void }) {
  const [rows, setRows] = useState<ReqRow[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [note, setNote] = useState('');
  const [recipient, setRecipient] = useState('');
  const [ttl, setTtl] = useState(86400);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [created, setCreated] = useState<{ id: string; link: string; backup: string } | null>(null);
  const [copied, setCopied] = useState('');
  const [emailTo, setEmailTo] = useState('');
  const [emailMsg, setEmailMsg] = useState('');
  const [reading, setReading] = useState<{ id: string; text: string } | null>(null);
  const [needKey, setNeedKey] = useState<ReqRow | null>(null);
  const [paste, setPaste] = useState('');
  const [readErr, setReadErr] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from('secret_requests')
      .select('id, note, recipient, public_key, created_at, expires_at, responded_at, opened_at')
      .order('created_at', { ascending: false }).limit(200);
    setRows(error ? [] : (data as ReqRow[]));
  }, []);

  useEffect(() => { if (userId) load(); }, [userId, load]);

  // A backup "private key" link opens the dashboard with ?req=ID#k=KEY: keep the key in this browser.
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      const id = u.searchParams.get('req');
      const k = new URLSearchParams(u.hash.slice(1)).get('k');
      if (id && k && /^[A-Za-z0-9]{6,32}$/.test(id)) {
        setKey(id, k);
        u.searchParams.delete('req');
        history.replaceState(null, '', u.pathname + (u.search || '') + '#requests');
        setMsg('Private key saved in this browser. You can now read that answer here.');
      }
    } catch { /* ignore */ }
  }, []);

  const status = (r: ReqRow): RStatus => r.opened_at ? 'read' : r.responded_at ? (new Date(r.expires_at).getTime() > Date.now() ? 'answered' : 'expired') : new Date(r.expires_at).getTime() > Date.now() ? 'waiting' : 'expired';

  function copy(text: string, what: string) {
    navigator.clipboard.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(''), 1600); });
  }

  async function create() {
    if (!supabase || !note.trim()) return;
    setBusy(true); setMsg('');
    try {
      const keys = await newRequestKeys();
      const { data: id, error } = await supabase.rpc('create_request', {
        p_note: note.trim(), p_public_key: keys.publicB64, p_ttl_seconds: ttl, p_client_id: getClientId(), p_recipient: recipient.trim() || null,
      });
      if (error && /quota_exceeded/.test(error.message)) { setMsg('You’ve used all your free secrets. Requests count towards the same limit.'); setBusy(false); return; }
      if (error || !id) throw new Error('create');
      setKey(String(id), keys.privateB64);
      const origin = window.location.origin;
      setCreated({ id: String(id), link: `${origin}/r/${id}`, backup: `${origin}/dashboard?req=${id}#k=${keys.privateB64}` });
      setNote(''); setRecipient(''); setFormOpen(false);
      onQuota?.();
      load();
    } catch {
      setMsg('Couldn’t create the request. Please try again.');
    }
    setBusy(false);
  }

  async function emailLink() {
    if (!created || !emailTo.trim()) return;
    setEmailMsg('');
    const res = await fetch('/api/send-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: emailTo.trim(), link: created.link }) }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setEmailMsg(res?.ok ? 'Sent' : (data as { error?: string }).error || 'Couldn’t send');
    if (res?.ok) setEmailTo('');
  }

  async function read(r: ReqRow, keyOverride?: string) {
    if (!supabase) return;
    setReadErr('');
    const key = keyOverride || getKey(r.id);
    if (!key || !keyMatches(key, r.public_key)) { setNeedKey(r); return; }
    // Fetching the answer deletes it from OnePeek, so the key is checked first.
    const { data, error } = await supabase.rpc('take_request_response', { p_id: r.id });
    if (error || !data) { setReadErr('This answer is no longer available.'); load(); return; }
    try {
      const text = await decryptWithPrivateKey(key, String(data));
      setReading({ id: r.id, text });
      setNeedKey(null); setPaste('');
      dropKey(r.id);
    } catch {
      setReadErr('The answer couldn’t be decrypted.');
    }
    load();
  }

  function applyPasted() {
    if (!needKey) return;
    let k = paste.trim();
    const m = /[#&]k=([A-Za-z0-9_-]+)/.exec(k);
    if (m) k = m[1];
    if (!keyMatches(k, needKey.public_key)) { setReadErr('That isn’t the private key link for this request.'); return; }
    setKey(needKey.id, k);
    read(needKey, k);
  }

  async function remove(id: string) {
    if (!supabase) return;
    setRows(rs => (rs || []).filter(r => r.id !== id));
    dropKey(id);
    await supabase.from('secret_requests').delete().eq('id', id);
  }

  return (
    <div className="dash-panel" id="requests">
      <div className="dash-panel-head">
        <div>
          <h2>Requests</h2>
          <p className="dash-muted">Ask someone for a password. They type it into a link, it’s encrypted to a key only this browser holds, and you read it once.</p>
        </div>
        <button type="button" className="gp-btn" onClick={() => { setFormOpen(o => !o); setCreated(null); }}>{formOpen ? 'Cancel' : 'New request'}</button>
      </div>

      {msg && <p className="auth-msg">{msg}</p>}

      {formOpen && (
        <div className="req-form">
          <div>
            <label className="field-label" htmlFor="rq-note">What do you need? <span className="field-opt">shown to them · don’t put secrets here</span></label>
            <input id="rq-note" className="field-input" maxLength={300} placeholder="e.g. Router admin password for the Gurugram site" value={note} onChange={e => setNote(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="rq-who">Who is it from? <span className="field-opt">optional · only you see this</span></label>
            <input id="rq-who" className="field-input" maxLength={200} placeholder="e.g. Acme IT, rahul@acme.com" value={recipient} onChange={e => setRecipient(e.target.value)} />
          </div>
          <div>
            <div className="field-label">Link works for</div>
            <div className="pills">
              {TTLS.map(t => <button key={t.id} type="button" className={`pill-btn ${ttl === t.id ? 'pill-on' : ''}`} onClick={() => setTtl(t.id)}>{t.label}</button>)}
            </div>
          </div>
          <button type="button" className="gp-btn" onClick={create} disabled={busy || !note.trim()} style={{ justifyContent: 'center' }}>{busy ? 'Creating…' : 'Create request link →'}</button>
        </div>
      )}

      {created && (
        <div className="req-created">
          <p className="field-label">Send this link to them</p>
          <div className="dash-ref"><code>{created.link.replace(/^https?:\/\//, '')}</code><button type="button" onClick={() => copy(created.link, 'link')}>{copied === 'link' ? 'Copied' : 'Copy'}</button></div>
          <div className="lock-row">
            <input className="field-input" type="email" placeholder="or email it: name@company.com" value={emailTo} onChange={e => setEmailTo(e.target.value)} />
            <button type="button" className="dash-ghost" onClick={emailLink} disabled={!emailTo.trim()}><Icon name="send" size={14} strokeWidth={2} />Send</button>
          </div>
          {emailMsg && <p className="field-hint">{emailMsg}</p>}
          <details className="req-backup">
            <summary>Reading the answer on another device?</summary>
            <p className="dash-muted">The private key lives only in this browser. To read the answer elsewhere, keep this private link somewhere safe (not with the person you’re asking).</p>
            <div className="dash-ref"><code>Private key link</code><button type="button" onClick={() => copy(created.backup, 'backup')}>{copied === 'backup' ? 'Copied' : 'Copy'}</button></div>
          </details>
        </div>
      )}

      {readErr && <p className="auth-msg err">{readErr}</p>}

      {needKey && (
        <div className="req-created">
          <p className="dash-muted">The private key for this request isn’t in this browser. Paste the private key link you saved when you created it.</p>
          <div className="lock-row">
            <input className="field-input mono" placeholder="https://…/dashboard?req=…#k=…" value={paste} onChange={e => setPaste(e.target.value)} />
            <button type="button" className="gp-btn" onClick={applyPasted} disabled={!paste.trim()}>Use key</button>
            <button type="button" className="dash-ghost" onClick={() => { setNeedKey(null); setPaste(''); setReadErr(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {reading && (
        <div className="req-answer">
          <div className="req-answer-head"><strong>Answer</strong><span className="dash-muted">Deleted from OnePeek. Copy it now.</span></div>
          <pre className="secret-text">{reading.text}</pre>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="gp-btn gp-ghost" onClick={() => copy(reading.text, 'answer')}><Icon name="copy" size={15} strokeWidth={2} />{copied === 'answer' ? 'Copied' : 'Copy'}</button>
            <button type="button" className="dash-ghost" onClick={() => setReading(null)}>Close</button>
          </div>
        </div>
      )}

      {rows === null ? (
        <p className="dash-muted" style={{ padding: '16px 0' }}>Loading requests…</p>
      ) : rows.length === 0 ? (
        !formOpen && !created && <p className="dash-muted" style={{ padding: '12px 0' }}>No requests yet.</p>
      ) : (
        <ul className="dash-list">
          {rows.map(r => {
            const st = status(r);
            return (
              <li key={r.id} className="hist-item">
                <div className="hist-row">
                  <span className="dash-type text"><Icon name="inbox" size={17} /></span>
                  <div className="dash-item">
                    <strong>{r.note}</strong>
                    <span>{r.recipient ? `From ${r.recipient} · ` : ''}asked {rel(r.created_at)}{r.responded_at ? ` · answered ${rel(r.responded_at)}` : ''}</span>
                    {st === 'waiting' && (
                      <button type="button" className="hist-place" onClick={() => copy(`${window.location.origin}/r/${r.id}`, r.id)}>
                        <Icon name="copy" size={13} strokeWidth={2} />{copied === r.id ? 'Link copied' : 'Copy request link'}
                      </button>
                    )}
                  </div>
                  {st === 'answered'
                    ? <button type="button" className="gp-btn req-read" onClick={() => read(r)}>Read answer</button>
                    : <span className={`dash-chip ${st === 'read' ? 'opened' : st}`}>{LABEL[st]}</span>}
                  <button type="button" className="hist-del" onClick={() => remove(r.id)} aria-label="Delete request" title={st === 'waiting' ? 'Cancel request' : 'Delete'}>
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
