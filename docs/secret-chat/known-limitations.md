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
