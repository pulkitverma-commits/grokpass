# OnePeek mobile apps: build plan

Lead: Claude (lead engineer). Status: **Phase 0, planning, waiting for human approval** (2026-10-31).
Source of truth for scope and rules: the build prompt (sections 1, 3, 4). This file holds the task
breakdown, owners, order and risks. The running log is `log.md`; gate evidence goes in `gates/`.

## 0. What the audit found (read before anything else)

Baseline on `main` at `47f46ee`, run locally on 2026-10-31:

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm test` (vitest) | 5 files, 58 tests, all green in 2.6 s |
| `npm run lint` | **no such script**: there is no ESLint or Prettier in the repo |
| CI | **none**: no `.github/`, Vercel deploys `main` with no checks |
| Node | not on PATH on this Mac; a Node 22.22 lives at `~/Sites/newspop/.node/bin` |
| `gh` CLI | not installed, so PRs are opened from the GitHub web UI (or the human installs `gh`) |

What the shared code looks like today, and what the extraction has to untangle:

- `lib/crypto.ts` (141 lines): pure WebCrypto + `btoa`/`atob`. Platform-neutral already except for
  `btoa`/`atob` (present in Hermes) and `crypto.getRandomValues`.
- `lib/chat/mls.ts` (232 lines): wraps `ts-mls` 1.6.4, which depends on `@hpke/core` 1.9.0.
  X25519 is pure JS inside `@hpke/common`; **everything else goes through `crypto.subtle`**:
  AES-GCM encrypt/decrypt, HKDF import + derive, SHA-256 digest, Ed25519 generate/sign/verify.
  So the device needs a `crypto.subtle` that covers those five families. This is the spike.
- `lib/chat/client.ts` (655 lines): the per-room lock, sync, send, files, view-once, alerts.
  Browser-bound pieces: `import { supabase } from '../supabase'` (module singleton),
  `window.location.origin` in `createInvite`, `navigator.userAgent` for the device label,
  `localStorage` + `BroadcastChannel` for the panic lock, `File`/`Blob` in `sendFile`/`openFile`,
  `fetch('/api/chat/notify')` with a relative URL, `crypto.randomUUID`, `sb().auth.passkey` in
  `unlock()`. Each becomes a small interface injected into the core.
- `lib/chat/keystore.ts` (130 lines): IndexedDB holding a **non-extractable** AES wrapping
  `CryptoKey`. On device this becomes an interface with the key in `expo-secure-store` and the
  sealed records in SQLite.
- Server: migration `006` (12 `chat_*` tables, 27 RPCs, storage bucket `chat-attachments`,
  realtime policy, `pg_cron` reaper), `007` (guest check). `lib/alerts.ts#pushTo` reads
  `push_subscriptions` (web push only). `app/api/chat/notify/route.ts` sends the content-free
  nudge via `pushTo`. `notify_prefs.push_on` is the opt-out.
- Tests: `lib/chat/client.integration.test.ts` boots PGlite with `supabase/tests/supabase-stubs.sql`
  + migration `006`, mocks `../supabase` per "browser" with `vi.doMock`, gives each browser its own
  `fake-indexeddb` instance, and swaps `globalThis.indexedDB` between calls. The mobile interop test
  reuses the SQL side and adds a second client built from `packages/core` with RN adapters mocked.
- One-time secrets (Phase 2): links are `${origin}/s/${id}#${keyB64}`; creating uses the `create_secret`
  RPC from `app/page.tsx`; opening goes through `POST /api/open` (server counts views, applies locks).
- Design: 13 PNGs in `docs/mobile/design/` (390×844 frames). The web `app/chat/chat.css` already
  defines the token set (`--c-bg #0A0C0F`, `--c-accent #C8F135`, `--c-mine` gradient, radii 16/12/8).

Environment facts that shape the plan:

- **There is no staging Supabase project.** Secret Chat was shipped straight to production
  (`docs/secret-chat/deployment.md`, decision of 2026-10-28). Gate 0 and Gate 1 say "on staging"; see
  open question Q1.
- The Expo app needs an EAS project, Apple and Google developer accounts, APNs key and FCM
  credentials before any device build or push test. All of those are rule 6 items (human).
- `.env.example` is in `.gitignore` (odd, but existing). The mobile app will ship its own
  `apps/mobile/.env.example`; the lead will ask whether to un-ignore the root one.

## 1. Architecture (fixed by the prompt, restated so every agent sees the same picture)

```
grokpass/                      npm workspaces root (web app stays at the root, unchanged paths)
├── packages/core/             platform-neutral: crypto, mls, chat client, interfaces
│   ├── src/crypto.ts          moved from lib/crypto.ts (lib/crypto.ts re-exports)
│   ├── src/chat/mls.ts        moved from lib/chat/mls.ts
│   ├── src/chat/client.ts     moved; takes a ChatPlatform object instead of globals
│   ├── src/chat/ports.ts      interfaces: KeyStore, SupabaseLike, Realtime, Notifier, Env, Clock
│   ├── src/adapters/web/      IndexedDB keystore (current code), window/navigator bits
│   └── src/adapters/rn/       SecureStore + SQLite keystore, quick-crypto subtle, expo-fetch
├── apps/mobile/               Expo (Router, TypeScript strict), EAS
│   ├── app/                   screens (mobile-ui)
│   ├── components/, theme/    (mobile-ui)
│   ├── modules/, security/    native protections (native-security)
│   ├── e2e/                   Maestro flows (qa)
│   ├── store/, eas.json       (release)
│   └── app.config.ts          (lead)
├── lib/                       thin re-exports so the web app does not move
└── supabase/migrations/008+   additive server changes (backend)
```

Interfaces the core exposes (names are the contract between agents; shapes are finalised by
`core-crypto` in task C1 and reviewed by the lead before anyone depends on them):

- `KeyStore`: `get/put/del/delPrefix/keys/sweep/wipe` exactly as `keystore.ts` today, plus `open()`.
- `SupabaseLike`: the subset of `SupabaseClient` the client uses (`auth.getSession`,
  `auth.signInAnonymously`, `rpc`, `storage.from().upload/download`, `channel`, `removeChannel`,
  `realtime.setAuth`, `auth.passkey?`).
- `Env`: `origin()` for invite links, `deviceLabel()`, `randomUUID()`, `notifyUrl()`.
- `Lock`: `lock/isLocked/unlock` storage (localStorage on web, SecureStore flag on device).
- `FileSource`: `{ name, mime, size, bytes(): Promise<Uint8Array> }` replacing `File` in `sendFile`;
  `openFile` returns `{ bytes, mime }` and the web wrapper turns it back into a `Blob`.

## 2. Phase 0 tasks (target 2 weeks)

| # | Owner | Task | Depends on | Done when |
| --- | --- | --- | --- | --- |
| L0 | lead | This plan, agent files, `log.md` | — | human approves |
| L1 | lead | Root `package.json` → npm workspaces (`apps/*`, `packages/*`); root scripts fan out (`typecheck`, `lint`, `test`) | L0 | web `build`, `typecheck`, `test` unchanged |
| L2 | lead | ESLint (flat config, `@typescript-eslint`, `eslint-plugin-react-hooks`) + Prettier at the root, scoped so the existing web code passes with at most warnings | L1 | `npm run lint` exits 0 |
| L3 | lead | `apps/mobile` scaffold: Expo SDK latest, Expo Router, TS strict, `app.config.ts` with bundle ids `io.onepeek.app`, scheme `onepeek`, `expo-secure-store`, `expo-sqlite`, `react-native-quick-crypto`, `expo-notifications`, `expo-local-authentication`, `expo-screen-capture`, `expo-camera`, `expo-image-picker`, `expo-document-picker`, `expo-sharing`, `expo-linking` | L1 | `npx expo prebuild --no-install` runs; `tsc` clean |
| L4 | lead | GitHub Actions: `typecheck`, `lint`, `test` for root + core + mobile on PRs to `main` and `mobile/integration` | L1–L3 | workflow green on the integration branch |
| L5 | lead | Create `mobile/integration` branch; `docs/mobile/gates/phase-0.md` | all | gate doc written |
| C1 | core-crypto | Define `ports.ts` interfaces; extract `packages/core` from `lib/crypto.ts`, `lib/chat/mls.ts`, `lib/chat/client.ts`, `lib/chat/keystore.ts` with **zero behaviour change**; `lib/*` become re-exports; web adapters hold the IndexedDB/`window` code | L1 | web typecheck + all 58 tests green; `packages/core` has its own `vitest` run of the moved unit tests |
| C2 | core-crypto | RN crypto spike: `react-native-quick-crypto` as `globalThis.crypto` (`subtle`: AES-GCM, HKDF, SHA-256, Ed25519 generate/sign/verify, `getRandomValues`, `randomUUID`); prove `ts-mls` creates a group, adds a member, encrypts/decrypts on **real iOS and Android dev builds** | L3 | a `spike.md` with numbers: encrypt+decrypt of 200 text messages, `sync` of 200 rows, group state save/load, on both phones |
| C3 | core-crypto | RN adapters: `KeyStore` on `expo-secure-store` (wrapping key, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`) + `expo-sqlite` (sealed records), `Env`, `Lock`, `FileSource` | C1, C2 | adapter unit tests with mocked SecureStore/SQLite; `wipe()` makes records unreadable before rows are deleted |
| Q1 | qa | Interop test in `packages/core`: web client (current harness) + mobile-core client (RN adapters mocked to Node crypto and an in-memory SQLite) in one PGlite room: text, file, view-once file, removal, burn, screenshot alert | C1 | `npm test` includes it; passes; no plaintext in the SQL log (same assertion style as today) |
| Q2 | qa | `docs/mobile/test-plan.md` v1: unit, interop, Maestro, device matrix, manual security checks | — | reviewed by lead |
| S0 | security-reviewer | Review C1 (extraction diff) and C3 (key storage access classes, backup exclusion plan) | C1, C3 | `docs/mobile/security-review/mobile-core-crypto-*.md`, no open high findings |
| R0 | release | List exactly what the human must create (Apple team id, bundle ids, EAS project, APNs key, FCM project) with the console steps, in `docs/mobile/release/accounts-checklist.md` | — | checklist ready for the human |

Order: L0 → human approval → L1, L2 in sequence (lead, ~1 day) → L3 (lead) and C1 (core-crypto)
in parallel → C2 needs L3 and the human's EAS/Apple/Google setup (R0 unblocks that) → Q1 after C1
→ C3 after C1 and C2 → S0 → L4, L5.

Gate 0 evidence to collect: interop test output; spike numbers from two physical phones;
a screen recording or screenshots of a phone dev build and a browser in one room on the
production Supabase project (see Q1 below); web build/typecheck/test output; security review.

If `ts-mls` fails on device (missing Ed25519 or HKDF in quick-crypto's `subtle`, or performance
over 2 s for 200 messages): fallback is a native MLS module (`mls-rs` via a Rust → uniffi / JSI
binding, or OpenMLS) behind the same `mls.ts` interface. Estimate: 3 to 4 weeks for one engineer
plus a re-review, because the wire format must stay compatible with the web's `ts-mls` members.
The lead stops and asks before going there.

## 3. Phase 1: Secret Chat core (target 6 weeks)

| # | Owner | Task | Depends on |
| --- | --- | --- | --- |
| U1 | mobile-ui | Theme tokens from `chat.css` + design PNGs; fonts (Questrial, Geist Mono); `Screen`, `Button`, `Field`, `Sheet`, `ListRow` primitives; 44 px targets; dynamic type | L3 |
| U2 | mobile-ui | Welcome (01), Sign in (02): passkeys, Apple, Google, email link, "join as guest" | U1 |
| U3 | mobile-ui | Locked (03) screen wired to `security` lock state | U1, N4 |
| U4 | mobile-ui | Chats home (04): rooms list from `core.myRooms`, pending-join "Let in" row, search, New chat, One-time secret entry | U1, C3 |
| U5 | mobile-ui | Conversation (05, 06): hold-to-read in Secret rooms, timers, replies, files, view-once viewer, screenshot notices, composer with timer picker | U4 |
| U6 | mobile-ui | New chat (08), invite sheet with QR + link, Join (09) with access code + nickname | U4 |
| U7 | mobile-ui | Room menu: members, verify / safety number + QR, burn, leave; Settings (12) | U4 |
| N1 | native-security | Android `FLAG_SECURE` on chat and secret screens (config plugin + per-screen hook) | L3 |
| N2 | native-security | iOS: `UIScreen.isCaptured` blanking, app-switcher cover, screenshot notification → `core.sendScreenshotAlert(roomId)` | L3 |
| N3 | native-security | Backup exclusion: `isExcludedFromBackup` for the SQLite file; Android `allowBackup=false` + `dataExtractionRules` | C3 |
| N4 | native-security | Biometric lock on open, auto-lock after 60 s in background, Panic Exit (lock + cover now) | C3 |
| N5 | native-security | Watermark overlay (viewer name, device code, time), reusing the web's wording | U5 |
| B1 | backend | `008_mobile_push_tokens.sql` (+ `_down`): `push_devices(owner, platform, token, created_at, last_seen)`, RLS owner-only, service-role read; PGlite test | — |
| B2 | backend | `lib/alerts.ts#pushTo`: add APNs (token-based auth) and FCM v1 senders; payloads carry only the fixed strings; web regression test for existing web push | B1 |
| B3 | backend | `app/.well-known/apple-app-site-association` and `assetlinks.json` route handlers, values from env (`APPLE_TEAM_ID`, `ANDROID_SHA256_CERT`); web test that `/s/...` and `/chat/join` paths are listed | — |
| B4 | backend | `/api/chat/notify`: also send to `push_devices`; test proves the payload has no room, sender or text | B2 |
| Q3 | qa | Maestro flows (iOS + Android simulators): create → invite → join → admit → message → file → view-once → burn | U5, U6 |
| Q4 | qa | Unit tests for every new module; lint rule or test forbidding `console.log` with message/key/token identifiers in `apps/mobile` and `packages/core` | ongoing |
| S1 | security-reviewer | Review every PR before integration merge | ongoing |
| R1 | release | `eas.json` (development, preview, production), app icon + splash from `public/icon-512.png`, version policy | L3 |

Gate 1: phone ↔ browser end to end on the live project (Q1), push with no content, black
screenshots on Android, blanked recording on iOS, lock works, no open high findings.

## 4. Phase 2: secrets inside chat and sharing (target 3 weeks)

| # | Owner | Task |
| --- | --- | --- |
| C4 | core-crypto | `packages/core/src/secrets.ts`: `createOneTimeLink` (same `create_secret` RPC and `#key` format as `app/page.tsx`), `openSecretLink` (via `/api/open`, decrypt on device) |
| U8 | mobile-ui | "Send as secret" sheet (07): in-chat view-once or onepeek.io link; share sheet target (10); QR scanner (11) for invites, secrets, safety numbers; block member; report chat (no decrypted content) |
| N6 | native-security | iOS share extension + Android share intent, FLAG_SECURE on the secret viewer, Universal Links / App Links handling with the fragment read on device only |
| B5 | backend | Report-chat endpoint (ids only), additive RPC if needed |
| Q5 | qa | Cross-platform secret tests: app → web, web → app; link routing with and without the app; share from Photos and Files |

Gate 2 as in the prompt.

## 5. Phase 3: hardening and beta (target 3 weeks)

Security-reviewer full report; qa device matrix (2 iPhones incl. one older, 3 Android across price
ranges, Android 10+), performance (cold start, 200-message sync, 50 MB file), offline/reconnect,
VoiceOver/TalkBack/dynamic type; release prepares store listings, privacy labels / Data safety,
export compliance (`ITSAppUsesNonExemptEncryption` = true with the standard-encryption exemption
questionnaire drafted for a human adviser), reviewer notes, TestFlight and Play internal tracks.
Gate 3 as in the prompt.

## 6. Branching and merge flow

- Agents: `mobile/<agent>/<task>` from `mobile/integration`, in their own worktree.
- Lead reviews the diff, runs the checks, waits for `security-reviewer`, then merges into
  `mobile/integration` (no squash, so history stays readable).
- One PR per phase: `mobile/integration` → `main`, with `docs/mobile/gates/<phase>.md` linked.
  The human merges. Nothing is ever pushed to `main` by an agent.
- The Phase 0 planning branch is `mobile/phase-0-plan` (this document).

## 7. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| `react-native-quick-crypto` `subtle` lacks Ed25519 or HKDF | medium | blocks MLS on device | C2 checks the exact API list on day one; fallback: `@noble/ed25519` + `@noble/hashes` HKDF wired into a custom `subtle` shim **only for those two**, AES-GCM stays native. Documented as a Gate 0 decision |
| ts-mls performance on low-end Android | medium | slow sync | C2 measures on a budget Android phone; group state is saved once per batch in `applyRows` already |
| No staging database | certain | tests touch production | all automated tests stay on PGlite; manual device checks create throwaway rooms (1-hour lifetime) on production; **no migration is applied by an agent** |
| Apple/Google/EAS accounts not ready | medium | C2 and all device gates slip | R0 checklist first week; simulators cover UI until then |
| Extraction changes web behaviour | low | live site breaks | zero-diff rule for C1, existing 58 tests plus `next build` in CI |
| Push senders need APNs/FCM secrets | certain | B2 untestable locally | senders unit-tested with mocked transports; real send verified at Gate 1 with the human's keys in EAS/Vercel secrets |
| Key storage claims | low | wrong copy in store | native-security documents what each platform actually guarantees; release copies that wording |

## 8. Open questions for the human (answers needed before Phase 0 starts)

1. **Q1 staging.** There is no staging Supabase project. Gates 0 and 1 say "staging". Options:
   (a) create a staging project (your action, costs money on Pro) and point dev builds there;
   (b) use production with throwaway rooms and no schema changes until the Phase 1 PR; or
   (c) both, staging later. I recommend (b) for Phase 0 and (a) before Phase 1's migration `008`.
2. **Q2 accounts.** Apple Developer team, Google Play Console, EAS project (Expo account), APNs
   key, Firebase project for FCM. `release` writes the checklist (R0); you create them.
3. **Q3 lint scope.** ESLint will be new for the web code too. OK to add it with rules set so the
   existing code passes (warnings allowed, errors only for new code)? This touches only config files.
4. **Q4 Node.** Node is not on PATH on this Mac; I will use `~/Sites/newspop/.node/bin` (22.22). Fine,
   or do you want a system install?
5. **Q5 `gh`.** Not installed. PRs will be opened from the web UI by you, or you install `gh` and I
   open them. Which?
6. **Q6 bundle ids.** Proposed `io.onepeek.app` (iOS and Android), scheme `onepeek://`. Confirm.
