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
