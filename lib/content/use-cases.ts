// Use cases and playbooks: practical, step-by-step ways to use OnePeek.
// Only describe features that exist today.

export type Playbook = {
  id: string;
  title: string;
  when: string;
  steps: string[];
  settings: string[];
};

export type UseCase = {
  slug: string;
  short: string;
  title: string;
  description: string;
  intro: string;
  risks: string[];
  examples: { title: string; body: string }[];
  playbooks: Playbook[];
  dont: string[];
};

export const USE_CASES: UseCase[] = [
  {
    slug: 'everyday',
    short: 'Everyday sharing',
    title: 'Share passwords and private details with family and friends',
    description: 'Send a Wi-Fi password, a streaming login, an ID scan or bank details to family and friends without leaving them in your chats forever.',
    intro: 'Most private details get shared over WhatsApp, SMS or email, where they sit in chat history and backups for years. With OnePeek you send a link instead. It opens once, then the secret is gone.',
    risks: [
      'Passwords and ID photos stay in chat history, cloud backups and on every linked device.',
      'A lost or shared phone exposes everything ever sent to it.',
      'Forwarded messages travel further than you meant them to.',
    ],
    examples: [
      { title: 'Wi-Fi for guests', body: 'Use the Wi-Fi tab. Your guest gets the password plus a QR code their phone camera can scan to join, and nothing stays in your chats.' },
      { title: 'A passport or Aadhaar scan for a travel agent', body: 'Upload the image, set it to open once within 24 hours and turn on “Turn off downloading images”, so it’s shown on screen without a Download button.' },
      { title: 'A streaming or utility login for a family member', body: 'Send the login as text with one view. If they lose the message, the link has already burned.' },
      { title: 'Bank details for a one-off payment', body: 'Send the account number and IFSC with a 1-hour expiry so it can’t be reused later.' },
    ],
    playbooks: [
      {
        id: 'guest-wifi',
        title: 'Give a guest your Wi-Fi without a sticky note',
        when: 'Visitors, a new tenant, a house-sitter.',
        steps: ['Open onepeek.io and choose the Wi-Fi tab.', 'Enter the network name and password.', 'Create the link and tap QR code to show it on your screen, or send the link.', 'Your guest scans or opens it once and joins. The details are then deleted.'],
        settings: ['Views: 1', 'Expiry: 24 hours'],
      },
      {
        id: 'id-scan',
        title: 'Send an ID document to someone who needs it once',
        when: 'Hotels, travel agents, landlords, KYC by a person you trust.',
        steps: ['Choose Image or file and upload the scan.', 'Open More protection and turn on “Turn off downloading images” and “Blur until held”.', 'Create the link and send it by WhatsApp or email.', 'Ask them to confirm they’ve seen it. The link is then dead.'],
        settings: ['Views: 1', 'Expiry: 24 hours', 'Turn off downloading images', 'Blur until held (adds a watermark)'],
      },
    ],
    dont: ['Don’t send the link and a description of what’s inside in the same message.', 'Don’t share one-time passwords (OTPs) from your bank with anyone, ever.'],
  },
  {
    slug: 'hr',
    short: 'HR teams',
    title: 'OnePeek for HR: onboarding logins, payroll details and employee documents',
    description: 'Give new joiners their first passwords, collect bank details and ID documents, and send salary information without leaving it in inboxes.',
    intro: 'HR handles some of the most sensitive data in a company: bank accounts, ID numbers, salaries and first-day credentials. Email keeps all of it searchable forever. OnePeek lets HR send and collect it through links that open once.',
    risks: [
      'Temporary passwords emailed to new joiners stay in inboxes long after they are changed.',
      'Candidates email PAN, Aadhaar and bank details as attachments that get forwarded and archived.',
      'Salary and offer details sent to the wrong address can’t be recalled.',
    ],
    examples: [
      { title: 'Day-one credentials', body: 'Send the laptop and email password as a one-view secret locked to the new joiner’s personal email, so only they can open it.' },
      { title: 'Collecting bank details from a new hire', body: 'Create a request from your dashboard (Requests → New request). The new hire types the details into the link. It’s encrypted to a key only your browser holds, and you read it once.' },
      { title: 'Offer letter or salary revision', body: 'Upload the PDF with a 7-day expiry and a recipient lock, so a mistyped address doesn’t expose it.' },
      { title: 'Exit formalities', body: 'Share final settlement details once, with an opened alert so you know when the employee has seen them.' },
    ],
    playbooks: [
      {
        id: 'hr-onboarding',
        title: 'Onboard a new joiner without emailing passwords',
        when: 'Before or on the joining date.',
        steps: ['Sign in so the secret appears in your history.', 'Paste the temporary password and write who it’s for in “Who is this for?”.', 'In More protection, turn on “Lock to a recipient” with the joiner’s personal email.', 'Turn on “Opens after a set time” if it shouldn’t work before day one.', 'Create the link and email it. You get an alert when it’s opened.', 'Ask the joiner to change the password at first sign-in.'],
        settings: ['Views: 1', 'Expiry: 7 days', 'Lock to a recipient', 'Opens after a set time (optional)', 'Opened alerts on'],
      },
      {
        id: 'hr-collect-bank',
        title: 'Collect bank details or ID numbers from a candidate',
        when: 'Payroll setup, background checks.',
        steps: ['Dashboard → Requests → New request.', 'Describe what you need, e.g. “Bank account number and IFSC for salary”. Don’t put secrets in the note.', 'Send the request link to the candidate.', 'They type the details. They’re encrypted in their browser to your key.', 'You get an alert. Open it once from the same browser, copy the details into payroll, and it’s deleted.'],
        settings: ['Requests last up to 7 days on Free, 30 days on Plus and Pro', 'Open from the browser that created the request (or keep the private key link safe)'],
      },
    ],
    dont: ['Don’t keep copies of opened secrets in shared drives. Enter them where they belong, then let the link burn.', 'Don’t send the recipient lock email and the link to the same person through two people. Keep it simple: one person, one link.'],
  },
  {
    slug: 'developers',
    short: 'Developers',
    title: 'OnePeek for developers: share API keys, .env files and database credentials safely',
    description: 'Hand off API keys, SSH keys, .env files and database passwords to teammates, contractors and clients without leaving them in Slack, Git or email.',
    intro: 'Secrets pasted into Slack, Jira or email end up in search indexes, exports and backups. A leaked key in a chat log is a common way in. OnePeek gives you a one-time link: the secret is encrypted in your browser, and the server only ever holds ciphertext.',
    risks: [
      'Keys pasted in Slack or Teams are searchable by everyone in the channel, and kept by exports and integrations.',
      '.env files emailed to contractors stay in their inbox after the contract ends.',
      'Production credentials end up in tickets, screenshots and screen recordings.',
    ],
    examples: [
      { title: 'A .env file for a new contractor', body: 'Upload the file with one view and a recipient lock to their work email. They download it once.' },
      { title: 'Rotating a database password', body: 'Send the new password with a 1-hour expiry and a viewing timer, so it isn’t left open on someone’s screen.' },
      { title: 'Getting a client’s cloud credentials', body: 'Send a request link. The client pastes the key, it’s encrypted to your browser’s key, and it never sits in their email.' },
      { title: 'On-call handover', body: 'Share the break-glass password with a time window (only during office hours) and an opened alert.' },
    ],
    playbooks: [
      {
        id: 'dev-share-key',
        title: 'Share an API key with a teammate',
        when: 'Setting up a service, rotating keys, pairing.',
        steps: ['Paste the key into OnePeek (text).', 'Set Views to 1 and Expiry to 1 hour.', 'Add a 60-second viewing timer if they’ll copy it straight away.', 'Create the link and send it with Microsoft Teams, Slack or email.', 'When it shows as Opened in your dashboard, nobody else can use the link.'],
        settings: ['Views: 1', 'Expiry: 1 hour', 'Viewing timer: 60s', 'Turn off copying: no (they need to paste it)'],
      },
      {
        id: 'dev-collect-client-secret',
        title: 'Collect credentials from a client',
        when: 'Integrations, migrations, onboarding a customer.',
        steps: ['Dashboard → Requests → New request.', 'Write what you need, e.g. “Read-only AWS access key for the billing account”.', 'Send the link to your client contact.', 'They paste the key. It’s encrypted to your private key in their browser.', 'Open it once, put it straight into your secret manager, and the answer is deleted.'],
        settings: ['Keep the request page open in the browser that created it, or save the private key link somewhere safe'],
      },
    ],
    dont: ['Don’t commit secrets to Git, even private repos. Use a secret manager for storage and OnePeek for handoffs.', 'Don’t paste the OnePeek link into a public channel. Anyone with the full link can open it once.'],
  },
  {
    slug: 'support',
    short: 'Support teams',
    title: 'OnePeek for support teams: temporary passwords and account access without ticket leaks',
    description: 'Send temporary passwords and collect account details from customers without leaving them in your helpdesk, chat transcripts or email threads.',
    intro: 'Support tickets are read by many agents, exported to analytics tools and kept for years. Every password typed into a ticket is a liability. With OnePeek, the ticket only ever holds a link that stops working once it’s opened.',
    risks: [
      'Customers paste passwords into tickets and live chat, where every agent and integration can see them.',
      'Temporary passwords in ticket replies are still there months later.',
      'Screenshots of admin panels with credentials get attached to tickets.',
    ],
    examples: [
      { title: 'Temporary password after a reset', body: 'Send it as a one-view link with a 24-hour expiry. The ticket keeps the link, not the password.' },
      { title: 'Customer needs to give you access', body: 'Send a request link instead of asking them to reply with their password. Their answer is encrypted to your browser only.' },
      { title: 'Licence keys and activation codes', body: 'Send each key as its own link so it can’t be copied from a shared thread.' },
    ],
    playbooks: [
      {
        id: 'support-temp-password',
        title: 'Send a temporary password from a ticket',
        when: 'Password resets, new accounts, guest access.',
        steps: ['Generate the temporary password in your admin tool.', 'Paste it into OnePeek with Views 1 and Expiry 24 hours.', 'Write the ticket number in “Who is this for?” so you can track it in your history.', 'Paste the link into your ticket reply, not the password.', 'Ask the customer to change the password after signing in.'],
        settings: ['Views: 1', 'Expiry: 24 hours', 'Opened alerts on'],
      },
      {
        id: 'support-collect',
        title: 'Collect account details from a customer',
        when: 'When you genuinely need a credential to fix something.',
        steps: ['Dashboard → Requests → New request with a clear note, e.g. “Store admin password so we can fix your payment settings”.', 'Paste the request link into the ticket.', 'The customer fills it in. You get an alert.', 'Open it once, fix the issue, then ask the customer to change the password.'],
        settings: ['Never ask for OTPs, card numbers or UPI PINs. No legitimate support process needs them.'],
      },
    ],
    dont: ['Don’t ask customers for one-time codes, card numbers or PINs in any form.', 'Don’t copy opened secrets into internal notes. Use them, then let them go.'],
  },
  {
    slug: 'it',
    short: 'IT & MSPs',
    title: 'OnePeek for IT teams and MSPs: device handovers, admin passwords and client credentials',
    description: 'Hand over devices, Wi-Fi, router and admin passwords to staff and clients with one-time links, QR codes and geofences.',
    intro: 'IT teams and managed service providers move credentials between staff, vendors and clients every day: routers, NVRs, firewalls, Wi-Fi and admin accounts. OnePeek makes each handover a link that opens once, can be limited to a place or time, and tells you when it was opened.',
    risks: [
      'Site passwords written on handover sheets or sent on WhatsApp groups.',
      'Shared admin passwords that outlive the project and the people on it.',
      'No record of who received which credential, and when.',
    ],
    examples: [
      { title: 'Site handover', body: 'Send the NVR or router admin password with a geofence around the client site, so it only opens there.' },
      { title: 'Office Wi-Fi for a new branch', body: 'Use the Wi-Fi tab and show the QR code on screen at the handover. Nothing gets written down.' },
      { title: 'Vendor access window', body: 'Lock a credential to office hours with “Only during certain hours”, and to India with the country allow-list.' },
    ],
    playbooks: [
      {
        id: 'it-site-handover',
        title: 'Hand over a site password that only opens on site',
        when: 'Installation sign-off, field engineers, client handovers.',
        steps: ['Sign in, paste the password and note the site in “Who is this for?”.', 'Turn on the geofence and pick the site address, with a radius like 200 m.', 'Optionally lock it to the client’s email with “Lock to a recipient”.', 'Create the link and share it, or show the QR code at the handover.', 'The client opens it on site. You see when and roughly where in your dashboard.'],
        settings: ['Geofence: 200 m around the site', 'Views: 1', 'Expiry: 7 days', 'Lock to a recipient (optional)'],
      },
      {
        id: 'it-vendor-window',
        title: 'Give a vendor time-boxed access',
        when: 'Maintenance windows, audits, support calls.',
        steps: ['Paste the credential.', 'Turn on “Opens after a set time” for the start of the window.', 'Set the expiry to the end of the window.', 'Add “Only from certain countries” if the vendor works from a known country.', 'Rotate the password after the work is done.'],
        settings: ['Opens after a set time', 'Custom expiry', 'Country allow-list'],
      },
    ],
    dont: ['Don’t reuse one admin password across clients. Rotate it, then send the new one.', 'Location checks rely on the viewer’s device and network, so treat them as an extra check, not the only one.'],
  },
  {
    slug: 'finance',
    short: 'Finance & accounts',
    title: 'OnePeek for finance teams: bank details, tax documents and statements',
    description: 'Share bank account details, tax documents and statements with clients, auditors and vendors through links that open once.',
    intro: 'Changed bank details are the oldest trick in invoice fraud, and statements and tax documents are exactly what attackers look for in a mailbox. OnePeek keeps them out of email threads: each document or detail opens once, for the person you meant.',
    risks: [
      'Bank details in email can be altered by anyone who gets into the mailbox.',
      'Statements and ITR documents sit in inboxes and shared folders for years.',
      'Auditors and consultants receive more than they need, for longer than they need it.',
    ],
    examples: [
      { title: 'Vendor bank details', body: 'Send your account details with a recipient lock, and confirm them on a phone call. Never accept changes over email alone.' },
      { title: 'Documents for your CA or auditor', body: 'Upload statements as files with a 7-day expiry and several views if more than one person needs them.' },
      { title: 'Payroll file to the bank or a processor', body: 'One view, a 1-hour expiry and an opened alert.' },
    ],
    playbooks: [
      {
        id: 'fin-bank-details',
        title: 'Share bank details safely with a new vendor or client',
        when: 'New vendors, invoices, refunds.',
        steps: ['Paste the account name, number, IFSC and branch.', 'Lock it to the recipient’s business email.', 'Create the link and send it.', 'Confirm the details on a call before any payment is made.'],
        settings: ['Views: 1', 'Expiry: 24 hours', 'Lock to a recipient'],
      },
    ],
    dont: ['Don’t trust bank-detail changes that arrive only by email. Verify by phone.', 'Don’t send the document and its password in the same channel.'],
  },
];

export function useCase(slug: string) {
  return USE_CASES.find(u => u.slug === slug) || null;
}
