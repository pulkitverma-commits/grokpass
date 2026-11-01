# Privacy policy additions for the OnePeek mobile app

Owner: `release`. Drafts for the human (and the web owner, who edits `app/privacy/page.tsx`). The current
policy at https://onepeek.io/privacy describes the website's one-time links. The app adds Secret Chat,
push notifications, device identifiers and local storage, and the store forms (`apps/mobile/store/**`)
point at this URL, so the policy must say these things before the first external TestFlight build or Play
closed test. **Drafts, not legal advice**; the same adviser who reviews the labels should read them. The
voice matches the existing page (short, plain, "what we never see / what we store").

Place the new section after "What we store" and before "How we use it", and update the date line.

---

## The OnePeek app (iPhone and Android)

The OnePeek app adds end-to-end encrypted chats to the one-time links described above. Everything in this
policy applies to the app; this section covers what is different.

**What we never see.** Chat messages, photos, files, file names, nicknames and reactions are encrypted on
your phone with the Messaging Layer Security protocol (MLS, RFC 9420) before they are sent. The keys are
created on your phone and stored in its secure hardware-backed storage (the iOS Keychain or the Android
Keystore). Our servers store only ciphertext, keyed by chat and device identifiers, and delete it when the
message timer or the chat's lifetime ends. We cannot read it, and neither can anyone who obtains a copy of
our database or backups.

**Account.** You can use chats as a guest without giving us anything but an anonymous account identifier
we create for your phone. If you sign in with Apple, Google or an email link, we store the email address
your sign-in provider gives us (Apple may give us a private relay address) and your account identifier.
That is the whole account record.

**Devices.** Each phone that joins a chat is registered as a device: a random device identifier, the
public half of its signing key, and a label made of the phone model and operating system version (for
example "iPhone 15 · iOS 18.1", never the name you gave your phone). You can see and revoke your devices
in Settings. Chat members see each other's device codes and nicknames; nicknames are encrypted and never
visible to us.

**Push notifications.** If you turn notifications on, the app registers your phone's push token (an
identifier issued by Apple or Google for delivering notifications) with us. We send it one fixed message,
"You have a new message in a private chat.", through Apple Push Notification service or Firebase Cloud
Messaging. A notification never contains the message, the sender or the chat name, but its delivery does
tell Apple or Google that a message arrived. We delete the token when you turn notifications off, sign
out, reset the app, or when Apple or Google tells us the token is no longer valid. We keep at most ten
tokens per account.

**Free one-time links from the app.** When you create a one-time link in the app, it carries an anonymous
per-install identifier so we can count your free links, in the same way the website uses a browser
storage entry. It is stored in your phone's secure storage, is not tied to your account, and is deleted
when you sign out or reset the app. We can tell that links created between two such resets came from the
same install; we never learn their content or keys.

**Reports.** "Report chat" sends us the chat's identifier and a reason from a fixed list. We cannot read
the chat, so a report tells us which encrypted room was reported and why, nothing more. We keep reports
for moderation and abuse prevention and may remove a room or its members from our servers in response.

**Where a one-time link was opened.** If the sender of a one-time link chose "Show me where it's opened"
on the website, we record the approximate city derived from the viewer's network address at the moment the
link is opened, whether it is opened in a browser or in the app, and show it to the sender. The app does
not read your phone's location; it has no location permission. Links limited to an area ("geofenced")
cannot be opened in the app and are handed to your browser instead.

**On your phone.** The app keeps your chat keys, your copy of recent messages (encrypted again with a key
in the phone's secure storage), your session and your settings on the phone only. They are excluded from
iCloud, iTunes/Finder and Android backups and from device-to-device transfers; a new phone starts with no
chats. "Reset chats on this phone" and uninstalling the app remove them. The app locks with your
biometrics or passcode; this is handled by your phone and we never see biometric data.

**What we do not do in the app.** There is no advertising, no analytics and no crash reporting software in
the app. The app contacts only onepeek.io and our database provider. If the app crashes, your phone may
offer to send a report to Apple or Google under their own policies; we do not receive it.

**Permissions.** Camera: to scan invite and secret QR codes and to take a photo you choose to send; the
image is encrypted on your phone before upload and never leaves it in the clear. Photos: read-only, for
pictures you choose to send; we delete the temporary copy after sending. Face ID / biometrics: to unlock
the app. Notifications: optional, as described above. The app asks for nothing else.

**Honest limits.** Photos keep the details your phone embeds in them (such as location and camera model)
unless your phone removes them; the app tells you this when you attach one. Screenshots cannot be blocked
on iOS; the app tells the chat when one is taken. A third-party keyboard sees what you type. The
encryption library we use (ts-mls) has not yet had an independent security audit. More at
onepeek.io/secret-chat.

**Deleting your data.** Messages and files are deleted by their timers; you can burn a chat for everyone.
Signing out deletes your push token from our servers and your keys from the phone. To delete your account
and every record tied to it (email, devices, push tokens, your one-time link history), use
<the account deletion page / Settings → Delete account, once built>; until then, email the address below
and we will delete it within 30 days.

---

## Other edits to the existing page

1. **"Service providers"** section: add Apple Push Notification service and Firebase Cloud Messaging
   (push delivery; they receive the push token and the fixed text), alongside the existing providers.
   Firebase Analytics is disabled on our Firebase project.
2. **"Your choices"**: add "In the app, Settings lets you turn notifications off, sign out, see and revoke
   your devices and reset the app's data on that phone."
3. **"Account details (optional)"** under "What we store": add "including accounts created through the
   app with Apple, Google or an email link".
4. **Children**: unchanged ("not intended for children under 13"); the stores declare 18+ as the target
   audience, which is consistent.
5. **Contact**: the stores publish `secret@onepeek.io`; make sure the policy's contact address is one that
   is monitored, and that deletion requests reach it.
6. **Date line** at the top.

## Account deletion page (needed by both stores; for the web owner)

Apple guideline 5.1.1(v) and Google Play's account-deletion policy both require a deletion path that does
not amount to "email us". Minimal web version: a signed-in page at `https://onepeek.io/account/delete`
that explains what is deleted (account email, user id, chat devices and their key packages, push tokens,
reports, one-time link history; encrypted chat and secret rows are deleted when the devices are removed or
by their timers), asks for confirmation, calls a service-role deletion (Supabase `auth.admin.deleteUser` plus
the owner-scoped rows), and signs the user out. The app's Settings then links to it ("Delete account" →
opens the browser). Play also wants the same URL usable **without** the app, which a web page is. Until it
exists, the store forms carry the privacy URL and the email, and both stores may object.
