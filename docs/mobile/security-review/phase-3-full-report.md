# Security review: Phase 3 full report (whole app, `mobile/integration` at `5ec563d`)

Reviewer: security-reviewer. Date: 2026-11-01. Scope: the app as built at HEAD `5ec563d` (Gate 2 approved, Phase 3
started), read as a whole rather than as a diff. Read in full: `packages/core/src/**` (crypto, mls, client, ports,
keystore, secrets, log, rn and web adapters), `apps/mobile/{lib,security,modules,plugins}/**`, `app.config.ts`,
`eas.json`, `package.json`, `metro.config.js`, every screen under `apps/mobile/app`, every component, migrations
006–009, `lib/alerts.ts`, `app/api/chat/{notify,report}`, `app/api/open`, `app/api/unlock/*`, `security/README.md`,
`store/README.md`, `MANUAL-CHECKS.md`, `known-limitations.md`, the seven previous review reports, `plan.md`, `log.md`,
and `ts-mls@1.6.4`'s type declarations for the one question the core's own code could not answer. **No tests, builds or
package managers were run** (disk is nearly full); test counts below are the lead's recorded run (web 142, core 322,
mobile 396). No code was edited; this file is the only write.

Two readers: §1, §4 and §5 are for the human deciding on a beta. §3 (claims and proof) and §6 are for store reviewers
and the security adviser. Findings are numbered F-n; previous items keep their W/P numbers.

---

## 1. Threat model of the app as built

### 1.1 Assets, where each one lives, and who can reach it

| Asset | Where it lives on the phone | Protection | Also exists |
| --- | --- | --- | --- |
| MLS group state per room (includes the device's leaf private keys and ratchet secrets) | `onepeek-chat.db` row `room:<id>:state`, AES-256-GCM sealed (`packages/core/src/adapters/rn/keystore.ts:191-197`) under a 32-byte wrapping key in SecureStore `onepeek.wrap`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (`:156`) | File excluded from iOS backup (`security/backup.ts:33-40`) and Android backup/transfer (`plugins/withBackupRules.js`); wrapping key never leaves the Keychain/Keystore except as a non-extractable `CryptoKey` in process memory (`keystore.ts:139-141`) | Nowhere else; the server holds ciphertext only |
| Device signing key (Ed25519) | `device:<userId>` row, same store (`client.ts:123-131`) | Same as above | Public half in `chat_devices.signature_pub` |
| Decrypted message copies | `room:<id>:msg:<id>` rows, same store, with `expires_at` beside the ciphertext (`client.ts:188-192`) | Same; `expires_at` is not authenticated (known-limitations 9) | On every other member's device |
| File ciphertext keys and names | Inside the MLS payload (`mls.ts:146`), stored with the message copy | Same | Never on the server (`client.ts:435-438`) |
| Invite tokens | React state of Join (`components/JoinScreen.tsx:29`), the hand-off slot (`lib/links.ts:63`), the native initial-URL cache and Android Intent until `forgetLinkingURL()` (`security/links.ts:135-138`) | Memory only; hashed server-side (`006:68`) | Clipboard / share sheet / QR when the owner shares it |
| Secret keys (the `#fragment` of a `/s/<id>` link) | Viewer state (`app/s/[id].tsx:85-91`), hand-off slot, native initial-URL cache until the peek resolves (`:125`) | Memory only | The browser if the user taps "Open in browser" (`:234`, documented at `:44`) |
| Supabase session (access + refresh token) | `onepeek-auth.db`, sealed under SecureStore `onepeek.wrap.auth` (`adapters/rn/auth-storage.ts:33-34`) | As the chat store; separate file and key so a chat wipe does not sign out | Supabase |
| Push token | Sealed row `auth:onepeek.push.token` in the auth store (`lib/chat.ts:338-357`) | As above | `push_devices.token`, one owner per token (`008:34, 62`) |
| Quota client id | SecureStore `onepeek.client`, this device only (`lib/secrets.ts:62-83`) | Keychain; wiped on sign-out and reset (`:96-99`) | Every `create_secret` call (`p_client_id`) |
| Panic-lock flag | SecureStore `onepeek.lock` (`adapters/rn/platform.ts:83`) | Keychain; fails closed when unreadable (`:106-117`) | — |
| Plaintext file copies | `<cache>/ImagePicker`, `<cache>/DocumentPicker`, `<cache>/onepeek-view`, `<cache>/share-intent/`; iOS App Group container root and `UserDefaults` plist between a share and the wake-up | Deleted after use and on every launch (`lib/files.ts:119-130`, `security/shareIntent.ts:63-96`); App Group window documented, not claimed away (README N6b) | The source app keeps its own copy |

### 1.2 Adversaries, and what the design does and does not do against each

**Server operator / Supabase / Vercel.** Sees device ids, user ids, room ids, sequence numbers, timing, ciphertext,
attachment sizes, push tokens, the report rows and the quota id. Cannot read text, file names, file keys or nicknames
(all inside MLS payloads: `mls.ts:144-148`). Can delay, drop or replay rows (replay is refused by MLS: `mls.ts:161`).
**Does not defend against:** (a) the server substituting a joiner's key package at admit time and running two groups
(classic MITM): the safety number is computed from the server's own `signature_pub` column, not from the MLS tree, so a
substitution passes the "They match" check (F-2); (b) the server relabelling who sent a message: the sender shown is
`row.sender_device` from the server, the MLS-authenticated sender is discarded (F-3); (c) push metadata (which owner's
phone wakes when which room is active). The web has the same (a)–(c).

**Network attacker.** TLS to `*.supabase.co` and `onepeek.io` only; the app refuses any other host for the session
bearer and the notify endpoint (`adapters/rn/platform.ts:40-51`, `lib/chat.ts:60-71`). No certificate pinning (an
accepted limitation; a corporate MITM root on the phone sees ciphertext, ids and the refresh token).

**A person with the unlocked phone.** The app is locked on cold start and after 60 s in the background and needs the
OS check (`SecurityProvider.tsx:67, 121, 150-173`); while locked, content is unmounted, not covered (`:184`). A phone
with no screen lock gets no prompt and says so (`DEVICE_INSECURE_WARNING`). **Does not defend against:** someone who
also knows the phone's passcode (they are the user as far as the OS is concerned); shoulder-surfing while held; a QR
code on screen (F-7); the previous account's chats after a sign-out on a shared phone (F-1).

**A person with the locked phone (forensic).** Keychain items are `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, so the wrapping
keys are not in any backup and not on a cloned device; the SQLite files are excluded from backups; `FLAG_SECURE`
blanks Android recents. **Does not defend against:** a jailbroken/rooted device (README N3 says so), or a device whose
passcode the attacker knows.

**A malicious app on the same device.** No exported content provider; the share receiver accepts `content://` only and
refuses our own authority (`ShareIntentModule.kt:176-181`), caps items and bytes (`:45-46`); `file://` paths are refused
again in JS (`ShareIntentModule.ts:43-53`). Deep links: `onepeek://auth` only completes a sign-in the phone itself
started (`lib/chat.ts:259-287`); `onepeek://reset` opens the two-tap wipe screen (F-9); `onepeek://spike` opens the
Phase 0 spike (W1-8 residual). A third-party keyboard sees every keystroke (known-limitations 11).

**A room member.** Gets exactly what they are sent; hold-to-read and the watermark raise the cost of a photo; iOS
screenshots are reported, Android screenshots blocked. Can be removed by the owner (MLS commit + server state).
**Does not defend against:** a camera; a member who forwards; a member whose device is compromised.

**A link recipient.** Holds the key (secret) or the bearer token (invite); a secret burns on view, an invite is rate
limited and hashed. The viewer never sends the key anywhere (`secrets.ts:376-382`). **Does not defend against:** the
recipient's own browser history if they choose "Open in browser" (said on screen).

**A tester with a dev build.** `__DEV__` shows the spike row; a dev build has a debuggable process (`run-as` reads the
cache on Android, so plaintext file copies are reachable while they exist); the `e2e` EAS profile renders the full
invite link on screen by design (`app.config.ts:14-21`). Dev/e2e builds must not reach anyone outside the team.

### 1.3 What the design explicitly does not claim

iOS screenshot blocking; camera prevention; protection on rooted/jailbroken phones; secrecy of metadata from the
server; zeroisation of plaintext in the JavaScript heap (F-5); stripping EXIF from photos (W2-4 open); audited MLS.

---

## 2. Architecture walk

**`packages/core/src/crypto.ts`** — AES-256-GCM (`:36-50`), ECDH P-256 + HKDF for requests (`:96-138`), `randomToken`
(`:70-72`), size caps (`:141-142`). Keys are WebCrypto objects; `importKey` marks secret-link keys non-extractable with
`['decrypt']` only (`:33`).

**`chat/mls.ts`** — thin adapter over `ts-mls@1.6.4`, ciphersuite `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`
(`:41`); identity = device id string (`:75-82`); `defaultAuthenticationService` accepts any credential (`:43-51`: the
app, not ts-mls, is meant to check identity); `receive` returns `senderDeviceId: null` because ts-mls's
`processPrivateMessage` result for an application message is `{ message, newState, consumed }` only
(`node_modules/ts-mls/dist/src/processMessages.d.ts:14-19`). `welcomeSignature()` (`:91-93`, the leaf's signature key)
is exported and **never called**. `consumed` buffers are zeroed (`:129, 152, 166`).

**`chat/client.ts`** — all RPCs by name (`:98-102`); one room lock per client (`:153-161`); state saved before the
ciphertext leaves (`:375-376`, forward secrecy); `sync()` drops local keys on `not_a_member` (`:545-547`) and after a
removal commit (`:614`); `members()` builds the member list from `chat_room_members` including `signature_pub`
(`:275-284`); `safetyNumberWith` hashes `dev.signing.publicKey` and `them.signaturePub` (`:635-641`); `markVerified`
stores the server's `signaturePub` (`:643-649`); nicknames are keyed by `row.sender_device` (`:593`); push RPCs need a
real session (`:502-516`); `unlock()` does a passkey check only when one exists (RN has none) then clears the flag
(`:673-683`).

**`chat/ports.ts`, `chat/keystore.ts`** — the KeyStore contract (`ports.ts:14-27`) and the sealed record format with
the record key as AAD and `expiresAt` outside it (`keystore.ts:34-47`).

**`secrets.ts`** — byte-for-byte web parity for create/peek/open/unlock (`:1-15`); hand-written link parser, https and
host allow-list, 43-char key that must decode to 32 bytes (`:173-204`); `/api/open` body `{ id, precise, unlockToken }`
(`:402`); `SecretError` carries codes, never input (`:150-169`).

**`adapters/rn/keystore.ts`** — SecureStore + SQLite; `keystore_unavailable` when the key is missing with rows present
(`:171-190`); wipe deletes the key before the rows with a `wiping` marker (`:244-253`); per-entry process-wide key
cache (`:109-146`). **`auth-storage.ts`** — own file and own entry (`:33-36`); wipes itself on a dead key (`:53-62`).
**`platform.ts`** — `checkOnePeekUrl` (`:40-51`), lock store fails closed (`:104-135`), `wrapRnSupabase` normalises
downloads (`:221-244`). **`crypto.ts`** — installs `react-native-quick-crypto` and asserts the surface (`:22-71`).

**`adapters/web/*`** — IndexedDB non-extractable wrapping key (`keystore.ts:56`), `webLock` in `localStorage`
(`platform.ts:30-43`). Read for the parity table only.

**`apps/mobile/lib/chat.ts`** — the one Supabase client (PKCE, `detectSessionInUrl: false`, sealed storage, `:104-113`);
Supabase URL must match `^https://[a-z0-9-]+\.supabase\.co$` (`:60-67`); `parseAuthCallback` hand-parses
`onepeek://auth` (`:170-192`); `completeFromUrl` accepts a PKCE `code`, or a `token_hash` only for a pending address
requested on this phone within 1 h and only if the session's email matches (`:259-287`); `onSignedIn` fires only from
verified paths (`:195-205, 226-230`); `signOut` unregisters push, signs out locally, forgets the quota id (`:326-333`)
**and does not touch the chat keystore** (F-1); `resetThisPhone` wipes everything (`:387-413`).

**`lib/secrets.ts`** — glue to the core with the literal site URL (`:59`), the keychain quota id (`:62-99`) and the
phone's `fetch` (`:131`). **`lib/files.ts`** — pickers, cache-only temp files, `deletePicked`/`clearPickerCaches`
(`:104-130`), `shareBytes` deletes in `finally` (`:174-178`). **`lib/links.ts`** — substring classifier plus the one-shot
hand-off (`:63-74`, no TTL: P3-2). **`lib/report.ts`** — `{ room, reason }` with the bearer to a literal URL (`:22-36`).

**`security/`** — `SecurityProvider` (lock state machine, FLAG_SECURE re-assert, capture cover), `biometrics.ts`
(`disableDeviceFallback: false`, `:46`), `screenshot.ts`, `secureScreen.ts` (never releases), `links.ts` (strict parser,
`forgetLinkingURL`), `shareIntent.ts` + `iosShare.ts` (the share bridge), `backup.ts`, `Watermark.tsx`, `constants.ts`
(all user-facing protection copy in one place).

**`modules/share-intent`** — Kotlin receiver (`content://` only, own authority refused, 10 × ~50 MB, streamed copy,
random names, `stripIntent()`), iOS stub, JS guard. **`modules/screen-state`** — iOS `isCaptured` +
`isExcludedFromBackup`; Android stubs.

**`plugins/`** — `withSecureWindow` (FLAG_SECURE in `onCreate`, throws if it cannot insert), `withBackupRules` (every
domain excluded, both rule files + manifest), `withAppGroup` (entitlement, deduped, before `expo-share-intent`).

**`app.config.ts`** — `ITSAppUsesNonExemptEncryption: true` (`:42`), `allowBackup: false` (`:59`), App Links for `/s/`
and `/chat/join` (`:61-73`), share intent filters (`:74-85`), `siteUrl` literal (`:133`), `e2e` fail-closed (`:14-21`,
`:136`), `runtimeVersion: appVersion` (`:34`); `expo-updates` is **not** a dependency (`package.json`), so no OTA path
exists today even though `eas.json` declares channels.

**Backend** — 006: default deny, security-definer RPCs, token and code hashes, member checks, owner-only removals
(`:417-419`), realtime read policy only (`:627-633`). 007: guests out of account features. 008: `push_devices`, one
owner per token, shape check, 10-row trim, `select, delete` only for `authenticated`. 009: `chat_reports`, member-only,
20/day. Routes: `/api/chat/notify` (session, UUID, room active, caller active member, `chat_rate_ok` 4/min, recipients
minus sender and opted-out), `/api/chat/report` (bearer re-used as the caller's own session), `/api/open` (ids only,
server-side locks), `/api/unlock/{send,verify}` (same reply whether or not the address matches; 5 attempts; 15-minute
token). `lib/alerts.ts`: fixed-string payloads with the room UUID, 10 tokens per owner, 10 in flight, http2 always
settles, credentials from env only.

**Push path.** `settings.tsx:71-74` → `push.register` → `register_push_device` RPC and a sealed row; `PushRefresher`
re-registers on launch, rotation and verified sign-in only (`PushRefresher.tsx:44-49`); `notifyRoom` posts
`{ room }` with the bearer to `https://onepeek.io/api/chat/notify` (`adapters/rn/platform.ts:64-76`); the server fans
out to APNs/FCM with `OnePeek / You have a new message in a private chat.` and the room id.

**Links and share path.** iOS Universal Link / Android App Link → `useLinkingURL()` in the viewer or Join → strict
parser → core; expo-router never sees the fragment (README N6c). QR → `classify` → hand-off → route by id. Share sheet →
Kotlin module / `expo-share-intent` → `<cache>/share-intent/` → `/share` (files, free text) or hand-off (a bare
OnePeek link) → `consumeShare()` on every exit (`app/share.tsx:78-101, 110-113`).

---

## 3. Claims and proof

Claims as the app, its README or the store plan state them. "Device" = can only be proven on a real phone.

| # | Claim (source) | Enforced at | Test that proves it | Only a device can prove | Honest wording recommendation |
| --- | --- | --- | --- | --- | --- |
| C1 | "End-to-end encrypted. OnePeek can't read a word." (`welcome.tsx:16`) | `client.ts:374-380, 443-448` (encrypt before `chat_send`); `mls.ts:150-155` | `packages/core/test/interop.integration.test.ts` (SQL log, DB dump, storage swept for bodies, names, keys) | Nothing | Keep. Add to the privacy label: metadata (who, when, how much) is visible to the server. |
| C2 | "Your chats stay on this phone; the server only holds encrypted messages." (`sign-in.tsx:115`) | same as C1; `006:88` | same | Nothing | Keep. |
| C3 | "Hold to read" / "no Secret text is on screen while nothing is held" (`room/[id].tsx:8-10`, `INTRO_SECRET`) | `MessageBubble.tsx:61-62, 82-86, 110-114`; `[id].tsx:176-178, 426-428` | `room.test.tsx` "text is not in the tree until held", W2-1, W3-1, P2-6 cases (tree walk of every prop) | VoiceOver/TalkBack behaviour of the hold gesture (S20) | Keep. Say "someone else's message", since own messages are always shown. |
| C4 | "On Android, screenshots and screen recordings of OnePeek come out black" (`PROTECTION_COPY.androidScreenshots`) | `plugins/withSecureWindow.js:37-46`; `SecurityProvider.tsx:87-95, 130`; `secureScreen.ts:15-18` | `withSecureWindow.test.js`; `SecurityProvider.test.tsx` W1-4 ×3; `secureScreen.test.tsx` | Whether FLAG_SECURE is really set on the attached activity after a `MissingActivity` retry; OEM behaviour (S1–S4) | Keep, add "on a phone that is not rooted". |
| C5 | "On iOS, a screenshot cannot be blocked. OnePeek is told… While the screen is being recorded or mirrored, the chat is hidden." (`PROTECTION_COPY.iosScreenshots`) | `screenshot.ts:12-30`; `ScreenStateModule.swift:25-53`; `SecurityProvider.tsx:181-185` | `screenshot.test.tsx`; `SecurityProvider.test.tsx` captured case | Frames before `capturedDidChange` fires (S6); screenshot notification timing (S5) | Keep. Never let marketing shorten it to "screenshot protection". |
| C6 | "Every time OnePeek opens, and after 1 minute in the background" the app locks (`settings.tsx:110`) | `SecurityProvider.tsx:67, 116-139, 150-173`; `constants.ts:6` | `SecurityProvider.test.tsx` 59/61 s, cold start, W1-7 | Face ID prompt text and passcode fallback (S9); iOS keeping a prompt up across a background trip (S11b) | Keep, and keep the "no passcode" warning next to it. |
| C7 | "Panic Exit: chats lock… Nothing is deleted" (`settings.tsx:114`); flag survives force-quit (README N4) | `SecurityProvider.tsx:142-149`; `platform.ts:122-128` (sync write) | `SecurityProvider.test.tsx` panic cases; `platform.test.ts` lock store | Synchronous SecureStore write on device (S12) | Keep. |
| C8 | "Your chat keys stay in this phone's secure storage and are never backed up to the cloud." (`settings.tsx:159`) | `keystore.ts:156` (`THIS_DEVICE_ONLY`); `backup.ts:33-40`; `withBackupRules.js`; `app.config.ts:59` | `keystore.test.ts` (copied DB is useless without the entry); `backup.test.ts`; `withBackupRules.test.js` | iTunes/Finder backup manifest (S15), device transfer (S16), `bmgr` (S17–S18) | Keep. Add "message copies on this phone are also excluded from backups". |
| C9 | "Forgets every chat and key stored here" (`settings.tsx:121`, reset) | `lib/chat.ts:387-413` | `chat.test.ts` reset cases (both stores, lock, client id, sweep) | Nothing | True for **Reset**. Not true for **Sign out** (F-1): sign-out keeps the chat keys. Fix or say so. |
| C10 | "A guest session can't be signed back into; its chats stay on this phone until they expire." (`settings.tsx:154`) | `lib/chat.ts:326-333` (no keystore wipe) | none asserts the keep | — | This is the sentence that makes F-1 a decision rather than an oversight. See F-1. |
| C11 | "Notifications: 'New message in a private chat', never content" (`settings.tsx:119`) | `lib/alerts.ts:117-118, 148-164`; `008` | `alerts.native.test.ts` fixture sweep over every captured request | Real APNs/FCM banner wording (M8) | Keep. Add "OnePeek learns which phone to wake and when". |
| C12 | "If they match on both screens, nobody is intercepting this chat." (`RoomMenu.tsx:323`, `scan.tsx:144`) | `client.ts:635-641` over `chat_room_members.signature_pub` | `mls.test.ts` (fingerprint math only) | — | **Not true against the server** (F-2): the compared keys come from the server, not from the encrypted group. Until fixed, say "…nobody *else* has joined under their name" or remove the sentence. |
| C13 | "Sent encrypted to the other members only" (nicknames, `new.tsx:113`, `JoinScreen.tsx:121`) | `client.ts:219, 315, 578` (`nick` control inside MLS) | `interop.integration.test.ts` nick sweep | Nothing | Keep. Note that *which device* a nickname is shown against is the server's word (F-3). |
| C14 | "OnePeek never sees the file, its name or its key" (`AttachSheet.tsx:72`) | `client.ts:423-437` | interop test file-name/key sweep | Nothing | Keep. |
| C15 | "Photos keep their embedded details, such as location" (`AttachSheet.tsx:73`) | `lib/files.ts:43` (`exif: false` affects the result object only) | `room.test.tsx` W2-4 (sentence present) | Whether the iOS re-encode keeps GPS | Keep until the strip lands (W2-4). |
| C16 | "Encrypted on this phone; OnePeek never sees it or the key" (secrets, `SecretComposer.tsx:166`) | `secrets.ts:254-280, 376-382` | `secrets.test.ts`, `secrets.interop.test.ts` (4-encoding sweep) | Nothing | Keep. |
| C17 | "Scans invites, one-time secrets and safety numbers. The camera image never leaves this phone." (`scan.tsx:28`) | `scan.tsx:107-114` (`CameraView`, decode in process, no capture call) | `scan.test.tsx` | expo-camera's own behaviour | Keep. |
| C18 | Invite link "hidden" on screen (`InviteSheet.tsx:46`, `format.ts:92` "a token is never drawn on screen") | `maskLink` + `extra.e2e === true` only | `new.test.tsx`, `app.config.test.ts` | — | **Partly true**: the QR code two lines above encodes the full link (F-7). Say "shown as a QR code, text hidden". |
| C19 | "Report chat: Sends only the chat's id, never messages" (`RoomMenu.tsx:117`) | `lib/report.ts:28-32`; `009:36-51`; route `:19-27` | `report.test.ts`; `chat-reports.test.ts` | Nothing | Keep. |
| C20 | Shared files: plaintext copy gone when the share is done (README N6a/N6b) | `app/share.tsx:78-101, 142-148`; `shareIntent.ts:89-96` | `share.test.tsx` (P2-3, P3-1 cases); `shareIntent.test.tsx` | iOS container write order vs. the wake URL (S27); Android `run-as` listing (S22) | Keep; keep the App Group window sentence. |
| C21 | Store plan: "Collected: account email and user id, device push token" (`store/README.md:10`) | Supabase auth; `008` | — | — | Add: room ids and device ids (server-side chat tables), the quota client id, the report rows, IP-derived city on `/api/open` (`route.ts:20-31`). |
| C22 | "Over-the-air updates may never change crypto or key handling" (`app.config.ts:32-33`) | `expo-updates` absent from `package.json`; lint bans its import | `leak-guard.test.ts` import probe | — | True today because OTA does not exist. If `expo-updates` is ever added, this becomes a process promise, not a technical one. |

---

## 4. Consolidated findings

### 4.1 Status of every previous item at HEAD `5ec563d`

| Id | One line | Status at HEAD | Evidence |
| --- | --- | --- | --- |
| S0a M1/M2, S0b M1–M3 | wrapping-key cache, keystore required, SecureStore `null`, siteUrl literal, panic fails closed | **held** | `keystore.ts:109-146, 171-190`; `app.config.ts:133`; `platform.ts:104-135` |
| N1–N4 | spike entry, `wiping` marker, lock reload, recovery UI | **closed** | `spike.tsx:80`; `keystore.ts:175-180`; `SecurityProvider.tsx:125-128`; `reset.tsx` |
| W1-1 | `token_hash` login CSRF | **closed**; residual: pending address in module memory (`lib/chat.ts:159-160`), a cold start needs a new link | Phase 3 fix branch in flight (log.md) |
| W1-2, W1-3 | push token residue, fan-out | **closed** | `008:34, 62-70`; `alerts.ts:259-265, 382-384`; `lib/chat.ts:328, 392` |
| W1-4 | FLAG_SECURE clearable | **closed** | `secureScreen.ts:21-26` (no release); `SecurityProvider.tsx:87-95` |
| W1-5, W1-6, W1-7, W1-9 | http2 hang, Supabase URL, stale unlock, link mask | **closed** | `alerts.ts:218-256`; `lib/chat.ts:60-67`; `SecurityProvider.tsx:76-84, 161-166`; `InviteSheet.tsx:22-24, 46` |
| W1-8 | spike screen ships | **open (residual, lead decision)** | `apps/mobile/app/spike.tsx` present; not in `PUBLIC` (`_layout.tsx:31`); Settings row `__DEV__` (`settings.tsx:122`); `onepeek://spike` opens for a signed-in user in any build |
| W1-10, W3-3 | leak-guard blind spots | **closed** | `eslint.config.mjs:11, 15, 28, 59-73`; remains name-based (see F-11) |
| W2-1, W3-1 | reply preview / sent quote show Secret text | **closed** | `[id].tsx:426-428`; `MessageBubble.tsx:53-57, 110-114` |
| W2-2, W2-3 | picker copies, viewer temps | **closed**; W2-2 iOS `/private` prefix is a device check | `lib/files.ts:104-130`; `_layout.tsx:107-110` |
| W2-4 | EXIF/GPS | **open (decision; Phase 3)** | `files.ts:43`; sentence at `AttachSheet.tsx:73`; no `expo-image-manipulator` in `package.json` |
| W2-5 | table grants | **closed** | `008:39-42` |
| W2-6, W3-2 | E2E flag | **closed** | `app.config.ts:14-21, 136`; `app.config.test.ts` |
| W2-7 | keyboard learning | **closed** | `Composer.tsx:32, 69`; `SecretComposer.tsx:61`; `share.tsx:36-43` |
| W2-8, P2-1 | push re-register, raw `onChange` | **closed** | `PushRefresher.tsx:44-49`; `lib/chat.ts:195-230` |
| W2-9, W3-5 | W1-1 window invariant and core test | **closed** | `_layout.tsx:71-89`; `chat.test.ts` W3-5 case |
| W2-10 | copy | **closed** | `auth.tsx:35` |
| W3-4 | `treeText()` allow-list | **closed** | `room.test.tsx` prop walk |
| P2-2 | `forgetLinkingURL` never called | **closed** | `s/[id].tsx:125`; `chat/join.tsx:18` |
| P2-3, P3-1 | `consumeShare` on every exit | **closed** | `share.tsx:78-101, 110-113, 142-148, 168` |
| P2-4 | Android receiver `file://`, caps | **closed in code**; S22 device check pending | `ShareIntentModule.kt:45-46, 129-133, 176-221`; `ShareIntentModule.ts:43-53` |
| P2-5 | shared link as route param | **closed** for a bare link; **P3-5 open** for an embedded one | `shareIntent.ts:138-153` |
| P2-6, P2-7 | "Open secret" unheld; unlock token type | **closed** | `MessageBubble.tsx:69`; `s/[id].tsx:177` |
| P2-8 | browser fallback loops on Android | **closed**; S24b device check | `s/[id].tsx:232-236, 44` |
| P2-9 | quota id survives | **closed** | `lib/secrets.ts:96-99`; `lib/chat.ts:331, 409` |
| P2-10 | `expo-share-intent` wiring | **closed in code**; S27 (first EAS compile, App Group on both ids) pending | `app.config.ts:105-125`; `package.json:72-80`; `shareIntent.ts:56-58` |
| P3-2 | hand-off has no TTL; Join prefers a stale stash | **open** | `lib/links.ts:63-74`; `chat/join.tsx:17` (fix branch in flight) |
| P3-3 | `consumeShare` / container sweep are global | **open** | `shareIntent.ts:89-96`; `iosShare.ts:100` (fix branch) |
| P3-4 | `+native-intent` untested, wide import | **closed** | `app/__tests__/native-intent.test.ts`; `+native-intent.tsx:4` imports `@/security/links` |
| P3-5 | bridge recognises an exact link only | **open** | `shareIntent.ts:139` (fix branch) |
| P3-6 | no per-share byte total | **open** | `ShareIntentModule.kt:45-46, 132`; `iosShare.ts:83, 92` (fix branch) |
| P3-7 | Android Intent keeps a parked link | **closed** | `shareIntent.ts:142, 149` |
| Web parity | web reply preview and parent quote show Secret text | **open** (web owner) | `app/chat/r/[id]/page.tsx:341, 371` per the Phase 1 close-out |

### 4.2 New findings from the whole-app read

#### F-1 (high) — Sign-out keeps every chat key and message copy on the phone; the next account on the same phone can reach them. The website wipes on sign-out.

- `apps/mobile/lib/chat.ts:326-333` (`auth.signOut`: push unregister, `signOut({ scope: 'local' })`, `forgetClientId()`; no `keystore.wipe()`), `:387-413` (only `resetThisPhone` wipes the chat store). Compare the web: `app/chat/settings/page.tsx:125` runs `await chat.keystore.wipe(); await supabase?.auth.signOut()`. All chat records are keyed by room, not by user: `client.ts:148` `room:<id>:<part>`, `:181-186` `messages(roomId)`, `:163-165` `loadState(roomId)`; only the device record is user-scoped (`:123`). `settings.tsx:154` states the keep for guests ("its chats stay on this phone until they expire"); nothing states it for accounts.
- Failure scenario (shared or handed-over phone). A signs out; B signs in (or taps "Start a Quick Chat as a guest"). (1) B opens `onepeek://room/<id>` for any room id B knows (room ids are in A's push notifications: `thread-id` and `apns-collapse-id` carry them, `alerts.ts:150, 284`): `RoomScreen` renders `messages(roomId)` first (`room/[id].tsx:107-111, 160`) and only then `sync()` fails with `not_a_member` and forgets the room, so A's stored plaintext is on screen until the first sync returns, and permanently if the phone is offline. (2) If B is also a member of room R (family, team), B's client loads **A's MLS state** for R (`loadState` has no user scope), decrypts with A's leaf keys, shows A's locally stored copies alongside B's, and `sendTextLocked` encrypts B's messages with A's leaf while the server records B's device as sender: A's cryptographic identity is used by B. (3) A's device signing key stays sealed in `device:<A>` for the life of the install; a later `keystore_unavailable` or reset is the only thing that removes it. The wrapping key is the phone's, not the account's, so the OS lock is the only barrier, and B has passed it.
- Not a disclosure to a stranger (they must unlock the phone and sign in), but it breaks C9/C2 for the previous account, contradicts the web, and the plan's shared-phone work (W1-2) assumed sign-out ends the previous account's presence on the device.
- Fix (owner: core-crypto + lead decision). Preferred: `auth.signOut()` wipes the chat keystore as the web does (`get().keystore.wipe()` after the push unregister, before the Supabase sign-out), drops `built`, and the guest sentence at `settings.tsx:154` changes to "its chats are removed from this phone". If keeping guest chats across sign-out is wanted, scope every record by user instead: `roomKey = room:${userId}:${roomId}` and `messages()`/`loadState()` take the user from `ensureDevice()`; migrate nothing (old rows become unreachable and are swept by `expires_at`). Either way, `RoomScreen` should not render `messages()` for a room not in `myRooms()`. Tests: `chat.test.ts` "sign-out leaves no `room:` or `device:` rows" (or "rows of user A are invisible to user B"); `room.test.tsx` "a room not in myRooms renders nothing before sync".

#### F-2 (high) — Safety numbers and "key changed" compare keys the server supplies, not the keys inside the encrypted group; a server that substitutes a key package at admit time passes "They match"

- `packages/core/src/chat/client.ts:635-641` (`safetyNumberWith` uses `them.signaturePub` from `members()`), `:275-284` (`members()` maps `chat_room_members.signature_pub`, a column the server writes), `:643-649` (`markVerified` stores that same column), `:69-72` (`keyChanged` compares against it). The authenticated key of each member sits in the MLS ratchet tree and is already exposed by `mls.memberLeaves(state)[i].signaturePublicKey` (`mls.ts:182-191`) and `welcomeSignature()` (`:91-93`), which nothing calls. `chat_redeem_invite` (`006:361-394`) stores `p_key_package` as given; the server cannot and does not check that the package's signature key equals the device's `signature_pub`. `defaultAuthenticationService` accepts any credential (`mls.ts:43-51`).
- Failure scenario (the adversary the feature exists for). Bob redeems an invite; the server replaces `chat_members.key_package` with one it generated for the identity string `Bob's device id`. The owner's `admitPendingLocked` (`client.ts:290-317`) adds the server's package; the server decrypts the Welcome, builds a second group with Bob's real package and relays, re-encrypting both ways. `chat_room_members` still returns Bob's honest `signature_pub`, so Alice's and Bob's safety numbers agree and the app says "Their safety number is the same on both phones: nobody is intercepting this chat" (`scan.tsx:144`, `RoomMenu.tsx:323`) while every message is readable by the server. `keyChanged` never fires. Same code on the web (the core is shared), so this is inherited, not introduced; it matters more now because the store copy will repeat C12 and the threat model names the server operator.
- Fix (owner: core-crypto; tell the web owner). Compute the fingerprint from the tree: `safetyNumberWith` loads the room state and uses `mls.memberLeaves(state)` for both keys (fall back to `not_a_member` when the device has no leaf); `markVerified` stores the leaf key; `keyChanged` compares the leaf key. Additionally, in `applyRows` after a `welcome` and in `admitPendingLocked` before adding, compare each leaf's `signaturePublicKey` with `chat_room_members.signature_pub` and surface a mismatch as `ChatError('member_key_mismatch')` (refuse to admit; mark the member "Key mismatch" in the UI). Tests (`mls.test.ts`/`client` test with the fake): a member row whose `signature_pub` differs from the leaf key yields a different safety number than the server's column would, and `admitPending` refuses a package whose key does not match `signature_pub`. Until then, change C12's sentence.

#### F-3 (medium) — Who sent a message, and which nickname belongs to whom, is the server's word; the MLS-authenticated sender is discarded

- `mls.ts:162-170` returns `senderDeviceId: null` because `ts-mls@1.6.4`'s `processPrivateMessage` application result is `{ message, newState, consumed }` (`node_modules/ts-mls/dist/src/processMessages.d.ts:14-19`). `client.ts:593, 597, 605` attribute every message and every `nick` to `row.sender_device`, a column `chat_send` fills from the caller's device (`006:427-428`), which an honest server enforces (`chat_my_device`) but a malicious or compromised server can rewrite on read (`chat_fetch`, `:461-470`).
- Failure scenario: the server swaps `sender_device` on two members' rows; Carol's "the locker code is 4471" is shown under Dave's name with Dave's nickname, and the screenshot notice names the wrong person. MLS still guarantees the bytes came from *some* current member and were not altered, so the server cannot forge content, only attribution. Rated medium because it needs a malicious server and discloses nothing new to it; it is the gap between "encrypted" and "authenticated" that store reviewers may ask about.
- Fix (owner: core-crypto): ts-mls does verify the sender's leaf signature internally; what is missing is the API. Options: (a) include the sender's device id inside the application payload (`ChatPayload.from`) and refuse rows where it differs from `row.sender_device` (cheap, stops relabelling; a member can still claim another member's id, so compare against the signer when (b) lands); (b) upstream or patch ts-mls to return `senderLeafIndex` for application messages (it already does for proposals, `clientState.d.ts:61-87`) and map it through `memberLeaves`. Document in known-limitations until then.

#### F-4 (medium) — The QR code renders the full invite token / secret key on screen while the text beside it is masked "so a token is never drawn on screen"

- `components/InviteSheet.tsx:43` (`<QRCode value={link}>`) and `:46` (`maskLink(link)`); `components/SecretComposer.tsx:287, 290`; `RoomMenu.tsx:331` (safety number, not secret). `lib/format.ts:92` describes the mask as "so a token is never drawn on screen"; W1-9 was closed on that basis. A QR is machine-readable at phone-camera distance: a photo of the owner's screen, an iOS screenshot (not blockable), a screen recording (covered on iOS only after `isCaptured` flips) or a shoulder-surfer with a camera gets the bearer token or the AES key the mask hides.
- Fix (owner: mobile-ui): render the QR behind a "Show QR code" button that reverts after ~30 s or on `inactive`, keep the mask, and change the `format.ts` comment to what is true. Test: `new.test.tsx` and `secret.test.tsx` assert no `QRCode` with the link until the button is pressed.

#### F-5 (medium, informational for the adviser) — Plaintext and key material live in the JavaScript heap with no zeroisation, and the app cannot change that on Hermes

- JS strings are immutable and GC-managed: the invite token (`JoinScreen.tsx:29`), the secret link with its key (`s/[id].tsx:85`), the decrypted text (`:102`), the access code and nickname (`JoinScreen.tsx:32-33`), the pending email (`lib/chat.ts:160`), the unlock token (`s/[id].tsx:116`), every message body in `msgs` state (`room/[id].tsx:77`), and `redact()`'s inputs all stay in memory until collected, with copies left by React re-renders. Typed arrays can be zeroed and some are (`keystore.ts:140` `raw.fill(0)`; ts-mls `consumed` buffers, `mls.ts:129, 152, 166`), but decrypted attachment bytes (`client.ts:473-474`, `s/[id].tsx:195-197`) and MLS state objects are not, and `encodeGroupState` output is sealed from a plaintext copy. The wrapping key itself is held only as a non-extractable `CryptoKey` (`keystore.ts:139`), which quick-crypto keeps in native memory.
- What this means: a process memory dump (jailbreak/root, a debugger on a dev build, a crash dump if any crash reporter were ever added, which the lint forbids) can contain recent plaintext and keys. The lock state machine unmounts content (`SecurityProvider.tsx:184`) so React releases its references, but releasing is not erasing. No copy may say "wiped from memory" or "keys never in memory". Store wording: "decrypted only on your device, shown only while you hold". Adviser: this is the same posture as every React Native / web messenger; Signal-grade zeroisation needs native message handling, out of scope.

#### F-6 (low) — A tapped invite link creates an anonymous Supabase account before the user does anything

- `client.ts:255-259` `peekInvite` calls `ensureSession(true)`, which signs in anonymously when there is no session (`:107-114`); `JoinScreen.tsx:40-45` peeks as soon as a token exists, including from a Universal Link tap. Each tap on a signed-out phone that has no session mints an `auth.users` row; `chat_peek_invite` rate-limits per `auth.uid()` (`006:349`), which is new for each anonymous user. A hostile page that opens `onepeek://chat/join#<32 chars>` repeatedly, or an attacker scripting the web path, inflates `auth.users` (Supabase's anonymous sign-in rate limit is the only brake). Same as the web.
- Fix (owner: core-crypto/backend): peek without a session (make `chat_peek_invite` callable by `anon` with the IP-keyed limiter, as the comment at `006:349` already anticipates with `'anon'`), or defer `ensureSession(true)` to `redeemInvite`. Low: cost and noise, not disclosure.

#### F-7 (low) — `onepeek://reset` opens the wipe screen from any app, and `/reset` is public by design

- `_layout.tsx:31` (`reset` in `PUBLIC`), `reset.tsx:38-40` (two taps: "Reset" then "Yes, reset"), `_layout.tsx:137` (`gestureEnabled: false`). The lock still applies (the Stack is unmounted while locked), so this needs an unlocked phone, but a link in a message or a malicious app's intent can put the user two taps from losing every chat on the phone, with copy that reads like a repair step.
- Fix (owner: lead): accept the route only when `ChatProvider.guard` routed to it (a module flag set in `guard()` and checked in `reset.tsx`, else `Redirect href="/"`), or require the OS prompt (`authenticateDevice()`) before the second button. Test: `reset-settings.test.tsx` "a cold deep link to /reset redirects home".

#### F-8 (low) — The Supabase host check accepts any Supabase project, so a wrong or hostile build env still gets the session

- `lib/chat.ts:60-67`: `^https://[a-z0-9-]+\.supabase\.co$`. W1-6 closed the "arbitrary host" case; a preview build whose `EXPO_PUBLIC_SUPABASE_URL`/`ANON_KEY` point at someone else's project would send the sign-in, refresh token and every RPC to that project. Build-time trust, but `eas.json` environments are the only guard and nothing in the repo records the expected project ref.
- Fix (owner: lead): pin the project ref per profile in `app.config.ts` (fail the config when the env's host is not the known `production`/`preview` ref) or at least write the expected ref into `docs/mobile/release/accounts-checklist.md` and the `app.config.test.ts`.

#### F-9 (low) — Two notify requests per send, halving the push budget

- `client.ts:367, 454` (`notifyRoom` inside `send`/`sendFile`) and `room/[id].tsx:236, 268` (`void chat().notifyRoom(roomId)` again); `share.tsx:143` likewise. `/api/chat/notify` allows 4 per sender per room per minute (`route.ts:31`), so from the third message in a minute nobody is pushed. Noted in Phase 1 as "duplicate, not a leak"; recorded here because it is a liveness bug a tester will hit.
- Fix (owner: mobile-ui): delete the screen-side calls.

#### F-10 (low) — Dependencies with native code, and what the app trusts them with

| Package | Version at HEAD | Native code | What it holds | Trust note |
| --- | --- | --- | --- | --- |
| `react-native-quick-crypto` | `^1.1.9` | C++ (OpenSSL/BoringSSL via Nitro) | **Every key and every plaintext** passes through its WebCrypto | Single most trusted dependency. Pin exactly (not `^`), record the resolved version and its OpenSSL in the release notes, and re-run the core suite on a device after any bump (`installRnCrypto` asserts the surface, not correctness). |
| `react-native-nitro-modules` | `^0.37.1` | C++/JSI bridge | Carries quick-crypto's calls | Same bump discipline; pin. |
| `ts-mls` | `1.6.4` (MIT) | none | Group keys, ratchets | Unaudited (known-limitations 2); exact pin good. |
| `expo-secure-store` `~58.0.2`, `expo-sqlite` `~58.0.14`, `expo-local-authentication`, `expo-screen-capture` | Expo SDK 58 | Swift/Kotlin | Wrapping keys, sealed rows, the unlock prompt, FLAG_SECURE | Expo-maintained; `~` pins the minor. |
| `expo-share-intent` | `9.0.0` (MIT, community) | Swift extension + Kotlin (Android half excluded from autolinking) | Shared plaintext in the App Group | Reviewed in P2-10; its Android module is not compiled; `debug: false`. Re-read `plugin/build` on every bump (it edits entitlements and adds a target). |
| `react-native-qrcode-svg` `^6.3.49`, `react-native-svg` `15.16.0` | JS + native SVG renderer | Renders the invite link / secret link / safety number as a QR | Receives the full bearer/key string as a prop (F-4). No network. |
| `@supabase/supabase-js` `^2.118.0` | none | Session, refresh token, RPC args | `auth.storage` is ours (sealed). `^` allows minors; pin before the store build. |

- Fix (owner: lead): exact pins for the three crypto-path packages and a `package-lock.json` check in CI; a one-line "native dependency bump" rule in `plan.md` (device run of the core suite + MANUAL S1/S8/S12).

#### F-11 (low) — Leak-guard blind spots that remain, written down for the next reviewer

- The lint (`apps/mobile/eslint.config.mjs:15, 28, 59-73`) fires on *argument names*; `SENSITIVE` does not include `link`, `url`, `text`, `value`, `data`, `uri` because they are legitimately used. So `Clipboard.setStringAsync(link)` (`InviteSheet.tsx:32`), `Share.share({ message: link })`, `router.push({ params })` (not a listed sink at all: `shareIntent.ts:155`, `share.tsx` reads `params.text`), `QRCode value={link}` (F-4), and `Image source={{ uri }}` with a `data:` URI of decrypted bytes (`FileViewer.tsx:98`, legitimate) all pass. `redact()` is only called by the no-op `log()`; no sink is wired, so its blind spots (numbers under neutral keys, `log.ts:34-36`) are theoretical today. The real proofs are the tree-walk and request-sweep tests; keep them the gate, not the lint.

#### F-12 (low) — `expo-updates` is absent, so the OTA promise is a dependency fact, not a control

- `app.config.ts:32-34` and the build prompt forbid OTA changes to crypto; `eas.json:27, 37` declare update channels; `package.json` has no `expo-updates`, so `eas update` cannot reach a device. Good; but the first person who adds the package to ship a copy fix silently re-opens "JS crypto by OTA". Fix (owner: lead): record in `plan.md` and `docs/mobile/release/versioning.md` that adding `expo-updates` needs a security review, and keep the lint's `expo-updates` import ban.

### 4.3 Cross-cutting checks (one line each)

- **State across sign-out / reset.** Sign-out: push row removed, session removed, quota id removed, pending email cleared, picker caches **not** swept, chat keystore **kept** (F-1), hand-off slots kept (P3-2), `onSignedIn` listeners kept (by design). Reset: everything above plus both wipes, lock cleared, caches swept; hand-offs and the spike's `onepeek-spike.db`/`onepeek.wrap.spike` are not touched (dev only).
- **AuthGate / PUBLIC as a whole.** `welcome, sign-in, auth, join, chat, reset, s` (`_layout.tsx:31`). `s` and `chat/join` are public because the website is; `auth` must stay off the redirect path (W2-9 invariant, `:71-79`); `reset` is F-7. `share`, `room`, `settings`, `new`, `secret`, `scan`, `spike`, `index` need a session; a signed-out share is consumed and redirected (`share.tsx:110-113`). `spike` is reachable signed-in (W1-8).
- **Every `Linking.openURL` / `Share` / `Clipboard` / browser call.** `sign-in.tsx:72` (`openAuthSessionAsync`, provider URL); `welcome.tsx:36, 38` (`openBrowserAsync`, two literals); `scan.tsx:99` (`openSettings`); `s/[id].tsx:214` (clipboard: decrypted secret, user tap), `:234` (browser: full secret link, user tap, sentence on screen); `SecretComposer.tsx:269, 273` and `InviteSheet.tsx:32, 36` (clipboard/share: full link, user tap); `files.ts:177` (`Sharing.shareAsync`, decrypted temp file, user tap, deleted in `finally`); `spike.tsx:142` (benchmark text, dev). No call happens without a tap; none carries anything the user did not choose to export.
- **Every `fetch` target.** `adapters/rn/platform.ts:68` → `https://onepeek.io/api/chat/notify` (bearer + room id); `lib/report.ts:28` → `https://onepeek.io/api/chat/report` (bearer, room id, reason); `secrets.ts:378` → `https://onepeek.io/api/{open,unlock/send,unlock/verify}` (id, precise=null, unlock token, email, code); supabase-js → `https://<ref>.supabase.co` (RPCs, storage, auth); APNs/FCM only from the server. No other host anywhere in `apps/mobile` or the core.
- **Every SecureStore entry and SQLite file.** `onepeek.wrap` (chat wrapping key), `onepeek.wrap.auth` (session wrapping key), `onepeek.lock` (panic flag), `onepeek.client` (quota id), all `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; dev only: `onepeek.wrap.spike`. Files: `onepeek-chat.db`, `onepeek-auth.db` (both excluded from iOS backup by directory and by name, `backup.ts:19-27`; Android: all domains excluded); dev only: `onepeek-spike.db`. The auth database holds the refresh token sealed; `expo-secure-store` is used for keys and flags only (iOS Keychain item size cap, `auth-storage.ts:3-6`).
- **Error messages that could carry user data.** Every user-facing string is fixed (`format.ts:60-83`, `s/[id].tsx:52-64`, `auth.tsx:35`); `ChatError` keeps only the trailing code (`client.ts:61`); `SecretError` carries typed numbers (`secrets.ts:150-169`); `createRnEnv` names the option, never the value (`platform.ts:42-49`); `spike.tsx:115` shows a raw error message (dev only).
- **Push path.** Token reaches `push.register` and the sealed row only; `PushRefresher` never requests permission; payloads are two fixed strings plus the room id; dead tokens are deleted per owner; takeover reclaims at the next launch or verified sign-in.
- **Backend.** No direct table grants to `anon`/`authenticated` except `push_devices` `select, delete`; every RPC checks `auth.uid()`; removals by non-owners limited to server-recorded ones (`006:417-419`); `chat_send` does not validate `p_epoch` against the room (clients ignore stale epochs, so harmless); the 2-minute view-once download window is per room, not per claimer (known-limitations 5).

### 4.4 Parity table: the same secret on the web and in the app

| Secret / behaviour | Web | App | Delta that matters |
| --- | --- | --- | --- |
| Supabase session | `localStorage` (supabase-js default), plaintext in the profile | sealed SQLite under a Keychain-held key | App is stronger |
| MLS state, message copies | IndexedDB sealed under a non-extractable `CryptoKey` (software only, README web adapter `:5-7`) | SQLite sealed under a `THIS_DEVICE_ONLY` Keychain/Keystore key, excluded from backups | App is stronger |
| Sign-out | `keystore.wipe()` then `signOut` (`app/chat/settings/page.tsx:125`) | `signOut` only (`lib/chat.ts:326-333`) | **F-1** |
| Invite token / secret key arrival | URL bar and browser history until `replaceState` | native initial-URL cache until `forgetLinkingURL()`, never in router state | App is stronger; browser fallback (P2-8) re-introduces the web's exposure by choice |
| Secret text on screen | hold-to-read, 3-second blur on shortcut, blur on pointer leave | hold-to-read, FLAG_SECURE (Android), cover on inactive/captured, screenshot notice | App is stronger; web still shows Secret text in the reply preview and parent quote (open) |
| Safety number source | `chat_room_members.signature_pub` | same core | **F-2** on both |
| Sender attribution | `row.sender_device` | same core | **F-3** on both |
| Push | Web Push (VAPID) subscription, URL + tag with room id | APNs/FCM device token, `thread-id`/`collapse-id` with room id | Equivalent metadata |
| Quota id | `localStorage` `onepass.client`, dies with site data | Keychain `onepeek.client`, wiped on sign-out/reset, may survive reinstall on iOS | Documented (known-limitations 13) |
| Panic lock | `localStorage` flag + BroadcastChannel, no OS check | SecureStore flag + OS biometric/passcode | App is stronger |
| EXIF in photos | not stripped | not stripped | Same gap (W2-4) |
| Plaintext file copies | browser `File` objects, no disk copy by the app | picker/share copies in the cache, deleted after use and on launch | App-only surface, handled |

---

## 5. Beta readiness verdict

**Internal beta (team phones, dev/preview builds, no strangers' data): acceptable now**, with these understood: the
spike route exists; sign-out does not clear chats (F-1), so testers must use "Reset chats on this phone" before handing a
device over; safety numbers do not detect a hostile server (F-2), which is not the internal beta's adversary; the open
P3 lows are a fix branch away.

**Before any external tester (TestFlight external / Play closed track):**

1. F-1 fixed and tested (sign-out wipes the chat keystore, or records are user-scoped), copy at `settings.tsx:154` updated.
2. F-2 either fixed in the core (tree-sourced safety numbers; admit refuses a mismatched package) or the sentence at
   `scan.tsx:144` / `RoomMenu.tsx:323` changed, with known-limitations updated. Tell the web owner either way.
3. F-4: QR behind a tap, or the W1-9 claim rewritten.
4. The Phase 3 fix branch merged: P3-2 (hand-off TTL, Join prefers the tapped link), P3-3 (per-nonce consume), P3-5
   (embedded links), P3-6 (per-share byte total), W1-1 residual (pending email surviving a cold start).
5. `spike.tsx` deleted (W1-8) and F-7 (`/reset` gate) landed; F-9 (double notify) removed so pushes work in testing.
6. Exact pins for `react-native-quick-crypto`, `react-native-nitro-modules`, `@supabase/supabase-js` (F-10).
7. The e2e and development profiles never distributed outside the team (they unmask the invite link and are debuggable).

**Device checks that gate a store submission** (none can be settled by reading; all are in `MANUAL-CHECKS.md`):

- Android: S1–S4 (FLAG_SECURE everywhere, including after leaving a room and after a process restart), S17–S18
  (backup/transfer opt-out), S21–S23 (share receive, `run-as` listing of the cache, `file://` injection refused, 12 → 10,
  >50 MB skipped), S24–S25 (App Link cold/warm start with fragment, Intent cleared after the viewer), S26.
- iOS: S5–S7 (screenshot notice, recording cover, inactive cover), S15–S16 (backup manifest, device transfer leaves no
  chats), S24 (Universal Link cold start carries the fragment; Safari history empty), S27 (first EAS compile with the
  share extension; App Group on both identifiers; container empty after consume; `log stream` shows no file names).
- Both: S8–S14 (lock state machine, stale unlock, panic flag, insecure device), S19–S20 (watermark, accessibility),
  the W2-2 iOS `/private` prefix check, real APNs/FCM delivery with the fixed banner, Apple/Google sign-in round trips
  with `onepeek://auth` allow-listed in Supabase Auth, and `react-native-quick-crypto` on Hermes running the core suite's
  interop scenario on a real phone (the Phase 0 spike numbers were never captured).
- Server: migrations 008 and 009 applied to production with `supabase/tests` green against it; AASA and assetlinks served
  without redirect (`app/.well-known/*`).

---

## 6. Open questions for the human adviser

1. **Export compliance.** `ITSAppUsesNonExemptEncryption` is `true` (`app.config.ts:42`). The app implements end-to-end
   messaging with MLS (X25519, AES-128-GCM, Ed25519 via ts-mls) and AES-256-GCM for files and one-time secrets, using
   the OS/OpenSSL primitives through `react-native-quick-crypto`. Does the US (EAR 5D992 / ENC) self-classification and
   annual report apply, and does the product qualify for the "mass market" exemption? Same question for the French
   declaration (secure messaging distributed in France) and any Indian import/usage rules, since the company is in Delhi.
2. **Apple review.** Guideline 5.1.1 (data collection and storage) and the privacy label: the server stores room ids,
   device ids, push tokens, report rows and an IP-derived city on `/api/open`. Is "Data Linked to You: User ID, Device ID
   (push token)" plus "Data Not Collected: messages" the right declaration, and must the account email appear even
   though guests have none? Apple also asks for a demo account; guests can join without one, but Business rooms need an
   owner's phone open to admit a reviewer: who runs that during review?
3. **Google Play.** Data safety form: the same facts, plus the `SEND`/`SEND_MULTIPLE` intent filters and the camera.
   Does receiving arbitrary files from other apps require any declaration beyond "files and docs: not collected"?
4. **Data protection (GDPR / DPDP Act 2023).** The server is a processor of metadata (who talks to whom, when) and
   cannot read content. Is a DPIA needed for a messaging product; what is the lawful basis for keeping `chat_security_events`
   (30 days) and `chat_reports` (indefinite, `009`); and does the quota client id (a device identifier that may survive
   reinstall on iOS, known-limitations 13) count as personal data that needs a notice at first launch?
5. **Anonymous accounts.** Every guest join creates a Supabase user (F-6). Does the privacy policy cover accounts the
   person never knowingly created, and how are they deleted (today: never, unless Supabase's anonymous-user cleanup runs)?
6. **Reports and lawful requests.** The server cannot produce content. What is the written policy when a report or a
   legal request arrives: metadata only, and burn on the owner's request? Store reviewers ask messaging apps for an
   abuse-reporting path; `report_chat` exists, but who reads `chat_reports` and within what time?
7. **Claims review.** Before copy is written from §3, confirm the adviser is comfortable with C12 (safety numbers) and
   C9/C10 (sign-out) being changed or fixed first; both would be false statements in a store listing as the code stands.

---

## Verdict line

**Two open high: F-1 (sign-out keeps the chat keystore; the next account on the phone can reach the previous one's
rooms and keys; the web wipes) and F-2 (safety numbers compare server-supplied keys, so a server MITM at admit time passes
"They match"; inherited from the web, repeated in the planned store copy).** Medium: F-3 (sender attribution is the
server's word), F-4 (QR shows the token the mask hides), F-5 (no heap zeroisation on Hermes: informational, must not be
claimed away). Low: F-6..F-12. Previous items: all Phase 1 and Phase 2 findings closed except W1-8 (spike ships), W2-4
(EXIF, decision), P3-2/P3-3/P3-5/P3-6 (fix branch in flight) and the W1-1 cold-start residual. Internal beta: acceptable
now with the caveats in §5. External testers: after items 1–7 in §5. Store: after the device checks in §5.
