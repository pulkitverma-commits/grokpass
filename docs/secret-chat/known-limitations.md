# Secret Chat — known limitations

Plain statements of what Secret Chat does not do. The public page (/secret-chat) says the same.

1. **Screenshots and cameras.** A website can't block screenshots outright; only native apps can (Android
   `FLAG_SECURE`, iOS capture detection). What Secret Chat does: someone else's Secret Chat message is only in
   the page while it is pressed and held; screenshot shortcuts (Print Screen, Cmd+Shift, Win+Shift+S,
   Ctrl+Shift+S) blur the chat for 3 seconds, clear a Print Screen copy and send an encrypted
   "may have taken a screenshot" notice to the room; Secret Chat also blurs when the pointer leaves the
   window; content blurs when the tab or app loses focus; printing, copying and dragging are blocked; and a
   faint watermark (viewer's name, device code, time) covers every screen. A phone's hardware screenshot
   buttons, screen recorders and cameras are not detectable from a browser.
2. **Unaudited MLS library.** Encryption uses MLS (RFC 9420) through `ts-mls`, an open-source TypeScript
   implementation. It has not had an independent security audit. It sits behind `lib/chat/mls.ts` so it
   can be swapped (for example for a WASM build of `mls-rs`).
3. **The owner admits new members.** Membership changes are committed by the room owner's device only, so
   two members never race to commit the same epoch. A person who redeems an invite waits until the owner
   has the chat open.
4. **Chats live on devices.** Keys are kept in this browser's IndexedDB, encrypted by a non-extractable
   key. A new device or browser joins as a new member; earlier messages do not follow you. Clearing site
   data removes your chats from that browser.
5. **View once is per chat, not per person.** The first member to open a view-once file uses up the view
   for everyone in the room (then a 2-minute download window closes). The sender can't open their own
   view-once file.
6. **Backups.** Supabase backups may keep ciphertext for the backup retention period. It can't be
   decrypted without device keys, which OnePeek never has.
7. **Notifications.** Push alerts are content-free ("You have a new message") but their delivery reveals
   to the push service that a message arrived. Turn them off in Chat → Settings.
8. **Encrypted files are deleted by a daily job.** Expired or burned files become unreadable immediately
   (their database rows are removed, so storage access is refused), and the encrypted objects are deleted
   by `/api/chat/cleanup` once a day.
9. **The local expiry stamp is not authenticated.** Each copy kept on a device (browser IndexedDB, the
   phone's SQLite file) is sealed with AES-GCM and bound to its record key, but its `expires_at` sits
   beside the ciphertext and is not part of the authenticated data (format v1). Someone with write
   access to that local store could extend or shorten a record's lifetime on that device without
   touching the ciphertext (they still cannot read, forge or move it). Accepted for now because the
   server enforces its own expiry independently and such an attacker already controls the device; a
   v2 format would bind the stamp as well (`packages/core/src/chat/keystore.ts`).
10. **Photos keep their embedded details.** The phone app sends a picked photo as the photo library hands
   it over (re-encoded by the picker, but with its EXIF metadata, including GPS location and camera
   model, wherever the phone keeps it). OnePeek does not strip it in this build; the attach sheet says
   so. Use the phone's own "remove location" option when sharing from the library, or send a screenshot
   of the photo, if the location matters more than the image quality.
11. **Keyboards.** In Secret rooms the phone app's composer turns off autocorrect, spell check,
   auto-capitalisation and autofill so a draft is not offered to the keyboard's personal dictionary.
   A third-party keyboard still sees every keystroke; the app cannot change that. Use the system
   keyboard for Secret rooms if that matters.
12. **Sent and opened files on the sender's phone.** The phone app deletes the picker's plaintext copy of a
   sent file once the send has settled, and sweeps the picker and viewer cache folders on every launch
   and on "Reset chats on this phone". The original photo stays in the phone's photo library, and a
   document picked from Files/iCloud Drive stays where it was; both are the user's, not OnePeek's.
13. **The phone app's free-quota id.** One-time links made from the phone app carry an anonymous per-install
   id (`p_client_id`, the same role as the website's `localStorage` entry) so the free quota can be counted.
   It is kept in the phone's keychain, this device only. Signing out and "Reset chats on this phone" wipe it
   (the quota then starts over); otherwise it persists, including across accounts used on the same phone
   and, on iOS, across deleting and reinstalling the app as long as the keychain keeps the entry. OnePeek
   can therefore tell that secrets created between two of those wipes came from the same phone; it never
   learns their content or keys.
14. **A failed send still uses up a ratchet step.** The MLS state is advanced and saved before a message is
   sent (forward secrecy: a key is never reused, even after a crash or retry), so a send that then fails, for
   example offline, consumes a ratchet generation that no one ever receives, and recipients simply skip it
   when they decrypt the next message; this is by design, not a bug to fix.
15. **What a matching safety number proves, and what it doesn't.** Safety numbers are computed from the
   signing keys inside the encrypted group (the MLS tree), so a server that swaps a member's key can no
   longer make two screens show the same number. The apps also compare each member's key in the group
   with the key the server lists for that device: the owner won't admit a key package that doesn't
   match, a member refuses a Welcome or a commit that brings in a key that doesn't match (the chat then
   stops syncing for that member and says "This member's key doesn't match the chat"), and a member
   whose key changes on the server afterwards is shown as a key mismatch and can't be marked verified.
   What remains open:
   - **Before admission.** A person who has used an invite but isn't let in yet has no key in the group,
     so there is no safety number to compare until the owner admits them; until then their key is only
     the one the server lists.
   - **Devices the server doesn't list.** A device that is still in the group but no longer listed (it
     left or was revoked and the owner's app hasn't committed the removal yet), or one a malicious server
     leaves out, is checked by format only; only an out-of-band safety-number comparison catches a wrong
     key there.
   - **Who sent a message.** Which member a message or nickname is shown under is still the server's
     word (security review F-3): the encryption proves a current member wrote it and nobody changed it,
     not which member.
   - **A refused key stops the chat for that member.** When a Welcome or commit is refused, that device
     stays at the last state it trusted and the chat can't continue there until the owner sorts it out
     (for example by removing the member and inviting them again). Chats made before this check, whose
     groups already hold a substituted key, show a key mismatch rather than recovering silently.
