import type { Metadata } from 'next';
import LegalPage from '../components/LegalPage';

export const metadata: Metadata = {
  title: 'How our encryption works · OnePeek',
  description: 'How OnePeek encrypts secrets in your browser, what our servers store, and the limits you should know about.',
};

export default function EncryptionPage() {
  return (
    <LegalPage title="How our encryption works" updated="26 October 2026" eyebrow="SECURITY">
      <p>OnePeek is built so that we can’t read what you share. Everything is encrypted in your browser before it’s uploaded, and the key never reaches our servers. This page explains exactly how, what we do store, and where the limits are.</p>

      <h2>Sending a secret</h2>
      <ol>
        <li><strong>A fresh key for every secret.</strong> Your browser creates a random 256-bit key with the Web Crypto API. Keys are never reused.</li>
        <li><strong>Encrypted on your device.</strong> The text, file or Wi-Fi details are encrypted with AES-256-GCM, using a new random 96-bit IV each time. The file name, type, size and viewing timer are encrypted the same way.</li>
        <li><strong>Only ciphertext is uploaded.</strong> We store the scrambled bytes. GCM also detects tampering, so altered ciphertext won’t decrypt.</li>
        <li><strong>The key travels only in the link.</strong> It sits after the <code>#</code> in the link. Browsers never send that part to a server, so it doesn’t appear in our logs either.</li>
      </ol>

      <h2>Opening a secret</h2>
      <p>The viewer’s browser asks our server for the ciphertext. Before handing it over, the server checks any locks the sender chose: views left, expiry, time lock, country, geofence and recipient code. On the last allowed view the ciphertext is deleted from the database, and encrypted files are deleted from storage. The browser then decrypts it locally with the key from the link and removes the key from the address bar.</p>

      <h2>Requesting a secret</h2>
      <p>When you ask someone for a password, your browser creates an ECDH P-256 key pair. The public half goes into the request; the private half stays in your browser (and in an optional private link only you keep). The person answering encrypts in their browser with a one-off key pair: the shared secret goes through HKDF-SHA256 to make an AES-256-GCM key. We store only the result, which only your private key can open. The answer is deleted as soon as you read it.</p>

      <h2>What our servers can see</h2>
      <ul>
        <li>Ciphertext, which we can’t decrypt.</li>
        <li>When a secret was created, when it expires, and how many views it allows and has used.</li>
        <li>Settings needed to enforce your locks: the recipient email for “Lock to a recipient”, opening times, allowed countries and the geofence area.</li>
        <li>If you’re signed in: your history (who you noted a secret was for, whether it was opened and, if you asked for it, roughly where). Never the secret, the link or the key.</li>
      </ul>

      <h2>Limits you should know about</h2>
      <ul>
        <li><strong>The link is the key.</strong> Anyone who gets the full link can open the secret, so send it only to the right person. Recipient lock, time lock, country and geofence add checks on top.</li>
        <li><strong>Emailing a link puts the key in that inbox.</strong> For sensitive secrets, use a recipient lock or send the link over a different channel.</li>
        <li><strong>A viewer can still copy what they see.</strong> “Blur until held” and the watermark discourage screenshots, but nothing stops someone photographing a screen.</li>
        <li><strong>Location can be faked.</strong> Geofences rely on the location the viewer’s device reports. Country checks use the network address, which a VPN can change.</li>
        <li><strong>A compromised device isn’t protected.</strong> If malware is running on the sender’s or viewer’s device, it can read what’s on screen.</li>
      </ul>

      <h2>Check it yourself</h2>
      <p>Open your browser’s developer tools, go to the Network tab and send or open a secret. You’ll see only ciphertext being uploaded or downloaded. The part of the link after <code>#</code> never appears in any request.</p>

      <h2 id="report">Report a security issue</h2>
      <p>If you find a vulnerability, please email <a href="mailto:pulkit.verma@foxnetglobal.com">pulkit.verma@foxnetglobal.com</a> with steps to reproduce it. Please give us a reasonable time to fix it before sharing it publicly, and don’t access other people’s data while testing. Our <a href="/.well-known/security.txt">security.txt</a> has the same details.</p>
    </LegalPage>
  );
}
