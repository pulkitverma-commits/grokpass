# Secret Chat — known limitations

Plain statements of what Secret Chat does not do. The public page (/secret-chat) says the same.

1. **Screenshots and cameras.** No website or app can stop someone from screenshotting or photographing a
   chat. Content blurs when the tab or app loses focus and Secret Chat messages stay blurred until tapped,
   but anyone in the chat can still keep what they see.
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
