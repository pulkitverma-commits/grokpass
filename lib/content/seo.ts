// Search landing pages. Each one answers a single question people search for.
// Only describe features that exist today.

export type SeoPage = {
  slug: string;
  short: string;
  title: string;
  description: string;
  h1: string;
  intro: string;
  steps: string[];
  benefits: { title: string; body: string }[];
  faqs: { q: string; a: string }[];
  related: string[]; // use-case slugs
};

export const SEO_PAGES: SeoPage[] = [
  {
    slug: 'share-passwords-securely',
    short: 'Share passwords securely',
    title: 'How to share a password securely (free, no sign-up) · OnePeek',
    description: 'Share a password with a one-time link that is encrypted in your browser and deleted after it’s opened. Free, no account needed.',
    h1: 'Share a password securely',
    intro: 'Sending a password over WhatsApp, Slack or email leaves a copy in chat history, backups and every linked device. A OnePeek link carries the password encrypted, opens once, and then the password is gone for good.',
    steps: [
      'Open onepeek.io and type or paste the password.',
      'Choose how long the link should last and how many times it can be opened (once is safest).',
      'For extra safety, open More protection and turn on “Lock to a recipient”, so it only opens after they enter a code we email them.',
      'Send the link. When it’s opened, the password is shown once and deleted from our servers.',
    ],
    benefits: [
      { title: 'Encrypted before it leaves your device', body: 'AES-256-GCM encryption happens in your browser. The key stays in the part of the link after the #, which browsers never send to a server.' },
      { title: 'Nothing left in chat history', body: 'The chat only contains a link. Once it’s opened or expires, the link shows nothing.' },
      { title: 'Know when it was opened', body: 'Sign in to see when each secret was opened and roughly where, and burn any link that hasn’t been opened yet.' },
    ],
    faqs: [
      { q: 'Is it safe to send a password by email?', a: 'Email is stored on several servers and in every inbox it reaches, often for years. Sending a one-time link instead means the password itself never sits in the email.' },
      { q: 'Can OnePeek read my password?', a: 'No. It is encrypted in your browser and the key never reaches our servers. We only store unreadable ciphertext until it is opened or expires.' },
      { q: 'What if someone else opens the link first?', a: 'The real recipient will see that the secret has already been opened, so you’ll know to change the password. For extra safety, lock the link to the recipient’s email.' },
    ],
    related: ['everyday', 'it'],
  },
  {
    slug: 'send-sensitive-documents',
    short: 'Send sensitive documents',
    title: 'Send sensitive documents securely with a self-destructing link · OnePeek',
    description: 'Send ID scans, contracts, payslips and medical reports with an encrypted link that opens once and can block downloads.',
    h1: 'Send sensitive documents securely',
    intro: 'ID scans, offer letters, payslips and reports end up stored in inboxes and chat backups long after they were needed. OnePeek encrypts the file in your browser and deletes it after it’s viewed.',
    steps: [
      'Choose the File tab on onepeek.io and pick the document (up to 50 MB today).',
      'Set the number of views and the expiry. For ID documents, one view within 24 hours is a good default.',
      'Under More protection, turn off downloading images if the recipient only needs to see it.',
      'Send the link by WhatsApp, email, Slack or Teams.',
    ],
    benefits: [
      { title: 'File encrypted end to end', body: 'The file is encrypted before upload. Our storage only holds unreadable data, which is removed after viewing or expiry.' },
      { title: 'View without saving', body: 'For images you can hide the Download button, turn off copying and keep the file blurred whenever the page isn’t in front.' },
      { title: 'Lock it to one person', body: 'Require the recipient to verify their email before the file opens, or limit opening to a place or a country.' },
    ],
    faqs: [
      { q: 'How large can the document be?', a: 'Up to 50 MB today. Sensitive Documents up to 1 GB is coming to the Pro plan.' },
      { q: 'Can the recipient take a screenshot?', a: 'No website can fully stop screenshots. OnePeek blurs the content when the page loses focus, reacts to common screenshot shortcuts and hides it when printing, which deters casual copying.' },
      { q: 'Do you keep a copy?', a: 'No. The encrypted file is deleted after the last allowed view or when the link expires, whichever comes first.' },
    ],
    related: ['hr', 'finance'],
  },
  {
    slug: 'one-time-secret-link',
    short: 'One-time secret links',
    title: 'Create a one-time secret link · OnePeek',
    description: 'Create a link that can be opened only once. The message is encrypted in your browser and deleted after the first view.',
    h1: 'Create a one-time secret link',
    intro: 'A one-time link is the simplest way to hand over something private: the recipient opens it, reads it, and the link stops working. OnePeek adds end-to-end encryption, expiry and opening alerts.',
    steps: [
      'Type your message on onepeek.io.',
      'Leave views at 1 and choose an expiry: 1 hour, 24 hours or longer.',
      'Copy the link, or share it straight to WhatsApp, Slack, Teams or email.',
      'After one view the secret is deleted. Anyone opening the link later sees that it’s gone.',
    ],
    benefits: [
      { title: 'Opens once, then disappears', body: 'The ciphertext is deleted from our database as part of the first successful open.' },
      { title: 'No account needed', body: 'Send up to 10 secrets a month without signing up. Sign in for history and alerts.' },
      { title: 'Ask for a secret too', body: 'Need someone to send you a password? Create a request link and they can reply with an encrypted secret only you can open.' },
    ],
    faqs: [
      { q: 'What happens if the link is never opened?', a: 'It expires at the time you chose and the encrypted data is deleted.' },
      { q: 'Can I cancel a link after sending it?', a: 'Yes. Signed-in senders can burn any link that hasn’t been opened from their dashboard.' },
      { q: 'Do link previews in chat apps open it?', a: 'No. The secret is only revealed after the recipient taps to open it, so automatic link previews don’t use up the view.' },
    ],
    related: ['everyday', 'support'],
  },
  {
    slug: 'self-destructing-message',
    short: 'Self-destructing messages',
    title: 'Send a self-destructing message · OnePeek',
    description: 'Send a private message that deletes itself after it’s read or after a set time. Encrypted end to end, free to start.',
    h1: 'Send a self-destructing message',
    intro: 'Some things shouldn’t live in a chat forever. A OnePeek message deletes itself after it’s read, or when the time you set runs out.',
    steps: [
      'Write your message on onepeek.io.',
      'Pick when it should disappear: after one view, or after a set time.',
      'Optionally add a viewing timer, so the message closes itself after a set number of seconds on screen.',
      'Share the link however you like.',
    ],
    benefits: [
      { title: 'Two ways to self-destruct', body: 'After a set number of views, or at an expiry time, whichever comes first.' },
      { title: 'Viewing timer', body: 'Choose how many seconds the reader gets before the message closes on their screen.' },
      { title: 'Blur until held', body: 'Keep the message blurred until the reader presses and holds, so it isn’t visible to people nearby.' },
    ],
    faqs: [
      { q: 'Is this the same as disappearing messages in WhatsApp?', a: 'Not quite. Disappearing messages still pass through and sit in the chat until the timer runs out. With OnePeek only a link goes in the chat, and the message itself is never stored in the app.' },
      { q: 'Can I see if it was read?', a: 'Signed-in senders see when each message was opened and get an email alert.' },
    ],
    related: ['everyday'],
  },
  {
    slug: 'share-api-keys-securely',
    short: 'Share API keys securely',
    title: 'Share API keys, tokens and .env secrets securely · OnePeek',
    description: 'Hand over API keys, database passwords and .env files with an encrypted one-time link instead of Slack or email.',
    h1: 'Share API keys and tokens securely',
    intro: 'API keys pasted into Slack or a ticket get indexed, searched and leaked. Send them with a OnePeek link: encrypted in your browser, opened once, and gone.',
    steps: [
      'Paste the key, token or the contents of a .env file into onepeek.io.',
      'Set one view and a short expiry, such as 1 hour.',
      'Lock it to the recipient’s email if you want to be sure only they can open it.',
      'Share the link in Slack or Teams. Only the link appears in the channel.',
    ],
    benefits: [
      { title: 'Keeps keys out of chat search', body: 'Workspace search, exports and integrations only ever see a link that stops working once used.' },
      { title: 'Copy with one click', body: 'The recipient copies the value with one click, without retyping it.' },
      { title: 'An API is on the way', body: 'Generate secret links from your own scripts and tools. See the developer preview.' },
    ],
    faqs: [
      { q: 'Should I still rotate a key after sharing it?', a: 'For long-lived production keys, yes: rotate on a schedule regardless of how they were shared. OnePeek reduces how many copies exist in the meantime.' },
      { q: 'Is there a size limit for text?', a: 'Text secrets can be long enough for a typical .env file. For larger files, use the File tab.' },
    ],
    related: ['developers', 'it'],
  },
  {
    slug: 'share-wifi-password',
    short: 'Share a Wi-Fi password',
    title: 'Share your Wi-Fi password with a QR code · OnePeek',
    description: 'Share your Wi-Fi name and password with guests as a one-time link that includes a QR code to join instantly.',
    h1: 'Share your Wi-Fi password with a QR code',
    intro: 'Guests, tenants and contractors all need the Wi-Fi password, and it usually ends up in a dozen chats. OnePeek sends it as a one-time link with a scannable QR code.',
    steps: [
      'Choose the Wi-Fi tab on onepeek.io.',
      'Enter the network name, password and security type.',
      'Send the link. The guest sees the password and a QR code their camera can scan to join.',
      'After they’ve opened it, the link is gone.',
    ],
    benefits: [
      { title: 'Join by scanning', body: 'The QR code works with the built-in camera on iPhone and Android.' },
      { title: 'No password in chat', body: 'Change the password less often, because it isn’t sitting in old conversations.' },
    ],
    faqs: [
      { q: 'Can I share it with several guests?', a: 'Yes. Allow more views, or create a separate link for each guest so you can see who opened theirs.' },
    ],
    related: ['everyday'],
  },
  {
    slug: 'encrypted-file-sharing',
    short: 'Encrypted file sharing',
    title: 'Encrypted file sharing with links that expire · OnePeek',
    description: 'Share files with end-to-end encryption, expiry, view limits and download controls. Free to start, no account needed.',
    h1: 'Encrypted file sharing with links that expire',
    intro: 'Most file-sharing links work forever and anyone who gets the link can open them. OnePeek encrypts the file in your browser and gives you control over who opens it, where, and for how long.',
    steps: [
      'Choose the File tab and select your file.',
      'Set the number of views and the expiry.',
      'Add controls: lock to an email, a place, a country or a time window.',
      'Send the link. The file is deleted after it has been viewed.',
    ],
    benefits: [
      { title: 'End-to-end encrypted', body: 'Files are encrypted with AES-256-GCM before upload. We never have the key.' },
      { title: 'Controls most file links don’t have', body: 'Recipient lock, geofence, country allow-list, time lock and daily opening window.' },
      { title: 'Open history', body: 'See when and where each file was opened, on a map.' },
    ],
    faqs: [
      { q: 'How is this different from Google Drive or WeTransfer?', a: 'Those services can read your files and their links usually stay valid until someone remembers to remove them. OnePeek can’t read your file and the link stops working on its own.' },
      { q: 'What file types are supported?', a: 'Any file type. Images preview in the browser; other files download after they’re decrypted on the recipient’s device.' },
    ],
    related: ['hr', 'finance', 'support'],
  },
];

export function seoPage(slug: string) {
  return SEO_PAGES.find(p => p.slug === slug);
}
