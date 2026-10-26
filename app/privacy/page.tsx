import type { Metadata } from 'next';
import LegalPage from '../components/LegalPage';

export const metadata: Metadata = { title: 'Privacy Policy · OnePass' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="26 October 2026">
      <p>OnePass lets you share passwords, notes, images and files through one-time links. It is built so that we cannot read what you share. This policy explains what we do and do not collect.</p>

      <h2>What we never see</h2>
      <p>Every secret is encrypted with AES-256-GCM in your browser before it is uploaded. The decryption key is placed after the <code>#</code> in the link, which browsers never send to a server. We store only ciphertext and cannot decrypt it.</p>

      <h2>What we store</h2>
      <ul>
        <li><strong>Encrypted secrets.</strong> Ciphertext of the text, file and its encrypted details (name, type, size, viewing timer). It is permanently deleted when the secret is opened or when it expires (1 hour, 24 hours or 7 days), whichever comes first.</li>
        <li><strong>Usage counter.</strong> A random browser ID kept in your browser’s local storage, with the number of secrets created, your plan and referral code. It is used for the free quota and referrals, and contains no personal details.</li>
        <li><strong>Account details (optional).</strong> If you create an account or sign in with Google or Microsoft, we receive your email address and basic profile (name and picture) from that provider. We use it only to sign you in and show your account. We never receive your Google or Microsoft password and do not access your mail, contacts or files.</li>
        <li><strong>Email delivery (optional).</strong> If you choose to email a link, we pass the recipient’s address and the link to our email provider solely to deliver that message.</li>
      </ul>

      <h2>How we use it</h2>
      <p>Only to run OnePass: storing and deleting secrets, enforcing quotas, signing you in and delivering emails you request. We do not sell data, show ads, or use your data for profiling.</p>

      <h2>Service providers</h2>
      <p>OnePass is hosted on Vercel, and stores encrypted data and accounts with Supabase. Emails you send through OnePass are delivered by our email provider. These providers process data only on our behalf.</p>

      <h2>Cookies</h2>
      <p>We use only the cookies and local storage needed to keep you signed in and to count your free secrets. There are no advertising or tracking cookies.</p>

      <h2>Your choices</h2>
      <p>You can delete a secret by opening it, or let it expire. You can clear your browser storage to reset the usage counter. To delete your account and its details, email us at the address below.</p>

      <h2>Children</h2>
      <p>OnePass is not intended for children under 13.</p>

      <h2>Changes</h2>
      <p>If we change this policy we will update the date above.</p>

      <h2>Contact</h2>
      <p>Questions or deletion requests: <a href="mailto:pulkit.verma@foxnetglobal.com">pulkit.verma@foxnetglobal.com</a></p>
    </LegalPage>
  );
}
