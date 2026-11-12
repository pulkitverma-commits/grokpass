import { SEO_PAGES } from '@/lib/content/seo';
import { USE_CASES } from '@/lib/content/use-cases';

export const dynamic = 'force-static';

const BASE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://onepeek.io').replace(/\/$/, '');

/** /llms.txt: a plain-text map of the public site for AI assistants and answer engines (llmstxt.org). */
export function GET() {
  const guides = SEO_PAGES.map(p => `- [${p.short}](${BASE}/${p.slug}): ${p.description}`).join('\n');
  const cases = USE_CASES.map(u => `- [${u.short}](${BASE}/use-cases/${u.slug}): ${u.description}`).join('\n');
  const body = `# OnePeek

> Zero-knowledge one-time secret sharing. Passwords, files, Wi-Fi details and private notes are encrypted in the sender's browser and deleted after they're viewed.

OnePeek turns a secret into a link. The secret is encrypted on the sender's device with AES-256-GCM and a fresh 256-bit key; the key travels only in the part of the link after the #, which browsers never send to a server, so OnePeek stores only ciphertext. Links open a set number of times or until they expire, then show nothing. Anyone can send up to 10 secrets a month free without an account. OnePeek also offers Secret Chat: end-to-end encrypted chats (MLS, RFC 9420) whose messages disappear on a timer.

## Product

- [Send a secret](${BASE}/): create a one-time link for text, a file or Wi-Fi details
- [Secret Chat](${BASE}/secret-chat): end-to-end encrypted chats and files that disappear
- [How the encryption works](${BASE}/encryption): what is encrypted, what the servers store, and the limits
- [Pricing](${BASE}/pricing): free, Plus, Pro, Teams, business and API plans
- [Integrations](${BASE}/integrations): Slack, Microsoft Teams, WhatsApp and email
- [Developers](${BASE}/developers): the OnePeek API (private beta)

## Guides

${guides}

## Use cases

${cases}
- [All playbooks](${BASE}/playbooks): step-by-step checklists on one page

## Legal

- [Privacy Policy](${BASE}/privacy)
- [Terms of Service](${BASE}/terms)
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
