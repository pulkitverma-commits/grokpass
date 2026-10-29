import type { Metadata } from 'next';
import Link from 'next/link';
import SiteShell from '../components/SiteShell';
import Icon, { type IconName } from '../components/Icon';

export const metadata: Metadata = {
  title: 'Secret Chat: end-to-end encrypted chats that disappear · OnePeek',
  description: 'Start a private chat with a link. Messages and files are end-to-end encrypted on your device with MLS, disappear on a timer, and the whole chat can be burned in one tap. Guests join without an account.',
  alternates: { canonical: '/secret-chat' },
  openGraph: {
    title: 'OnePeek Secret Chat',
    description: 'End-to-end encrypted chats and files that disappear. Share a link, talk, and leave nothing behind.',
    url: '/secret-chat',
  },
};

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'lock', title: 'End-to-end encrypted', body: 'Messages are encrypted on your device with MLS (RFC 9420), the IETF standard for group messaging. OnePeek only relays ciphertext and never holds the keys.' },
  { icon: 'clock', title: 'Messages that disappear', body: 'Pick 10 seconds to 24 hours. The countdown starts when a message is read, or when it’s sent. The server deletes it on its own clock, not the phone’s.' },
  { icon: 'file', title: 'Encrypted files and view once', body: 'Send photos and documents up to 50 MB. Each file gets its own key. Mark it view once and it opens one time, then it’s gone for everyone.' },
  { icon: 'user', title: 'Guests don’t need an account', body: 'Share an invite link or QR code. The other person joins in their browser in seconds. No app, no phone number, no sign-up.' },
  { icon: 'key', title: 'Access codes and approvals', body: 'Secret Chats add an access code that you share another way. Business Rooms let you approve each person before they can read anything.' },
  { icon: 'shield', title: 'Verify who you’re talking to', body: 'Compare a 60-digit safety number or scan a QR code. If someone’s key ever changes, the chat warns you.' },
  { icon: 'flame', title: 'Burn the chat', body: 'One tap deletes every message, invite and file from OnePeek’s servers and makes every device forget the chat’s keys.' },
  { icon: 'eye', title: 'Panic Exit and privacy screen', body: 'Press Shift + Esc twice to lock chats and jump away. Content blurs whenever you switch away from the tab or app.' },
  { icon: 'bell', title: 'Notifications without content', body: 'Optional alerts say only “You have a new message”. Never the text, the sender or the chat name.' },
];

const KINDS = [
  { name: 'Quick Chat', time: '1 minute after reading', body: 'For a quick private conversation. Share the link and talk.', bullets: ['Invite link and QR code', 'Guests join instantly', 'Messages count down once read'] },
  { name: 'Secret Chat', time: '30 seconds after reading', body: 'For the most sensitive conversations.', bullets: ['Access code required to join', 'Messages stay blurred until tapped', 'Files default to view once'] },
  { name: 'Business Room', time: '1 hour after sending', body: 'For clients, vendors and teams.', bullets: ['You approve every person', 'Verify identities with safety numbers', 'Invite links with use limits'] },
];

const STEPS = [
  'Start a chat at onepeek.io/chat and pick Quick, Secret or Business.',
  'Share the invite link or QR code. For a Secret Chat, send the access code another way, like a call.',
  'Your contact opens the link and joins in their browser. No account needed.',
  'Talk and share files. Everything is encrypted on each device and disappears on its timer.',
  'Done? Burn the chat, and it’s gone from the servers and every device.',
];

const FAQ = [
  { q: 'Can OnePeek read my chats?', a: 'No. Messages and files are encrypted on your device before they’re sent, and the keys stay on the devices in the chat. OnePeek stores and forwards ciphertext, and deletes it when the timer runs out.' },
  { q: 'Does the other person need an account?', a: 'No. Guests join from the invite link as a temporary, anonymous session that only works for that chat. Anyone can start a Quick Chat as a guest; Secret Chats and Business Rooms need a free OnePeek account.' },
  { q: 'What happens when a message disappears?', a: 'The server deletes it at the time it set when the message was read or sent, and each device removes its decrypted copy. A database job checks every minute.' },
  { q: 'Can someone take a screenshot?', a: 'Yes. No website or app can fully stop screenshots or a camera pointed at the screen. OnePeek blurs content when you switch away and hides Secret Chat messages until tapped, but anyone you chat with can still save what they see.' },
  { q: 'What encryption does it use?', a: 'MLS (Messaging Layer Security, RFC 9420) with X25519, AES-128-GCM, SHA-256 and Ed25519, which gives forward secrecy and post-compromise security. Files use a separate AES-256-GCM key each. The MLS library we use (ts-mls) has not yet had an independent audit.' },
  { q: 'Is it free?', a: 'Yes. Secret Chat is included on every plan while it’s in early access.' },
];

const LIMITS = [
  'Anyone in a chat can screenshot or photograph it. Disappearing messages limit what’s left behind, not what people choose to keep.',
  'New members are let in by the chat owner’s device, so the owner needs to have the chat open for someone to join.',
  'The MLS library (ts-mls) is an open-source implementation that hasn’t had an independent security audit yet.',
  'Chats live on the devices that joined them. A new device joins as a new member; old messages don’t follow you.',
];

export default function SecretChatPage() {
  const faqLd = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: FAQ.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
  return (
    <SiteShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
      <section className="pg-hero">
        <span className="eyebrow">Secret Chat · Early access</span>
        <h1>Private chats that <span>leave nothing behind.</span></h1>
        <p>Start an end-to-end encrypted chat with a link. Messages and files disappear on a timer, guests join without an account, and you can burn the whole chat in one tap.</p>
        <div className="pg-hero-cta">
          <Link href="/chat/new" className="gp-btn">Start a secret chat →</Link>
          <a href="#how" className="gp-btn gp-ghost">How it works</a>
        </div>
      </section>

      <section className="pg-section">
        <h2 className="pg-h2">Everything a private conversation needs</h2>
        <div className="card-grid">
          {FEATURES.map(f => (
            <div key={f.title} className="info-card">
              <Icon name={f.icon} size={18} />
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="pg-section">
        <h2 className="pg-h2">Three kinds of chat</h2>
        <p className="pg-sub">Pick the level of protection when you start. You can change the message timer any time.</p>
        <div className="plan-grid">
          {KINDS.map((k, i) => (
            <div key={k.name} className={`plan-card${i === 1 ? ' featured' : ''}`}>
              {i === 1 && <span className="plan-badge">Most private</span>}
              <h2>{k.name}</h2>
              <p className="plan-blurb">{k.body}</p>
              <ul>
                <li><Icon name="clock" size={15} strokeWidth={2.4} />Messages vanish {k.time}</li>
                {k.bullets.map(b => <li key={b}><Icon name="check" size={15} strokeWidth={2.4} />{b}</li>)}
              </ul>
              <Link href="/chat/new" className={`gp-btn plan-cta${i === 1 ? '' : ' gp-ghost'}`}>Start a {k.name}</Link>
            </div>
          ))}
        </div>
      </section>

      <section className="pg-section" id="how">
        <h2 className="pg-h2">How it works</h2>
        <ol className="step-list">
          {STEPS.map((s, i) => <li key={i}><span className="step-num">{i + 1}</span><span>{s}</span></li>)}
        </ol>
      </section>

      <section className="pg-section api-band">
        <div>
          <span className="eyebrow">What the server sees</span>
          <h2 className="pg-h2">Ciphertext, device ids and timers. Nothing else.</h2>
          <p className="pg-sub">No message text, no file names, no nicknames, no file keys. Invite links carry their token after the #, so it never reaches our logs. Access codes are stored only as hashes.</p>
        </div>
        <Link href="/encryption" className="gp-btn gp-ghost">How our encryption works</Link>
      </section>

      <section className="pg-section">
        <h2 className="pg-h2">Honest limits</h2>
        <ul className="risk-list">
          {LIMITS.map(l => <li key={l}><Icon name="ban" size={16} />{l}</li>)}
        </ul>
      </section>

      <section className="pg-section">
        <h2 className="pg-h2">Questions</h2>
        <div className="faq">
          {FAQ.map(f => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
        <div className="pg-hero-cta" style={{ marginTop: 28 }}>
          <Link href="/chat/new" className="gp-btn">Start a secret chat →</Link>
        </div>
      </section>
    </SiteShell>
  );
}
