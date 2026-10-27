import type { Metadata } from 'next';
import SiteFooter from '../components/SiteFooter';
import Link from 'next/link';
import Icon, { type IconName } from '../components/Icon';
import CryptoDemo from './CryptoDemo';
import Reveal from './Reveal';
import './encryption.css';

export const metadata: Metadata = {
  title: 'How our encryption works · OnePeek',
  description: 'How OnePeek encrypts secrets in your browser, what our servers store, and the limits you should know about.',
};

const SEND_STEPS: { icon: IconName; title: string; body: React.ReactNode }[] = [
  { icon: 'key', title: 'A fresh key for every secret', body: <>Your browser creates a random 256-bit key with the Web Crypto API. Keys are never reused.</> },
  { icon: 'lock', title: 'Encrypted on your device', body: <>Text, files and Wi-Fi details are encrypted with AES-256-GCM and a new random 96-bit IV. The file name, type, size and viewing timer are encrypted too.</> },
  { icon: 'send', title: 'Only ciphertext is uploaded', body: <>We store scrambled bytes. GCM also detects tampering, so altered ciphertext won’t decrypt.</> },
  { icon: 'eye', title: 'The key travels only in the link', body: <>It sits after the <code>#</code>. Browsers never send that part to a server, so it isn’t in our logs either.</> },
];

const LOCKS: { icon: IconName; label: string }[] = [
  { icon: 'eye', label: 'Views left' },
  { icon: 'clock', label: 'Not expired' },
  { icon: 'clock', label: 'Time lock' },
  { icon: 'globe', label: 'Country allowed' },
  { icon: 'pin', label: 'Inside the geofence' },
  { icon: 'user', label: 'Recipient code verified' },
];

const LIMITS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'key', title: 'The link is the key', body: 'Anyone with the full link can open the secret. Recipient lock, time lock, country and geofence add checks on top.' },
  { icon: 'inbox', title: 'Emailing a link puts the key in that inbox', body: 'For sensitive secrets, use a recipient lock or send the link over a different channel.' },
  { icon: 'image', title: 'A viewer can still copy what they see', body: '“Blur until held” and the watermark discourage screenshots, but nothing stops someone photographing a screen.' },
  { icon: 'pin', title: 'Location can be faked', body: 'Geofences trust the location the device reports. Country checks use the network address, which a VPN can change.' },
  { icon: 'ban', title: 'A compromised device isn’t protected', body: 'If malware runs on the sender’s or viewer’s device, it can read what’s on screen.' },
];

export default function EncryptionPage() {
  return (
    <div className="ex-page">
      <Reveal />
      <div className="bg-layer" aria-hidden="true">
        <div className="gp-grid" />
        <div className="gp-glow gp-glow-a" />
        <div className="gp-glow gp-glow-b" />
      </div>

      <header className="container ex-header">
        <Link href="/" className="logo" aria-label="OnePeek home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/onepeek-logo.png" alt="OnePeek" className="logo-img" width={149} height={56} />
        </Link>
        <Link href="/#send" className="gp-btn gp-ghost" style={{ textDecoration: 'none' }}>Send a secret →</Link>
      </header>

      <main className="container ex-main">
        {/* Hero */}
        <section className="ex-hero">
          <span className="eyebrow">Security</span>
          <h1>How our encryption <span>works</span></h1>
          <p className="ex-lede">OnePeek is built so that we can’t read what you share. Everything is encrypted in your browser before it’s uploaded, and the key never reaches our servers.</p>
          <p className="legal-updated">Last updated 26 October 2026</p>

          <div className="ex-flow" role="img" aria-label="Your browser encrypts the secret and uploads only ciphertext to OnePeek. The viewer’s browser downloads the ciphertext and decrypts it with the key from the link. The key goes straight from you to the viewer inside the link and never passes through our servers.">
            <div className="ex-node">
              <span className="ex-node-icon"><Icon name="lock" size={22} /></span>
              <strong>Your browser</strong>
              <small>creates the key · encrypts</small>
            </div>
            <div className="ex-pipe" aria-hidden="true">
              <span className="ex-packet">x9#Qa7</span><span className="ex-packet p2">Lm2$vK</span><span className="ex-packet p3">e0!Tz4</span>
              <em>ciphertext only</em>
            </div>
            <div className="ex-node ex-node-server">
              <span className="ex-node-icon"><Icon name="shield" size={22} /></span>
              <strong>OnePeek servers</strong>
              <small>store scrambled bytes · check locks</small>
            </div>
            <div className="ex-pipe" aria-hidden="true">
              <span className="ex-packet">x9#Qa7</span><span className="ex-packet p2">Lm2$vK</span><span className="ex-packet p3">e0!Tz4</span>
              <em>ciphertext only</em>
            </div>
            <div className="ex-node">
              <span className="ex-node-icon"><Icon name="eye" size={22} /></span>
              <strong>Viewer’s browser</strong>
              <small>decrypts with the key</small>
            </div>
          </div>
          <div className="ex-keylane" aria-hidden="true">
            <div className="ex-keytrack"><span className="ex-keytoken"><Icon name="key" size={16} /></span></div>
            <p><strong>#key</strong> rides inside the link, straight from you to the viewer. Browsers never send it to a server.</p>
          </div>
        </section>

        {/* Live demo */}
        <section className="ex-section ex-split ex-split-top ex-reveal">
          <div className="ex-copy">
            <span className="eyebrow">Try it</span>
            <h2>Real encryption, right here</h2>
            <p>This is the same process that runs when you send a secret. Type anything and watch your browser generate a key, encrypt it and build the link. Then it decrypts it again to prove the key is all you need.</p>
            <ul className="ex-ticks">
              <li><Icon name="check" size={15} /> Runs entirely on your device</li>
              <li><Icon name="check" size={15} /> A new IV for every encryption</li>
              <li><Icon name="check" size={15} /> 16-byte tag catches any tampering</li>
            </ul>
          </div>
          <CryptoDemo />
        </section>

        {/* Sending */}
        <section className="ex-section">
          <div className="ex-reveal">
            <span className="eyebrow">Sending a secret</span>
            <h2>Four steps, all in your browser</h2>
          </div>
          <ol className="ex-steps">
            {SEND_STEPS.map((s, i) => (
              <li key={s.title} className="ex-step ex-reveal" style={{ '--d': `${i * 120}ms` } as React.CSSProperties}>
                <span className="ex-step-num">{String(i + 1).padStart(2, '0')}</span>
                <span className="ex-step-icon"><Icon name={s.icon} size={20} /></span>
                <strong>{s.title}</strong>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Opening */}
        <section className="ex-section ex-split">
          <div className="ex-copy ex-reveal">
            <span className="eyebrow">Opening a secret</span>
            <h2>Every lock is checked before a single byte leaves</h2>
            <p>The viewer’s browser asks our server for the ciphertext. First, the server checks every lock the sender chose. On the last allowed view the ciphertext is deleted from the database and encrypted files are deleted from storage.</p>
            <p>The browser then decrypts locally with the key from the link and removes the key from the address bar.</p>
          </div>
          <div className="ex-locks ex-reveal" aria-label="Checks: views left, not expired, time lock, country, geofence, recipient code. Then the ciphertext is released, decrypted on the viewer’s device, and deleted on the last view.">
            {LOCKS.map((l, i) => (
              <div key={l.label} className="ex-lock" style={{ '--i': i } as React.CSSProperties}>
                <span className="ex-lock-icon"><Icon name={l.icon} size={16} /></span>
                <span>{l.label}</span>
                <span className="ex-lock-ok"><Icon name="check" size={14} strokeWidth={2.6} /></span>
              </div>
            ))}
            <div className="ex-lock ex-lock-final" style={{ '--i': 6 } as React.CSSProperties}>
              <span className="ex-lock-icon"><Icon name="lock" size={16} /></span>
              <span>Ciphertext released, decrypted on the viewer’s device</span>
            </div>
            <div className="ex-lock ex-lock-burn" style={{ '--i': 7 } as React.CSSProperties}>
              <span className="ex-lock-icon"><Icon name="flame" size={16} /></span>
              <span>Last view: deleted for good</span>
            </div>
          </div>
        </section>

        {/* Requests */}
        <section className="ex-section">
          <div className="ex-reveal ex-narrow">
            <span className="eyebrow">Requesting a secret</span>
            <h2>Encrypted to a key only you hold</h2>
            <p>When you ask someone for a password, your browser makes an ECDH P-256 key pair. The public half goes into the request; the private half stays in your browser (and in an optional private link only you keep). The answer is deleted as soon as you read it.</p>
          </div>
          <div className="ex-ecdh ex-reveal">
            <div className="ex-party">
              <span className="ex-party-tag">You</span>
              <div className="ex-k ex-k-pub"><Icon name="send" size={14} /> Public key <small>sent in the request</small></div>
              <div className="ex-k ex-k-priv"><Icon name="key" size={14} /> Private key <small>never leaves your browser</small></div>
            </div>
            <div className="ex-chain" aria-hidden="true">
              <span className="ex-c" style={{ '--i': 0 } as React.CSSProperties}>ECDH</span>
              <span className="ex-arrow">→</span>
              <span className="ex-c" style={{ '--i': 1 } as React.CSSProperties}>shared secret</span>
              <span className="ex-arrow">→</span>
              <span className="ex-c" style={{ '--i': 2 } as React.CSSProperties}>HKDF-SHA256</span>
              <span className="ex-arrow">→</span>
              <span className="ex-c" style={{ '--i': 3 } as React.CSSProperties}>AES-256-GCM</span>
            </div>
            <div className="ex-party">
              <span className="ex-party-tag">Them</span>
              <div className="ex-k"><Icon name="key" size={14} /> One-off key pair <small>made just for this answer</small></div>
              <div className="ex-k"><Icon name="lock" size={14} /> Encrypts in their browser <small>we store only the result</small></div>
            </div>
          </div>
        </section>

        {/* What we see */}
        <section className="ex-section">
          <div className="ex-reveal">
            <span className="eyebrow">Our servers</span>
            <h2>What we can and can’t see</h2>
          </div>
          <div className="ex-compare">
            <div className="ex-card ex-reveal">
              <h3><Icon name="eye" size={18} /> What we store</h3>
              <ul>
                <li>Ciphertext, which we can’t decrypt</li>
                <li>When a secret was created, when it expires, and how many views it allows and has used</li>
                <li>Settings needed to enforce your locks: recipient email, opening times, allowed countries and the geofence area</li>
                <li>If you’re signed in: your history, including who you noted it was for, whether it was opened and, if you asked, roughly where</li>
              </ul>
            </div>
            <div className="ex-card ex-card-never ex-reveal" style={{ '--d': '120ms' } as React.CSSProperties}>
              <h3><Icon name="ban" size={18} /> What we never see</h3>
              <ul>
                <li>Your secret, file or Wi-Fi password</li>
                <li>The key, or the part of the link after <code>#</code></li>
                <li>File names and types inside the secret</li>
                <li>Answers to your requests, which only your private key can open</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Limits */}
        <section className="ex-section">
          <div className="ex-reveal">
            <span className="eyebrow">Be aware</span>
            <h2>Limits you should know about</h2>
          </div>
          <div className="ex-limits">
            {LIMITS.map((l, i) => (
              <div key={l.title} className="ex-limit ex-reveal" style={{ '--d': `${i * 90}ms` } as React.CSSProperties}>
                <span className="ex-limit-icon"><Icon name={l.icon} size={18} /></span>
                <strong>{l.title}</strong>
                <p>{l.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Check it yourself */}
        <section className="ex-section ex-split">
          <div className="ex-copy ex-reveal">
            <span className="eyebrow">Don’t trust us, check</span>
            <h2>See it in your own browser</h2>
            <p>Open your browser’s developer tools, go to the Network tab and send or open a secret. You’ll only see ciphertext going up or coming down, and the part of the link after <code>#</code> never appears in any request.</p>
          </div>
          <div className="ex-devtools ex-reveal" aria-hidden="true">
            <div className="ex-dt-bar"><span className="dots"><span /><span /><span /></span><span>Elements</span><span>Console</span><span className="on">Network</span></div>
            <div className="ex-dt-row" style={{ '--i': 0 } as React.CSSProperties}><b>POST</b><span>rpc/create_secret</span><code>p_body: &quot;Qm9x7Kd2…f8Zt&quot;</code></div>
            <div className="ex-dt-row" style={{ '--i': 1 } as React.CSSProperties}><b>GET</b><span>/s/Xy7Pq2mN4k</span><code>no #fragment sent</code></div>
            <div className="ex-dt-row" style={{ '--i': 2 } as React.CSSProperties}><b>POST</b><span>/api/open</span><code>body: &quot;Qm9x7Kd2…f8Zt&quot;</code></div>
            <div className="ex-dt-foot"><Icon name="check" size={13} /> Plaintext and key: not found in any request</div>
          </div>
        </section>

        {/* Report */}
        <section className="ex-section ex-report ex-reveal" id="report">
          <span className="ex-report-icon"><Icon name="shield" size={26} /></span>
          <div>
            <h2>Report a security issue</h2>
            <p>If you find a vulnerability, please email <a href="mailto:secret@onepeek.io">secret@onepeek.io</a> with steps to reproduce it. Please give us a reasonable time to fix it before sharing it publicly, and don’t access other people’s data while testing. Our <a href="/.well-known/security.txt">security.txt</a> has the same details.</p>
          </div>
        </section>

      </main>
      <SiteFooter />
    </div>
  );
}
