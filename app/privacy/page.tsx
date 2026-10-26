import type { Metadata } from 'next';
import LegalPage from '../components/LegalPage';

export const metadata: Metadata = { title: 'Privacy Policy · OnePeek' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="26 October 2026">
      <p>OnePeek lets you share passwords, notes, images and files through one-time links. It is built so that we cannot read what you share. This policy explains what we do and do not collect.</p>

      <h2>What we never see</h2>
      <p>Every secret is encrypted with AES-256-GCM in your browser before it is uploaded. The decryption key is placed after the <code>#</code> in the link, which browsers never send to a server. We store only ciphertext and cannot decrypt it.</p>

      <h2>What we store</h2>
      <ul>
        <li><strong>Encrypted secrets.</strong> Ciphertext of the text, file or Wi-Fi details and its encrypted details (name, type, size, viewing timer). It is permanently deleted after the last allowed view, when the sender burns it, or when it expires (5 minutes to 7 days, or 30 days on OnePeek+), whichever comes first.</li>
        <li><strong>Protection settings.</strong> To enforce the options a sender picks, we keep them with the secret until it is deleted: the number of views, opening times, allowed countries, the geofence area and, for “Lock to a recipient”, the recipient’s email address. A recipient’s email also appears in the sender’s history.</li>
        <li><strong>One-time codes.</strong> For recipient-locked secrets we email a 6-digit code to the address the viewer enters. We store only a hash of the code, which expires after 10 minutes and is deleted with the secret.</li>
        <li><strong>Country checks.</strong> If a sender limits a secret to certain countries, we check the country of the viewer’s network address when they open it. We don’t store it for that check.</li>
        <li><strong>Watermarks.</strong> For secrets set to “Blur until held”, the viewer’s screen shows a faint watermark with their confirmed email or approximate city. It is shown only on their screen and isn’t stored.</li>
        <li><strong>Secret requests.</strong> When a signed-in user asks for a secret, we store the request note, an optional label and a public key. The answer is encrypted in the responder’s browser so only the requester can read it, and it is deleted as soon as it’s read or when the request expires. The requester’s name or email is shown to the person they ask.</li>
        <li><strong>Alerts.</strong> Signed-in senders can get an email or a browser notification when a secret is opened or a request is answered. We store their alert settings and, for browser notifications, the subscription address their browser gives us. Notifications are delivered through the browser maker’s push service (for example Google or Apple).</li>
        <li><strong>Usage counter.</strong> A random browser ID kept in your browser’s local storage, with the number of secrets created, your plan and referral code. It is used for the free quota and referrals, and contains no personal details.</li>
        <li><strong>Account details (optional).</strong> If you create an account or sign in with Google or Microsoft, we receive your email address and basic profile (name and picture) from that provider. We use it only to sign you in and show your account. We never receive your Google or Microsoft password and do not access your mail, contacts or files.</li>
        <li><strong>Secret history (signed-in senders).</strong> When you are signed in, we keep a history of the secrets you send: when it was sent and expires, whether it was opened, its type and size, and the recipient name or email you choose to note. It never includes the secret, the link or the key. You can delete any entry or your whole history from your dashboard.</li>
        <li><strong>Where a secret was opened (only if the sender turns it on).</strong> A sender can ask to see where a secret is opened. The person opening it is told before they reveal it and chooses how. They can share their device location (their browser asks for permission), and we store it rounded to about 10 m with the area name, which we look up with OpenStreetMap’s Photon or Nominatim service (they receive the coordinates, not who you are). Or they can share only an approximate city worked out from their network address. We never store the IP address.</li>
        <li><strong>Geofenced secrets.</strong> A sender can lock a secret to a place and radius. To open it, the viewer’s browser shares its location once so we can check it is inside the area (with a 5% margin). If the sender didn’t also ask to see where it was opened, that location is used only for the check and is not stored.</li>
        <li><strong>Profile photo.</strong> Your account picture comes from Google or Microsoft. If there isn’t one, we look up a Gravatar image using a one-way hash of your email.</li>
        <li><strong>Email delivery (optional).</strong> If you choose to email a link, we pass the recipient’s address and the link to our email provider solely to deliver that message.</li>
      </ul>

      <h2>How we use it</h2>
      <p>Only to run OnePeek: storing and deleting secrets, enforcing quotas, signing you in and delivering emails you request. We do not sell data, show ads, or use your data for profiling.</p>

      <h2>Service providers</h2>
      <p>OnePeek is hosted on Vercel, and stores encrypted data and accounts with Supabase. Emails are delivered by Mailchimp Transactional (Mandrill). Maps load from OpenFreeMap, and place names come from Photon and Nominatim (OpenStreetMap). These providers process data only to provide their service.</p>

      <h2>Cookies</h2>
      <p>We use only the cookies and local storage needed to keep you signed in and to count your free secrets. There are no advertising or tracking cookies.</p>

      <h2>Your choices</h2>
      <p>You can delete a secret by opening it, or let it expire. You can clear your browser storage to reset the usage counter. To delete your account and its details, email us at the address below.</p>

      <h2>Children</h2>
      <p>OnePeek is not intended for children under 13.</p>

      <h2>Changes</h2>
      <p>If we change this policy we will update the date above.</p>

      <h2>Contact</h2>
      <p>Questions or deletion requests: <a href="mailto:pulkit.verma@foxnetglobal.com">pulkit.verma@foxnetglobal.com</a></p>
    </LegalPage>
  );
}
