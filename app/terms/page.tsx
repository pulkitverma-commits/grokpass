import type { Metadata } from 'next';
import LegalPage from '../components/LegalPage';

export const metadata: Metadata = { title: 'Terms of Service · OnePeek' };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="26 October 2026">
      <p>By using OnePeek you agree to these terms. If you do not agree, please do not use the service.</p>

      <h2>The service</h2>
      <p>OnePeek encrypts secrets in your browser and creates one-time links. A secret can be opened once and is then permanently deleted. Unopened secrets are deleted when they expire.</p>

      <h2>Your responsibilities</h2>
      <ul>
        <li>Share links only with the people meant to receive them. Anyone with the full link can open the secret once.</li>
        <li>Keep your own copy of anything you need. Deleted secrets cannot be recovered by anyone, including us.</li>
        <li>Keep your account login details safe.</li>
      </ul>

      <h2>Acceptable use</h2>
      <p>Do not use OnePeek to share illegal content, malware or material that infringes others’ rights, to harass or defraud anyone, to send spam, or to probe, overload or disrupt the service. We may remove content or suspend access when we reasonably believe these terms are being broken.</p>

      <h2>Plans and limits</h2>
      <p>Free use includes a limited number of secrets. Referrals and paid plans such as OnePeek+ may raise that limit. Prices and limits may change, and we will tell you before any paid plan you hold changes.</p>

      <h2>No warranty</h2>
      <p>OnePeek is provided “as is” and “as available”. We work to keep it secure and available but do not guarantee uninterrupted service, delivery of emails, or that a secret will be opened before it expires.</p>

      <h2>Limitation of liability</h2>
      <p>To the extent permitted by law, OnePeek is not liable for indirect or consequential losses, or for loss of data that was deleted as designed, expired, or shared by you with the wrong person.</p>

      <h2>Changes and termination</h2>
      <p>We may update these terms and will change the date above when we do. You can stop using OnePeek at any time. We may suspend accounts that break these terms.</p>

      <h2>Governing law</h2>
      <p>These terms are governed by the laws of India, and courts in New Delhi have jurisdiction.</p>

      <h2>Contact</h2>
      <p><a href="mailto:pulkit.verma@foxnetglobal.com">pulkit.verma@foxnetglobal.com</a></p>
    </LegalPage>
  );
}
