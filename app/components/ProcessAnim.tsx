'use client';

import { useEffect, useState } from 'react';
import Icon from './Icon';

const STEPS = [
  { name: 'Write', desc: 'You paste a password, API key or note — or drop in a photo. Nothing has left your device yet.' },
  { name: 'Encrypt', desc: 'Your browser creates a one-time key and locks the secret with AES-GCM, right inside the tab.' },
  { name: 'Upload', desc: 'Only the scrambled ciphertext is sent to OnePeek. The key stays with you.' },
  { name: 'Share', desc: 'You send the link. The key rides inside it — in the part browsers never send to any server.' },
  { name: 'Reveal', desc: 'The recipient opens it once. Their browser fetches the ciphertext and unlocks it locally.' },
  { name: 'Burn', desc: 'The moment it’s read, OnePeek deletes the ciphertext. Open the link again and there’s nothing there.' },
];

const CIPHER = '9f3a e1c0 77b2 04d9 c1b8 …';
const PLAIN = 'db_pass = Pr0d!x92';
const ACCENT = '#C8F135';
const BURN = '#FF9F5A';
const DIM = '#8A93A0';
const BRIGHT = '#F4F5F6';

export default function ProcessAnim() {
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const iv = setInterval(() => setStep(s => (s + 1) % 6), 3200);
    return () => clearInterval(iv);
  }, [paused]);

  const sender = step === 0
    ? { tag: 'PLAIN TEXT', tagC: DIM, body: PLAIN, bodyC: BRIGHT, hasKey: false }
    : { tag: step === 1 ? 'ENCRYPTING…' : 'ENCRYPTED', tagC: step === 1 ? ACCENT : DIM, body: CIPHER, bodyC: DIM, hasKey: step >= 1 };

  const server = step < 2
    ? { tag: 'NOTHING STORED', tagC: DIM, body: '—', bodyC: DIM }
    : step < 4
      ? { tag: step === 2 ? 'RECEIVING CIPHERTEXT' : 'CIPHERTEXT ONLY', tagC: step === 2 ? ACCENT : DIM, body: CIPHER, bodyC: DIM }
      : step === 4
        ? { tag: 'SENDING CIPHERTEXT', tagC: ACCENT, body: CIPHER, bodyC: DIM }
        : { tag: 'DELETED', tagC: BURN, body: '∅  burned after 1 view', bodyC: BURN };

  const recipient = step < 3
    ? { tag: 'WAITING', tagC: DIM, body: '—', bodyC: DIM, hasKey: false }
    : step === 3
      ? { tag: 'LINK RECEIVED', tagC: ACCENT, body: '1 view remaining', bodyC: DIM, hasKey: true }
      : step === 4
        ? { tag: 'DECRYPTED LOCALLY', tagC: ACCENT, body: PLAIN, bodyC: BRIGHT, hasKey: true }
        : { tag: 'LINK EXPIRED', tagC: BURN, body: 'nothing to reveal', bodyC: BURN, hasKey: false };

  const senderOn = step <= 1 || step === 3;
  const serverOn = step === 2 || step === 4;
  const serverBurn = step === 5;
  const recipientOn = step === 3 || step === 4;

  const conn1Active = step === 2;
  const conn2Active = step === 4;
  const keyTravel = step === 3;

  const nodeBase: React.CSSProperties = {
    flex: '1 1 240px',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: 18,
    borderRadius: 14,
    background: 'rgba(10,12,15,0.7)',
    transition: 'border-color .4s ease, box-shadow .4s ease',
  };

  const nodeStyle = (on: boolean, burn = false): React.CSSProperties => ({
    ...nodeBase,
    border: `1px solid ${burn ? BURN : on ? ACCENT : '#262C35'}`,
    boxShadow: burn
      ? '0 0 0 4px rgba(255,159,90,0.12)'
      : on
        ? `0 0 0 4px color-mix(in srgb, ${ACCENT} 12%, transparent), 0 16px 40px -18px ${ACCENT}`
        : 'none',
  });

  return (
    <div style={{ border: '1px solid #262C35', borderRadius: 20, background: 'rgba(17,20,25,0.82)', backdropFilter: 'blur(16px)', padding: '36px 32px', display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Flow */}
      <div className="gp-flow" style={{ display: 'flex', alignItems: 'stretch', gap: 0, flexWrap: 'wrap' }}>
        {/* Sender */}
        <div style={nodeStyle(senderOn)}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15.5, color: '#F4F5F6' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="4" width="20" height="14" rx="2" /><path d="M8 21h8" /><path d="M12 18v3" /></svg>
              Your browser
            </span>
            <span style={{ fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 11, letterSpacing: 0.5, color: '#8A93A0' }}>SENDER</span>
          </div>
          <span style={{ fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 11.5, letterSpacing: 0.6, color: sender.tagC }}>{sender.tag}</span>
          <div style={{ background: '#0A0C0F', border: '1px solid #1E232A', borderRadius: 8, padding: '12px 14px', fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 13.5, color: sender.bodyC, minHeight: 22, wordBreak: 'break-all' }}>{sender.body}</div>
          {sender.hasKey && (
            <span style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 12, color: ACCENT, border: `1px solid color-mix(in srgb, ${ACCENT} 40%, transparent)`, borderRadius: 999, padding: '3px 10px' }}>
              <Icon name="key" size={12} strokeWidth={2.2} />key stays here
            </span>
          )}
        </div>

        {/* Conn 1 */}
        <div style={{ position: 'relative', flex: '1 1 100px', minWidth: 64, height: 2, alignSelf: 'center', background: 'repeating-linear-gradient(90deg, #343B46 0 6px, transparent 6px 12px)' }}>
          <span style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 11, color: conn1Active ? ACCENT : '#6B7684' }}>ciphertext →</span>
          {conn1Active && (
            <span style={{ position: 'absolute', top: -7, left: '50%', width: 16, height: 16, borderRadius: 4, background: ACCENT, boxShadow: `0 0 16px ${ACCENT}`, animation: 'packet 1.6s linear infinite' }} />
          )}
        </div>

        {/* Server */}
        <div style={nodeStyle(serverOn, serverBurn)}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15.5, color: '#F4F5F6' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="3" width="20" height="6" rx="1" /><rect x="2" y="15" width="20" height="6" rx="1" /><path d="M6 6h.01" /><path d="M6 18h.01" /></svg>
              OnePeek server
            </span>
            <span style={{ fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 11, letterSpacing: 0.5, color: '#8A93A0' }}>STORAGE</span>
          </div>
          <span style={{ fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 11.5, letterSpacing: 0.6, color: server.tagC }}>{server.tag}</span>
          <div style={{ background: '#0A0C0F', border: '1px solid #1E232A', borderRadius: 8, padding: '12px 14px', fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 13.5, color: server.bodyC, minHeight: 22, wordBreak: 'break-all' }}>{server.body}</div>
          <span style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 12, color: '#8A93A0', border: '1px solid #2A3039', borderRadius: 999, padding: '3px 10px' }}>
            <Icon name="ban" size={12} strokeWidth={2.2} />never sees the key
          </span>
        </div>

        {/* Conn 2 */}
        <div style={{ position: 'relative', flex: '1 1 100px', minWidth: 64, height: 2, alignSelf: 'center', background: 'repeating-linear-gradient(90deg, #343B46 0 6px, transparent 6px 12px)' }}>
          <span style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 11, color: conn2Active ? ACCENT : '#6B7684' }}>ciphertext →</span>
          {conn2Active && (
            <span style={{ position: 'absolute', top: -7, left: '50%', width: 16, height: 16, borderRadius: 4, background: ACCENT, boxShadow: `0 0 16px ${ACCENT}`, animation: 'packet 1.6s linear infinite' }} />
          )}
        </div>

        {/* Recipient */}
        <div style={nodeStyle(recipientOn)}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15.5, color: '#F4F5F6' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M12 18h.01" /></svg>
              Their browser
            </span>
            <span style={{ fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 11, letterSpacing: 0.5, color: '#8A93A0' }}>RECIPIENT</span>
          </div>
          <span style={{ fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 11.5, letterSpacing: 0.6, color: recipient.tagC }}>{recipient.tag}</span>
          <div style={{ background: '#0A0C0F', border: '1px solid #1E232A', borderRadius: 8, padding: '12px 14px', fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 13.5, color: recipient.bodyC, minHeight: 22, wordBreak: 'break-all' }}>{recipient.body}</div>
          {recipient.hasKey && (
            <span style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 12, color: ACCENT, border: `1px solid color-mix(in srgb, ${ACCENT} 40%, transparent)`, borderRadius: 999, padding: '3px 10px' }}>
              <Icon name="key" size={12} strokeWidth={2.2} />key received
            </span>
          )}
        </div>
      </div>

      {/* Key travel bar */}
      <div style={{ position: 'relative', height: 2, background: 'repeating-linear-gradient(90deg, #343B46 0 6px, transparent 6px 12px)', borderRadius: 1 }}>
        {keyTravel && (
          <span style={{ position: 'absolute', top: -8, left: 0, width: 18, height: 18, borderRadius: '50%', background: ACCENT, boxShadow: `0 0 18px ${ACCENT}`, animation: 'keyTravel 2.4s linear infinite' }} />
        )}
        <span style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', width: 'max-content', maxWidth: 'calc(100vw - 48px)', textAlign: 'center', fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 11.5, color: keyTravel ? ACCENT : '#6B7684' }}>
          the key travels inside the link — sender to recipient, never through OnePeek
        </span>
      </div>

      {/* Step info */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 12, paddingTop: 8 }}>
        <span style={{ fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 13, color: ACCENT }}>STEP {step + 1} / 6</span>
        <span style={{ fontSize: 26, color: '#F4F5F6', letterSpacing: -0.3 }}>{STEPS[step].name}</span>
        <p style={{ flex: '1 1 100%', margin: 0, fontSize: 16.5, color: '#A3ABB6', maxWidth: 720 }}>{STEPS[step].desc}</p>
      </div>

      {/* Step buttons */}
      <div role="group" aria-label="Process steps" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
        {STEPS.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => { setStep(i); setPaused(true); }}
            style={{
              minHeight: 44,
              padding: '8px 12px',
              borderRadius: 8,
              border: `1px solid ${i === step ? ACCENT : '#262C35'}`,
              background: i === step ? 'color-mix(in srgb, #C8F135 8%, transparent)' : 'transparent',
              color: i === step ? ACCENT : '#A3ABB6',
              fontFamily: 'inherit',
              fontSize: 13.5,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all .2s',
            }}
          >
            <span style={{ fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 11, marginRight: 6 }}>{String(i + 1).padStart(2, '0')}</span>
            {s.name}
            {i === step && <div style={{ height: 2, background: ACCENT, marginTop: 6, borderRadius: 1, animation: 'progress 3.2s linear' }} />}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setPaused(p => !p)}
        className="gp-btn gp-ghost"
        style={{ alignSelf: 'flex-start', marginTop: 4 }}
      >
        {paused ? 'Play' : 'Pause'}
      </button>

      <style jsx>{`
        @keyframes packet {
          0% { left: 0; opacity: 0; }
          15% { opacity: 1; }
          85% { opacity: 1; }
          100% { left: calc(100% - 16px); opacity: 0; }
        }
        @keyframes keyTravel {
          0% { left: 0; }
          100% { left: calc(100% - 18px); }
        }
        @keyframes progress {
          from { width: 0; }
          to { width: 100%; }
        }
      `}</style>
    </div>
  );
}
