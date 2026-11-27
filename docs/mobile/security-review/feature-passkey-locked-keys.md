# Security review: passkey lock for the browser chat keystore (`feature/passkey-locked-keys`, commit 8d11aba)

Reviewer: security-reviewer. Date: 2026-11-27. Read-only review of `git show 8d11aba` plus the code it calls (`packages/core/src/chat/client.ts`, `packages/core/src/adapters/web/platform.ts`, `lib/security-headers.js`, `middleware.ts`, `app/chat/r/[id]/page.tsx`). No tests or builds run. Line numbers are at 8d11aba.

Attackers considered:
- (P) someone with a copy of the browser profile: a backup, a stolen disk image, or malware that copies files without code execution in the page;
- (X) script running in the onepeek.io origin: XSS on any path, or a compromised third-party script;
- (L) someone with brief physical access to an unlocked computer;
- (R) ordinary races between tabs and between async operations in one tab. No attacker is needed; the result is data loss or weaker forward secrecy.

## Verdict

The cryptographic core is sound. The KEK is HKDF-SHA256(PRF, salt = credId, info). The data key is a fresh 256-bit random key, wrapped with AES-GCM under a random IV. The PRF salt is per store, user verification is required, `allowCredentials` is pinned on unlock, and nothing new reaches the network, logs, analytics or push.

The weaknesses are around the core:
1. **The lock switch and the re-seal are not serialized against concurrent writers** (PK-1, high). Normal multi-tab use, or a sync running while the person taps "Turn on", can:
   - roll back MLS state;
   - bring back messages and rooms that were burned or deleted;
   - make records unreadable, which the client then treats as "no such record".
   That last case is the exact failure the commit says it prevents.
2. **Turning the lock on does not protect against the copies it is meant to defeat** (PK-2, high). The old device key and the records sealed under it can survive on disk and in earlier backups. The long-lived secrets in those records are not rotated, so an old copy still opens current and future chats.
3. **The UI copy over-claims** (PK-3, medium). "A copy of this browser's data is useless without Face ID, Touch ID or your PIN" is false: the profile also holds the Supabase session and metadata, and synced passkeys open the lock from other devices.

No critical findings.

Checklist items with nothing to report in this diff:
- No plaintext, key, PRF output, credential id, salt or file name is sent to the server or written to logs, crash reports, analytics or push.
- No RLS, RPC or storage policy changes.
- No deep-link, share-intent or URL-fragment handling changes.
- No new screenshot-protection claims.

MLS state and the per-room lock are affected only through PK-1. `enable`/`disable` do not take `withRoomLock`, and no cross-tab lock exists.

## Findings

### PK-1 (high): enable/disable/put/wipe race; the "atomic re-seal" loses or orphans concurrent writes, and a locked-key mismatch is silently read as "no such record"

Code:
- `packages/core/src/adapters/web/keystore.ts:200-203` `put`: `wrappingKey()` reads `meta/pk` in one IndexedDB transaction. `seal()` runs. The record is written in a second transaction. Nothing ties the key used to the key that is current at write time.
- `keystore.ts:170-177` `wrappingKey`: returns `unlockedKeys.get(db)` without checking that it is the key the current `pk` record wraps.
- `keystore.ts:276-299` `enable`:
  - the snapshot (`reseal` → `allSealed`, line 286) is taken in one transaction;
  - the records are re-encrypted with many awaits;
  - then `txBoth` runs `sealed.clear()` and writes the snapshot back (lines 291-296);
  - the `already_on` check (line 277) is not repeated after the passkey prompt.
- `keystore.ts:331-345` `disable`: same pattern.
- `keystore.ts:248-255` `wipe`: two separate transactions, no coordination with `enable`.
- `keystore.ts:205-221` `get`: if `unseal` fails with the current key, it returns `null`.
- `packages/core/src/chat/client.ts`:
  - 256-265: `loadState`/`roomLocal` treat `null` as "no state" or "fresh room";
  - 884: `if (!state) { lastSeq = seq; continue; }` writes off every row as "traffic from before we joined";
  - 217-223: `ensureDevice` registers a new device when `device:<uid>` reads as `null`;
  - 489-494, 520-526, 541-544: owner commits are posted with `chat_send` before `saveState`.

Failure scenarios:
1. **Rollback, same tab or another tab.** Tab B has a room open and is syncing or sending. Tab A (Settings) taps "Turn on", the passkey prompt succeeds, and `enable()` snapshots the store. While A re-encrypts, B's `sendTextLocked` saves the advanced state (`client.ts:565`), or `applyRows` saves state and `lastSeq`. A's `txBoth` then clears `sealed` and writes the older snapshot. B's writes are gone:
   - after a send, the device's ratchet goes back to a generation it already used. Its next message reuses that generation, and the recipients reject it. Message keys the code deliberately advanced past are back on disk (`client.ts:564` says this "would break forward secrecy").
   - after an owner commit (`admitPending`, `removeMember`), the commit is on the server but the owner's saved state is the pre-commit epoch. The owner is forked from its own room. After a removal, the removed member's state can still be the current one from the owner's point of view.
2. **Resurrected content.** Between snapshot and commit, any `dropMessage`, `forgetRoom` (burn or leave, `client.ts:270-272`; the realtime `burned` handler at `app/chat/r/[id]/page.tsx:118`), or view-once deletion is undone. A burned room's decrypted messages and MLS state are written back to disk under the new data key.
3. **Orphaned writes read as empty.** B's `put` reads `pk` (absent) just before A's `txBoth` commits. It then seals under the device key D0 that A just deleted. After the next reload the record is unreadable:
   - `get` returns `null`, so `loadState` returns `null`;
   - `sync` advances `lastSeq` past every row, and the room is silently and permanently written off on this device;
   - `roomLocal` resets to `{ lastSeq: 0 }`.
   The same happens in reverse around `disable`: a write under the passkey data key K lands after K's `pk` record is deleted.
4. **Stale cached device key.** A dashboard tab is not inside `ChatShell`, so it never reloads on the `keystore` broadcast. It keeps D0 in `wrapKeys` across an enable and a later disable (D1). Its `createRoom` (`DashboardChat.tsx:38-48`) then writes the new room's only MLS state under the destroyed D0, so the owner loses the room it just created.
5. **Wipe undone.** Panic or "Sign out & erase" (`settings/page.tsx:173`) or `revokeDevice` (`client.ts:236`) runs `wipe()` in one tab while another tab is between snapshot and `txBoth`. The `txBoth` writes every record back, plus a `pk` that opens them. "Erase" is undone.
6. **Two tabs enabling at once.** Both pass the `already_on` check. The last `txBoth` wins. The other tab holds a data key that matches nothing on disk, and anything it writes before it reloads is unreadable (scenario 3).

Fix:
- Serialize all key changes across tabs with the Web Locks API. Hold `navigator.locks.request('onepeek-chat-keystore', { mode: 'exclusive' })` for `enable`, `disable` and `wipe`. Hold `{ mode: 'shared' }` for each `get`/`put`/`del`/`delPrefix`/`sweep`.
- Add a key generation id: random bytes stored in `meta` (both for `wrap` and `pk`) and in every `Sealed` record.
- In `put`, do the final write in one read-write transaction over `meta` and `sealed`: re-read the generation id and abort (then retry with the current key) if it changed.
- In `enable`/`disable`, re-check `pk` and the generation id inside `txBoth`. Do not `clear()` and rewrite: re-seal in place, and abort if any record changed since the snapshot (keep a per-record write counter or compare `iv`).
- In passkey mode, `get` must throw, not return `null`, when the record's generation id does not match the unlocked key.
- `enable`/`disable` should wait for, or refuse to run during, in-flight room operations: expose `withRoomLock` drain from the client, or simply do the switch from a fresh page load with no rooms open.
- Add tests: concurrent `put` during `enable`, `wipe` during `enable`, a second tab enabling.

### PK-2 (high): turning the lock on leaves the old device key and old records recoverable, and rotates none of the secrets they contain

Code:
- `keystore.ts:12-15`: the comment says "A copied browser profile then holds nothing that opens the chats without that authenticator".
- `keystore.ts:291-296`: `m.delete('wrap')` and `sealed.clear()` are logical deletes.
- `keystore.ts:276-299`: nothing inside the records is changed. The device signing key, the MLS leaf private keys and the epoch secrets are only re-wrapped.
- `packages/core/src/chat/client.ts:28, 889`: this design has no self-updates, so a device's leaf HPKE keys are never rotated while it stays in a room.

Failure scenario:
1. Before the lock is turned on, the non-extractable device key D0 sits in IndexedDB. Chromium and Firefox serialize the key material of a non-extractable `CryptoKey` into the stored value (the existing header at `keystore.ts:4-7` already says a copied profile opens the store).
2. After "Turn on", Chromium's LevelDB keeps the deleted `wrap` value and the cleared D0-sealed records in its `.log`/`.ldb` files until compaction. After compaction they can still sit in free disk blocks. SQLite-backed engines can keep them in free pages unless `secure_delete` is on.
3. Every backup taken before the switch (Time Machine, Windows File History, corporate endpoint backup, a disk image) holds D0 and the D0-sealed store in the clear.
4. Attacker P takes such a copy and gets:
   - the device's signing key, so it can impersonate the device;
   - the MLS state of every room at that time;
   - the Supabase session from the same profile (see PK-3), which can fetch ciphertexts and commits with `chat_fetch`.
5. The leaf private keys are never rotated, so the old state can follow every later commit (path secrets are encrypted to this leaf). It decrypts current and future messages in every room the device is still in. The passkey lock does not change this, although the copy and comments say a copy is "useless".

Fix:
- When the lock is turned on, rotate what the old key protected. Register a new device (`chat_register_device`) under the passkey-protected store, re-join or have the owner re-admit the new device, and revoke the old device id.
- Alternatively, offer the lock only at device setup, before any key is written, and for existing devices make "Turn on" = "Erase and set up again".
- At minimum, state the limit in the copy and comments: the lock protects against copies taken after it was turned on, once the browser has compacted its storage.

### PK-3 (medium): the settings copy and code comments over-claim what the lock protects

Code:
- `app/chat/settings/page.tsx:113`: "a copy of this browser's data is useless without Face ID, Touch ID or your PIN".
- `settings/page.tsx:114`: "If you delete that passkey, these chat keys can't be opened again."
- `keystore.ts:12-15` and the commit message say the same.

Why it is not true:
- **The session is in the profile.** `lib/supabase.ts:6-8` uses supabase-js defaults, so the access and refresh tokens are in `localStorage`. A copy gives P the account session. P can:
  - list rooms and devices;
  - fetch ciphertext;
  - leave or burn rooms and revoke devices;
  - create invites where the account may. Non-business rooms are auto-admitted by the owner's app (`app/chat/r/[id]/page.tsx:98`), so P can bring its own device into a room and read new messages, visible only as a new member.
  This is not new in this commit, but the new copy promises the opposite.
- **The metadata is plaintext.** IndexedDB keys (`device:<userId>`, `room:<id>:msg:<id>`, `room:<id>:ownerPin`) and `expiresAt` are stored in the clear. A locked store still reveals the user id, every room id, message counts and ids, and expiry times.
- **Synced passkeys.** iCloud Keychain, Google Password Manager and 1Password return the same PRF output on every device the passkey syncs to. The account-recovery flows of those providers can also restore it. "Face ID, Touch ID or your PIN" is really "anyone who can use this passkey anywhere". On a Mac, the login password is the fallback for Touch ID.
- **"Each time you open chat" is really once per page load.** The key survives client-side navigation out of `/chat` (see PK-4), a Panic lock in other tabs (PK-5), and an idle tab of any age.
- **"If you delete that passkey" is ambiguous.** Deleting it from the account's passkey list in this same Settings page does not affect the lock, because the credential still exists on the authenticator. Deleting it from the authenticator or password manager does. The UI never says which passkey was used (the `credId` is not shown or matched to the account list).
- **PK-2:** residual and backup copies.

Fix: reword, for example: "Your chat keys on this device are encrypted with a key that only your passkey can unlock. Someone who copies this browser's files later can't read your messages without that passkey. Your sign-in session, and which chats you're in, are not protected by this setting. If your passkey syncs (iCloud Keychain, Google Password Manager), any device with it can unlock." Show which passkey is used, and warn on the account passkey list before deleting that one. Fix the comment at `keystore.ts:12-15` too.

### PK-4 (medium): the strict `/chat` CSP does not cover the keystore or the unlock; same-origin script can phish one prompt and get a portable data key

Code:
- `lib/security-headers.js:22-41`: every non-`/chat` route has a report-only CSP (i.e. none enforced) with `'unsafe-inline'` and `checkout.razorpay.com`.
- `middleware.ts:19-21`: the strict CSP applies only to documents loaded at `/chat*`.
- IndexedDB `onepeek-chat` is per origin, not per path.
- `app/components/DashboardChat.tsx:79` (`<Link href="/chat">Unlock</Link>`), `app/dashboard/page.tsx:263`, `app/HomeClient.tsx:646`, `app/secret-chat/page.tsx:73,104,144`: Next `<Link>` soft navigations run `ChatShell`, the unlock and the decrypted chat inside the document that was loaded under the non-enforced policy.
- `keystore.ts:131-154` (`webPrf`), `keystore.ts:306-325` (`unlock`).

Failure scenario:
1. XSS on any onepeek.io page, or a compromised third-party script there, reads `meta/pk` from IndexedDB (`credId`, `salt`, `iv`, `wrapped`).
2. It calls `navigator.credentials.get({ publicKey: { rpId: 'onepeek.io', allowCredentials: [credId], userVerification: 'required', extensions: { prf: { eval: { first: salt } } } } })`. The person sees the normal OnePeek passkey sheet, which looks like a sign-in, and approves it.
3. The script derives the KEK and decrypts `wrapped`. It now has the raw 32-byte data key and can exfiltrate it with every sealed record. The key keeps working offline for every record written until the lock is turned off and on again.

Before this change, the same script could use D0 silently but could never take it away (non-extractable). With the lock, it needs one approved prompt but gets a portable key.

Variants:
- The user unlocks after a soft navigation from `/dashboard`, so the key is in a heap that has no enforced CSP.
- `rpId` `onepeek.io` (`keystore.ts:134`) lets every `*.onepeek.io` host exercise the credential. Anyone who has the salt from a profile copy (PK-2/P) needs only one approved prompt on any onepeek.io subdomain they control or can inject into.

Fix:
- Hard-navigate into `/chat`: use `<a href>` or `location.assign`, not `<Link>`, from outside `/chat`. In `ChatShell`, refuse to unlock unless the document was served with the chat CSP (for example, the server renders a `<meta name="chat-csp" content="<nonce>">` that only the `/chat` layout emits); otherwise call `location.reload()`.
- Enforce the site CSP.
- Longer term, serve chat from its own origin (`chat.onepeek.io`) with a dedicated chat passkey registered for `rpId: chat.onepeek.io`, so the main site and sibling subdomains can neither read the store nor evaluate PRF on that credential.
- Treat the salt as sensitive in comments and docs.
- Use `crypto.subtle.wrapKey`/`unwrapKey` (AES-KW under the KEK, `extractable: false` on unwrap) so the app itself never holds the raw data key (see PK-12).

### PK-5 (medium): Panic lock and Panic Exit do not drop the unlocked data key; there is no idle relock

Code:
- `keystore.ts:327-329`: `lockNow()` is never called by the app (grep: only the test uses it).
- `app/chat/ChatShell.tsx:28-32` (`panicExit` → `lock()`), `ChatShell.tsx:53` (`'lock'` broadcast → `setLocked(true)` only).
- `lib/chat/client.ts:52-54`.

Failure scenario:
1. The person has two chat tabs open, or soft-navigated from `/chat` to `/dashboard`, and hits Panic Exit.
2. The tab that ran `panicExit` navigates away, which frees its heap. Every other tab keeps K in `unlockedKeys` behind a lock screen that is only a React state.
3. L opens DevTools in one of those tabs, reaches the module through the webpack chunk registry (`self.webpackChunk_N_E`), and calls `keystore.get` on every record. No passkey is needed.

The commit presents the passkey as what guards a Panic lock ("one passkey check unlocks both"), but the key is never re-locked. The same applies to a tab left unlocked for days.

Fix:
- Call `keystore.passkey.lockNow()` inside `lock()` and in every tab's `'lock'` handler. Put the handler in `lib/chat/client.ts` at module level, so pages outside `ChatShell` (`DashboardChat`) also get it.
- Consider dropping the key after N minutes hidden (`visibilitychange`) or idle.

### PK-6 (medium): `reseal` silently drops records it cannot open, and `enable`/`disable` trust cached keys

Code:
- `keystore.ts:264`: `try { value = await unseal(from, key, rec); } catch { continue; }`, followed by `sealed.clear()` (lines 292, 338).
- `keystore.ts:278`: `enable` uses `deviceKey(DB)`, the page-cached `wrapKeys` promise, not a fresh read of `meta/wrap`.
- `keystore.ts:333`: `disable` uses `unlockedKeys.get(DB)` without checking that it matches the current `pk`.

Failure scenario:
1. The Settings tab has D0 cached.
2. In another tab the person uses "Sign out & erase" and signs in again, so D1 and new records are written. `wipe()` broadcasts nothing.
3. Back in the first tab they tap "Turn on". `reseal(D0, …)` fails on every D1 record, drops them all, and `txBoth` commits an empty store.
   - Device identity is lost: the next `ensureDevice` registers a new device.
   - Every room's state is lost.

The same happens with `disable` holding a data key that another tab has since replaced. The person sees "Done."

Fix:
- Abort the whole operation if any non-expired record fails to unseal. Never drop records.
- Read the device key fresh from IndexedDB inside `enable`.
- Bind `unlockedKeys` entries to the `pk` generation id (PK-1) and refuse when it does not match.

### PK-7 (medium): "Erase chat keys on this device" does not leave the chats or revoke the device, though the copy says it does

Code:
- `app/chat/ChatShell.tsx:130-139`: `confirm('… You'll leave the chats on this browser …')` → `keystore.wipe()` → reload.
- `keystore.ts:248-255`: `wipe` deletes local data only.

Failure scenario:
1. The likely reason for "Passkey gone?" is a lost or stolen phone or security key.
2. Erasing leaves the device registered and a member (an MLS leaf) of every room. Members keep encrypting to it, and Settings › Devices still lists it.
3. The device id is inside the sealed `device:<uid>` record, which cannot be read while locked, so this page could not revoke it even if it tried.
4. If the thief also has an earlier copy of the profile (PK-2), or the stolen authenticator plus a copy made while the lock was on, the old device keeps reading new messages.

Fix:
- Keep the device id, which the server already knows, in plaintext `meta`, so erase can call `chat_revoke_device` (and have owners commit removals).
- Otherwise send the person to Settings › Devices with that device highlighted.
- Change the copy to say what happens: "This browser's chat keys are deleted. Revoke this device in Settings so it stops receiving messages."

### PK-8 (low): the key-change broadcast reloads the tab that sent it, and pages outside `ChatShell` never hear it

Code:
- `keystore.ts:111-113`: `announceKeyChange` posts from a new `BroadcastChannel`. Per the HTML spec, every other `BroadcastChannel` object with that name receives it, including `ChatShell`'s own channel in the same tab.
- `ChatShell.tsx:55` reloads on it.

Failure scenario:
1. The Settings tab reloads right after `enable()` or `disable()`. The "Done" message is never shown, the person is asked for the passkey again at once, and `toggleKeyLock`'s `finally` may not run.
2. The reload can land in the middle of an operation in the same tab. For example, an owner's commit posted by `admitPending` in a room page whose promise is still running after a client-side navigation, before `saveState` (`client.ts:489-494`). That forks the owner.
3. `DashboardChat` and any page outside `ChatShell` do not listen, so they keep stale keys (PK-1 scenario 4).

Fix:
- Include a per-page sender id and ignore your own messages.
- Move the listener into `lib/chat/client.ts` (module level). On a key change, clear `wrapKeys` and `unlockedKeys` and re-check status, instead of reloading blindly.
- Defer the reload until no room lock is held.

### PK-9 (low): `unlockChats` clears a Panic lock without any check if the passkey record disappears in between

Code:
- `lib/chat/client.ts:61-66`: `status() !== 'off'`, then `ks.passkey.unlock()`, then `webLock.clear()`.
- `keystore.ts:307-308`: `unlock` returns silently when `pk` is gone.

Failure scenario: between the `status()` read and `unlock()`'s own `passkeyMeta()` read, another tab wipes or disables the lock. `unlock()` returns without prompting, and the Panic lock is cleared with no passkey and no `signInWithPasskey`. The impact is small, because after a wipe there is nothing left to show, but it is an authentication step that fails open.

Fix: `unlock()` returns `false` or throws `'not_on'` when there is no `pk`, and `unlockChats` then falls back to the normal `unlock()`.

### PK-10 (low): the `ChatShell` gate fails open, and a removed `pk` record silently turns the lock off

Code:
- `ChatShell.tsx:45-48`: `.catch(() => setLocked(false))`.
- `keystore.ts:271-274`: `status` is `'off'` whenever `meta/pk` is missing.

Failure scenario:
1. Any IndexedDB error during the check (a blocked open, quota, a private-mode quirk) renders the chat UI as if nothing were locked. Later `get`s will probably throw too, so the main effect is error-prone UI, not a data leak.
2. More important: an attacker with write access to the profile (or XSS) deletes `pk` and writes a `wrap` key it knows. On the next load the status is `'off'`, the old records read as `null` (unseal fails), and the client registers a new device whose secrets are sealed under the attacker's key. Settings now shows "Off". Nothing tells the person their lock was removed.

Fix:
- Fail closed: show an error state and do not render children.
- Record that the lock is on somewhere a profile edit alone cannot undo. For example, keep a `localStorage` flag as a tripwire, and better, a server-side device attribute set at enable. Warn loudly if the store comes up `'off'` while that flag says on.

### PK-11 (low): a locked store still answers "no such record" for absent keys, and the lock is not bound to an account

Code:
- `keystore.ts:206-207`: `get` returns `null` for a missing record before checking the lock.
- `client.ts:217-223`: `ensureDevice` registers a device on `null` before its `put` throws.
- `DashboardChat.tsx:38-48`: "Quick Chat" is not gated.

Failure scenario:
1. A second account, or a guest arriving at `/chat/join`, uses this browser while A's lock is on.
2. `ensureDevice` finds no `device:<their uid>`, calls `chat_register_device` (the server stores a new device and signing key), and then fails with `KeystoreLockedError`. Each retry leaves another orphan device on that account's list.
3. That person can only proceed by pressing "Erase chat keys", which destroys A's keys. `pk` is not bound to a user id.

Fix:
- In `get`, check the lock first and throw `KeystoreLockedError` whenever the lock is on and the store is locked, even for absent keys.
- Have `ensureDevice` check status before any RPC.
- Store the user id in `pk` and show "Chats on this browser belong to another account" rather than offering erase as the only path.

### PK-12 (low): WebAuthn and key-handling details

Code: `keystore.ts:131-154`, `276-325`, `app/chat/settings/page.tsx:116`.

- **`enable()` accepts any credential** (`allowCredentials: []`), including a passkey of another OnePeek account on the same device or a forgotten one. The button is enabled based on the account's passkey count, but the chosen `rawId` is never compared with `supabase.auth.passkey.list()`. Fix: pass the account's credential ids in `allowCredentials`, or check the result against them.
- **The UV flag is not checked locally.** `userVerification: 'required'` relies on the browser. Since no server verifies the assertion, also parse `response.authenticatorData` and require the UV bit (0x04) before using the PRF output. This is defense in depth only; a lying authenticator can lie about it too.
- **`NotAllowedError` covers several cases.** Timeout, no matching credential, failed UV and an `rpId` mismatch on preview hosts (`keystore.ts:134` falls back to the hostname, where account passkeys do not exist) are all reported as "cancelled". Fine for safety, but misleading.
- **Raw key material in the JS heap.** The raw data key (`raw`) and the PRF output pass through JS buffers. The zeroing at lines 300-303 and 321-324 is best effort: `getClientExtensionResults()` keeps an internal copy until the credential object is collected, and heap pages can reach swap, hibernation files or crash minidumps. Use `generateKey(..., extractable: true)` + `wrapKey('raw', dataKey, kek, 'AES-KW')` on enable, and `unwrapKey(..., extractable: false)` on unlock, so the app never holds the raw data key. Do not claim the PRF output is wiped.
- **The AAD does not bind `v`/`salt`/`credId`.** The constant `PK_INFO` is used as AAD. This is harmless today because the KEK already binds `credId`, but binding the whole meta header is cheap and stops header-swap tricks in later versions.

## Summary table

| ID | Severity | Where | One line |
|---|---|---|---|
| PK-1 | high | `keystore.ts:200-221, 276-345, 248-255`; `client.ts:256-265, 884` | Lock switch and re-seal are not serialized with concurrent writes or `wipe`: MLS state rollback and forks, burned content brought back, orphaned writes read as empty, erase undone |
| PK-2 | high | `keystore.ts:12-15, 276-299` | Old device key and records survive on disk and in prior backups; nothing is rotated, so an old copy still opens current chats |
| PK-3 | medium | `settings/page.tsx:113-114`; `keystore.ts:12-15` | Copy over-claims: session token and metadata in profile, synced passkeys, "each time", ambiguous "delete that passkey" |
| PK-4 | medium | `security-headers.js:22-41`; `middleware.ts:19-21`; `DashboardChat.tsx:79`; `keystore.ts:131-154` | Same-origin script outside the strict CSP can phish one prompt and extract a portable data key; soft navigation runs unlock without the chat CSP |
| PK-5 | medium | `keystore.ts:327`; `ChatShell.tsx:28-32, 53` | Panic lock never calls `lockNow`; other tabs keep the key; no idle relock |
| PK-6 | medium | `keystore.ts:264, 278, 333` | `reseal` drops unreadable records and trusts cached keys: silent total loss |
| PK-7 | medium | `ChatShell.tsx:130-139` | Erase does not revoke the device or leave rooms, despite the copy |
| PK-8 | low | `keystore.ts:111-113`; `ChatShell.tsx:55` | Broadcast reloads the sending tab; non-ChatShell pages never hear it |
| PK-9 | low | `lib/chat/client.ts:61-66`; `keystore.ts:307-308` | Panic lock cleared without verification if `pk` vanishes mid-unlock |
| PK-10 | low | `ChatShell.tsx:45-48`; `keystore.ts:271-274` | Gate fails open; deleting `pk` silently downgrades to "off" |
| PK-11 | low | `keystore.ts:206-207`; `client.ts:217-223` | Locked store reports absent keys as empty, so orphan device registrations happen; lock not bound to an account |
| PK-12 | low | `keystore.ts:131-154, 276-325` | Any credential accepted on enable; UV bit not checked; raw key and PRF output in the JS heap; AAD does not bind meta |

## Second pass: commit b2177fa

Reviewer: security-reviewer. Date: 2026-11-27. Read-only review of `git show b2177fa` and the files it touches at that commit. No tests or builds run. Line numbers below are at b2177fa.

### Verdict

Most of the first pass is fixed. The fixes hold up:
- a cross-tab Web Lock around every keystore operation;
- no cached device key;
- the re-seal fails instead of dropping records;
- a locked store throws even for missing records;
- the data key is wrapped with AES-KW and unwrapped straight to non-extractable;
- the user-verified flag is checked;
- `unlock` detects a lock that changed while the prompt was open;
- the gate fails closed.

There are no deadlocks from nested Web Locks: no locked section calls another locked function, and `put` takes its exclusive lock only after the shared one is released.

What is left:
1. **One real issue (S-1, medium).** The keystore-level race is closed, but the *client-level* one is not, and the fix adds two new triggers: the idle re-lock and the Panic broadcast. Dropping or retiring the key while a multi-step chat operation is running can still fork an owner's room.
2. **The Settings copy still contradicts the new known-limitations item** (PK-3 residual, medium).
3. **Item 16 was inserted in the middle of item 15** in `docs/secret-chat/known-limitations.md`.
4. A few lows.

**PK-2 and PK-4 handled as documented limits.** This is acceptable for an opt-in feature and not a blocker, on one condition: the Settings sentence at `app/chat/settings/page.tsx:114` must stop claiming that copies made after turning the lock on are safe (see PK-3 below). PK-4's cheap follow-ups (hard navigation into /chat, enforcing the site CSP) should be tracked.

### Status of the first-pass findings

| ID | Status | Notes |
|---|---|---|
| PK-1 | **partly** | Closed inside the keystore. `put`/`get`/`del`/`delPrefix`/`keys`/`sweep` take the shared lock and read the current key inside it (`keystore.ts:254-308`). `enable`/`disable`/`wipe` take the exclusive lock and re-check state inside it (`keystore.ts:311-397`). Rollback, resurrection, writes under a retired key and an undone wipe are no longer possible. The new tests run under Node 24's real `navigator.locks`. Still open at the client level, and made more likely by the fix: see S-1. |
| PK-2 | **accepted limit** | Documented in `known-limitations.md` item 16, with a real "start fresh" path: Settings › Devices › Sign out this device (`revokeDevice` → `wipe`), then turn the lock on before any device is registered. `settings/page.tsx` `load()` does not register a device, so this works. Acceptable for an opt-in feature **once the copy at `settings/page.tsx:114` is fixed** (PK-3). Note that "start fresh" protects future traffic only: already-decrypted messages sealed under the old key can still remain in leftover storage files. |
| PK-3 | **partly (medium)** | The new text (`settings/page.tsx:114, 122`) is much better. Two problems remain. (1) Line 114 says "A copy of this browser's data made after you turn this on can't decrypt your messages without that passkey". Item 16 itself says that after turning the lock on, the storage files "can still hold the old key and old records until they are overwritten", so a copy made just after turning it on can still decrypt. (2) The Settings text does not mention that the Supabase session in the same profile still signs in. In non-business rooms, a signed-in copy can bring a new device into the room and be auto-admitted (`app/chat/r/[id]/page.tsx:98`). Fix: on line 114 say "…made after you start fresh with the lock on (see below)…", and on line 122 add "and your sign-in in this browser isn't protected by it". |
| PK-4 | **accepted limit (low follow-ups)** | Documented in item 16. AES-KW now keeps the app's own copy of the data key non-extractable (`keystore.ts:182-185, 335-337`), but script that gets the PRF output can still unwrap it extractable. Not a blocker: before the lock, such script could use the device key with no prompt at all. Track the cheap mitigations: plain `<a href="/chat…">` instead of `<Link>` from non-chat pages (`DashboardChat.tsx:79`, `dashboard/page.tsx:263`, `HomeClient.tsx:646`, `secret-chat/page.tsx`), so unlock and decryption always run under the enforced `/chat` CSP; and enforce the site CSP. |
| PK-5 | **partly (low)** | Panic now calls `lockNow` in the tab that ran it (`lib/chat/client.ts:34-37`) and in every `ChatShell` tab (`ChatShell.tsx:57`). The idle re-lock was added (`ChatShell.tsx:65-77`). Gaps: (1) both live only in `ChatShell`, so a page outside `/chat` that was reached by soft navigation from an unlocked `/chat` (e.g. `/dashboard`) keeps the key, ignores Panic and never re-locks; (2) see S-2 for the idle re-lock itself. Fix: move the `BroadcastChannel` listener and the idle timer into `lib/chat/client.ts` at module level. |
| PK-6 | **closed** | `reseal` throws `unreadable_records` and nothing is committed (`keystore.ts:188-199`). The device key is read fresh inside the exclusive lock. `disable` with a stale data key now fails safely. Minor UX: records left unreadable by an older interrupted wipe make `enable` impossible forever ("Reload the page and try again" won't help). An explicit "drop unreadable data" option would fix that. |
| PK-7 | **closed (copy)** | The erase prompt now says the device stays listed until it is signed out (`ChatShell.tsx:152`), and item 16 documents it. Automatic revocation was not added, which is acceptable as documented. The old device can also be signed out from this same browser's Settings after the erase, not only "from another device". |
| PK-8 | **partly (low)** | Own-tab messages are ignored via `KEYSTORE_TAB_ID` (`keystore.ts:59-60, 203`; `ChatShell.tsx:59`); the id comes from the same module instance, so this is correct. Pages outside `ChatShell` still never hear the broadcast. With the cache gone, the only remaining effect is S-4. |
| PK-9 | **closed** | `unlock` throws `not_on` when the passkey record (`pk`) is gone (`keystore.ts:356-357`), and `unlockChats` clears Panic only after the status reads `unlocked` (`lib/chat/client.ts:67-72`). |
| PK-10 | **partly (low)** | The gate fails closed (`ChatShell.tsx:52`). Still open: deleting the `pk` record still silently reads as "off", and `put` then creates a fresh device key (`keystore.ts:264, 168-174`). There is no tripwire. New UX issue: when the failure is persistent, the generic lock screen has no way out, because the erase link appears only when `keysLocked` is true. |
| PK-11 | **closed / accepted** | `get` checks the key before looking up the record (`keystore.ts:269-279`), so `ensureDevice` cannot register an orphan device while the store is locked. Not tying the lock to an account is documented in item 16. |
| PK-12 | **mostly closed (low)** | AES-KW wrap/unwrap is in place (the raw data key never reaches JS), and the UV bit is checked (`keystore.ts:238-240`, byte 32, bit 0x04, correct). Still open: `enable` uses `allowCredentials: []` (`keystore.ts:229`), so any onepeek.io passkey can be chosen, including another account's, and the result is not checked against `supabase.auth.passkey.list()`. The PRF output still passes through JS (unavoidable, documented). |

### New findings from the fixes

#### S-1 (medium): retiring or dropping the key while a multi-step chat operation runs still forks an owner's room; the idle re-lock and the Panic broadcast are new triggers

Code:
- `ChatShell.tsx:57` (`'lock'` → `lockNow()`), `ChatShell.tsx:69-73` (idle re-lock → `lockNow()`), `lib/chat/client.ts:34-37`;
- `keystore.ts:332-348`: after `enable` commits, other tabs have no key;
- `packages/core/src/chat/client.ts`:
  - `admitPendingLocked` 489-494, `commitRemovalsLocked` 520-526, `removeMemberLocked` 541-544: `chat_send` posts the commit, then `saveState` runs;
  - `createRoom` 300-306: `chat_create_room`, then `saveState`;
  - `redeemInvite` 399-407: `chat_redeem_invite`, then the `pending` key package is stored.

The Web Lock covers one keystore call at a time. These client operations are *load, then RPC, then save*, so the lock is released while the RPC is in flight.

Failure scenario:
1. The owner has a non-business room open in tab A. The room page auto-admits on sync (`app/chat/r/[id]/page.tsx:98`).
2. One of these happens while `admitPendingLocked` is waiting on its `chat_send`:
   - tab B hits Panic, and A's `ChatShell` calls `lockNow()`;
   - tab A comes back after more than 10 minutes in the background, and the idle re-lock runs, likely while the resubscribe-triggered sync is running;
   - tab B turns the lock on, so A has no key until it reloads.
3. The server accepts the commit, then `saveState` throws `KeystoreLockedError`.
4. The owner's saved state is still the previous epoch, while the group has moved on with the owner's own commit, which the owner cannot process as a received message. The room is forked for the owner. The Welcomes are not sent, so the joiners are stuck.

Variants: with `createRoom`, a room exists on the server with no local state. With `redeemInvite`, the device is pending with no private key package, so its Welcome can never be opened.

Before this commit, `lockNow` was never called and the lock could only change by turning it on in another tab. Now it also happens on every idle return and every Panic.

Fix, either of:
- (a) In the client, save before sending for commits, the same way `send` already does at `client.ts:563-565`. Persist the advanced state (or a `pendingCommit` record) before `chat_send`, and roll forward or back on the next sync.
- (b) Give the client a way to wait until in-flight operations finish (`client.drain()`: wait until `roomLocks` is empty and stop new work). Have `lockNow` callers (`lock()`, the idle re-lock, the `'lock'` handler) and `enable` wait for it first. Then take the exclusive Web Lock and drop the key.

Option (a) also covers crashes, which can cause the same fork today.

#### S-2 (low): the idle re-lock briefly shows chat content and depends on `visibilitychange`

Code: `ChatShell.tsx:65-77, 79`.

- On return, `setVeiled(false)` runs at once (line 67, and `focus` at line 79), but the re-lock waits for `status()`, an IndexedDB read. Decrypted messages are on screen for at least one frame, longer on a slow disk, before the lock screen. Fix: when the time limit is exceeded, keep `veiled` true (and skip the `focus` unveil) until the re-lock decision is made, or call `lockNow()` and `setLocked(true)` synchronously and check the status afterwards.
- The key stays in memory for the whole time the tab is hidden; it is dropped only when the tab becomes visible again. A window left visible but unattended, or occluded on a platform that doesn't report that as hidden, never re-locks. The copy ("again after 10 minutes in the background") is accurate, so this is a limit, not an over-claim. Consider a timer that drops the key after 10 minutes hidden, rather than on return.

#### S-3 (low): `put`'s retry loop recreates a device key after a wipe, so in-flight writes survive "Erase" and "Sign out"

Code: `keystore.ts:254-267`, `168-174`.

1. `wipe()` takes the exclusive lock. A `put` from an operation already in flight (a sync storing a decrypted message, a `saveState`) is queued behind it.
2. When the wipe finishes, that `put` finds neither `wrap` nor `pk`, calls `ensureDeviceKey`, creates a new device key and writes the record.
3. After "Sign out and erase chat keys on this device" (`settings/page.tsx:173`), "Sign out" of this device (`revokeDevice` → `wipe`), or "Erase chat keys" on the lock screen, the browser can still hold a decrypted message or a room state, together with a stored key that opens it.

This existed before (the old `deviceKey` regenerated too). The retry loop makes it the defined behaviour.

Fix: only an explicit initialisation (from `ensureDevice` registering a device) may create the device key. `put` with no key should throw. Alternatively, `wipe` writes a generation marker, and a `put` that started under an earlier generation is dropped.

#### S-4 (low): the unlocked key is not tied to the passkey record it came from

Code: `keystore.ts:155-166`.

`currentKey` returns `unlockedKeys.get(DB)` whenever any `pk` exists. Scenario:
1. A tab still holds data key K1. Either it was reached by soft navigation outside `ChatShell`, or it is a `ChatShell` tab whose reload is still pending.
2. Another tab turns the lock off and on again, producing K2.
3. The first tab now seals writes under K1, which nobody else can open. Its reads of K2 records return `null` (`keystore.ts:278`), which is the "looks empty" path; `ensureDevice` would register a new device.

The trigger needs two missed broadcasts, so this is low. Fix: store `pk.salt` (or a key id) next to the unlocked key and have `currentKey` throw `KeystoreLockedError` when they don't match.

#### S-5 (low): a cross-tab lock that never settles hangs chat in every tab

Code: `keystore.ts:105-119` (`readMeta`) and `121-134` (`allSealed`) have no `onabort` handler; `open()` (`64-71`) has no `onblocked` handler.

If one of these promises never settles (an aborted transaction, a `versionchange` that blocks), the Web Lock callback never returns. Every tab's `get`/`put` then waits forever, the chat UI hangs, and `wipe` and Panic-erase hang too, because they need the exclusive lock.

Fix: reject on `onabort` and `onblocked`. Consider a timeout around each locked section so it errors instead of hanging. Use `AbortSignal.timeout` on `locks.request` only for the wait, since it does not limit how long the lock is held.

#### S-6 (low, docs): item 16 was inserted inside item 15 of `known-limitations.md`

Code: `docs/secret-chat/known-limitations.md:77-103`.

Item 16 was added before the rest of item 15's text: "When the Welcome arrives, the pinned device must also be…" and the "What remains open:" list about `chat_send` and unpinned invite links. Those paragraphs now read as part of the passkey item. The public list therefore misdescribes both items. Fix: move item 16 after the end of item 15.

#### S-7 (info): fallback when Web Locks is missing

`keystore.ts:138-151` gives only a per-page queue, with no exclusion between tabs. This is acceptable: every browser that supports PRF (Chrome 116+, Safari 18+, Firefox 135+) has `navigator.locks` in secure contexts, so the passkey lock can never be on in a browser that uses the fallback. Tabs without the lock keep the old behaviour. To make that explicit, have `enable()` refuse (`'unsupported'`) when `navigator.locks` is missing.

No nested-lock deadlock found. No locked section calls `withLock`, and `put` takes the exclusive lock only after the shared one is released (`keystore.ts:256-264`). Keep the warning comment at `keystore.ts:141-144`.

### Second-pass summary

| ID | Severity | Status |
|---|---|---|
| PK-1 | medium (residual) | partly: keystore races closed; client-level fork open (S-1) |
| PK-2 | n/a | accepted as a documented limit, conditional on the PK-3 copy fix |
| PK-3 | medium | partly: `settings/page.tsx:114` still over-claims; the session is not mentioned |
| PK-4 | low | accepted as a documented limit; track hard navigation into /chat and enforcing the site CSP |
| PK-5 | low | partly: pages outside `ChatShell` keep the key |
| PK-6 | n/a | closed |
| PK-7 | n/a | closed (copy, documented) |
| PK-8 | low | partly: pages outside `ChatShell` don't listen (see S-4) |
| PK-9 | n/a | closed |
| PK-10 | low | partly: downgrade by deleting the `pk` record is undetected; no erase option when the gate fails |
| PK-11 | n/a | closed / accepted |
| PK-12 | low | mostly closed; `enable` accepts any onepeek.io passkey |
| S-1 | medium | new trigger for the PK-1 residual: idle re-lock, Panic, or turning the lock on mid-commit forks the owner |
| S-2 | low | new: idle re-lock flashes content; key kept for the whole time the tab is hidden |
| S-3 | low | `put` recreates a key after a wipe; in-flight writes survive erase |
| S-4 | low | unlocked key not tied to the `pk` record |
| S-5 | low | a lock that never settles hangs every tab |
| S-6 | low (docs) | item 16 splits item 15 in known-limitations |
| S-7 | info | Web Locks fallback is acceptable; refuse `enable` without it |

Before merge: S-1 (at least option (b), or don't call `lockNow` while room operations are in flight), the PK-3 copy fix and S-6. The rest can follow.

## Third pass: commit 734d0bf

Reviewer: security-reviewer. Date: 2026-11-27. Read-only review of `git show 734d0bf`. No tests or builds run. Line numbers are at 734d0bf.

### Verdict

The three items required before merge (S-1, PK-3, S-6) are closed. S-4 and S-5 are closed. The new operations lock is sound: the two locks are always taken in the same order, the per-page reference count makes nesting safe, and nothing waits for itself.

One new issue blocks merge: **T-1**. The idle re-lock now relies only on a timer while the tab is hidden, and drops the check on return. That timer doesn't fire on suspended pages, which includes mobile web and a laptop asleep with the tab in the background. The Settings text and limitation item 16 promise "again after 10 minutes in the background". The fix is a few lines. **Not merge-ready until T-1 is fixed, or the promise is removed from the copy and from item 16.** Everything else below is low.

### Status

| ID | Status | Notes |
|---|---|---|
| S-1 | **closed** (low residual, T-3) | `withRoomLock` runs every room-locked function under `op` (`client.ts:248-251`), and so do `createRoom` (`300-301`) and `redeemInvite` (`400-401`). On the web, `op` = `chatOperation`, which holds the operations lock shared (`keystore.ts:156-183`). `enable`/`disable` (`quietly` + exclusive, `375-394`, `430-446`) and `lockWhenIdle` (`426-428`) wait for in-flight operations in every tab. The Panic broadcast (`ChatShell.tsx:57`) and the idle re-lock (`ChatShell.tsx:72-79`) both use `lockWhenIdle`. The lock can no longer flip between "server has the commit" and "state saved" for these paths. |
| PK-3 | **closed** | `settings/page.tsx:114, 122` now say "from now on", name leftover storage files and backups, the "start fresh" route, the sign-in that stays signed in, metadata and synced passkeys. |
| S-6 | **closed** | Item 16 now follows the whole of item 15 (`known-limitations.md:113`). |
| S-2 | **partly: regression, see T-1** | The flash of content on return is gone when the timer has fired. The key is no longer kept while hidden, but only if the timer fires. |
| S-4 | **closed** | The unlocked key is stored with its lock record's salt. `currentKey`, `status` and `disable` accept it only if it matches the lock record now on disk (`keystore.ts:195-208, 364-368, 434`). The test covers a replaced record. |
| S-5 | **closed** (note) | `readMeta`/`allSealed` reject on abort, and `open()` rejects on `blocked` (`keystore.ts:70, 116, 133`). Note: `blocked` is not final in IndexedDB. If the open later succeeds, that connection is never closed and can block a future `deleteDatabase` or upgrade. That cannot happen while the version stays fixed at 1. |
| S-3, PK-5/PK-8 (pages outside the shell), PK-10 (gate failure), PK-12 (other-account passkey), S-7 | left as lows by decision | No change, agreed. |

### New findings

#### T-1 (medium, blocks merge): the idle re-lock never fires on suspended pages, and returning to the tab cancels it

Code: `app/chat/ChatShell.tsx:65-80`.

The re-lock is now only `setTimeout(…, IDLE_RELOCK_MS)` started when the tab becomes hidden, and `vis()` clears that timer as soon as the tab becomes visible (line 69). The b2177fa check of the hidden time on return was removed.

Timers don't run, or don't advance, in several common cases:
- iOS Safari and Home Screen web apps suspend background pages;
- Chrome on Android freezes background tabs;
- on macOS, the clock timers use doesn't advance while the machine sleeps.

In these cases the timer is still pending when the page comes back. If the `visible` event runs before the overdue timer callback, `vis()` cancels it. The order between the two is not defined, so this is likely, not certain.

Failure scenario: chat is open in a tab. The person switches tabs, closes the laptop overnight (or backgrounds the phone for an hour), and comes back. The key never left memory, and the conversation is shown again with no passkey prompt. That contradicts `settings/page.tsx:114` ("again after 10 minutes in the background") and `known-limitations.md:115`.

Fix: keep the timer and restore the check on return.
1. Record `hiddenAt` when hidden.
2. On `visible`, if `Date.now() - hiddenAt > IDLE_RELOCK_MS` and the status is `unlocked`, keep `veiled` true (and ignore the `focus` unveil). Call `setLocked(true)` at once, then `lockWhenIdle()`, then `setKeysLocked(true)`.

`Date.now()` is wall-clock time, so it counts time asleep. Add a test with fake timers in which the hidden time passes but the timer never fires.

#### T-2 (low): waiting for "idle" can stall chat in every tab and drop the key mid-use

Code: `keystore.ts:156-191`; `ChatShell.tsx:72-79`.

Web Locks queue a new shared request behind a waiting exclusive one. While one tab's `lockWhenIdle`/`enable`/`disable` waits for a long operation in any tab (for example an RPC stuck on a bad network; supabase-js has no default timeout), every tab with no operation running queues its next send or sync. Those tabs then appear frozen, with no error, until the long operation ends.

Separately: if the re-lock timer has already fired and is waiting when the person returns, `vis()` cannot cancel it. The key is then dropped, and the lock screen appears, while the person is using the tab.

Fix:
- Give the waits a limit: `locks.request(OPS_LOCK, { mode: 'exclusive', signal: AbortSignal.timeout(…) })` for `lockWhenIdle`, retrying later.
- In the timer callback, skip the re-lock if the tab became visible again.
- Consider a timeout on chat RPCs.

#### T-3 (low): some server-then-save paths are still outside `op`

Code (`client.ts`):
- `openFile` (`661-673`): `chat_claim_attachment`, then `storeMessage({viewed:true})`;
- `markOpened` (`1001-1008`);
- device registration in `ensureDevice` (`213-227`) when called directly: from `sync` (`740`), the room page, or Settings;
- `revokeDevice` (`233-238`): the RPC, then `ks.get`, then `wipe`.

If the key is dropped between the RPC and the save (Panic elsewhere waits only for operations, not for these):
- a view-once file is used up and never shown, because `storeMessage` throws before the download;
- an opened message's expiry is not stored;
- a device is registered on the server but not saved locally;
- a revoked device's local keys are not erased.

Fix: wrap these four in `op(...)` too. They are short, and re-entrancy makes this safe.

#### T-4 (info): the operations lock design is sound

- **Lock order.** Every path takes the operations lock before the keystore lock: operations then `get`/`put`/`ensureDeviceKey`; `enable`/`disable` via `quietly` and then `withLock`. `wipe` takes only the keystore lock, and `unlock` takes only the keystore lock in shared mode. Neither ever waits for the operations lock while holding the keystore lock, so the two locks cannot deadlock each other.
- **Nesting.** A nested `chatOperation` (`createRoom` → `withRoomLock`) only increments the count and awaits the already-acquired `opsHeld`, so it never queues behind a waiting exclusive. That holds as long as nested calls run inside the outer one's lifetime, which the `await` structure guarantees. After the count drops to 0, a new operation makes a fresh request and correctly queues behind any waiting exclusive.
- **Self-wait.** Nothing calls `enable`, `disable` or `lockWhenIdle` from inside an operation, so no page waits for itself. Keep this rule documented on `ChatPlatform.operation` (`ports.ts:129-135`): an operation must never wait for anything that waits for an exclusive operations lock.
- **Starvation.** A page that is constantly busy delays re-locking until it goes quiet. This is documented and acceptable.
- **The `operation` hook is optional** (`ports.ts:135`). Mobile adapters that omit it get the old behaviour, which is correct, because they have no passkey lock.

### Third-pass summary

| ID | Severity | Status |
|---|---|---|
| S-1 | n/a | closed (residual T-3, low) |
| PK-3 | n/a | closed |
| S-6 | n/a | closed |
| S-4 | n/a | closed |
| S-5 | n/a | closed (`onblocked` note) |
| S-2 / T-1 | **medium, blocks merge** | the idle re-lock doesn't fire on suspended or sleeping pages; returning cancels it |
| T-2 | low | a waiting exclusive lock stalls other tabs; the re-lock can drop the key mid-use |
| T-3 | low | `openFile`, `markOpened`, direct `ensureDevice`, `revokeDevice` outside `op` |
| T-4 | info | operations lock: lock order, nesting and starvation are fine |

**Not merge-ready: fix T-1**, or remove "again after 10 minutes in the background" from `settings/page.tsx:114` and `known-limitations.md:115`. Then it can merge, with T-2, T-3 and the agreed lows tracked.
