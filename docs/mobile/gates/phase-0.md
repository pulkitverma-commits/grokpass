# Gate 0: spike and setup

Date: 2026-10-31. Branch: `mobile/integration` (28 commits ahead of `main`, 101 files).
Decision: **approved by the human on 2026-10-31 with the device spike deferred.** The spike runs once the
accounts in `docs/mobile/release/accounts-checklist.md` Part A exist; its numbers are appended to section 4.

## 1. Gate criteria and status

| Criterion (from the build prompt) | Status | Evidence |
| --- | --- | --- |
| Interop test passes | **Done** | `packages/core/test/interop.integration.test.ts`: 20 tests, 28 planned assertions, web owner + phone guest and the reverse, ran 5× without flake. Section 3. |
| MLS runs on a physical iPhone and Android phone (dev builds) and talks to a browser member | **Blocked on human** | No Xcode, Android Studio, Java or emulator on this Mac; EAS Build needs an Expo account; iOS needs the Apple Developer Program. The spike screen is written and the JS bundles for both platforms through Metro to Hermes bytecode. Section 4. |
| Web build, typecheck and all existing tests still pass | **Done** | Section 2. The three original web tests are byte-identical to `main` and pass. |
| `packages/core` extracted with the web green | **Done** | Security reviews S0a and S0b, no high or critical findings; all mediums fixed. Section 5. |
| Monorepo, Expo app, lint, CI | **Done** | Section 6. |

## 2. Commands and results (run on `mobile/integration` at `024ffbd`, Node 22.22)

```
npm run typecheck   → clean (web root, @onepeek/core, @onepeek/mobile)
npm run lint        → 0 errors (root 49 warnings grandfathered from the existing web code, core 2 warnings)
npm test            → root: 5 files, 58 passed (identical to main)
                      @onepeek/core: 6 files, 87 passed (19 moved unit tests, 48 adapter tests, 20 interop)
npm run build       → next build: Compiled successfully, 37 static pages
expo export (android, ios) → 1567 / 1574 modules bundled, Hermes bytecode, no resolution errors
```

## 3. Interop test (qa, Q1)

Two clients built from the same `packages/core` share one PGlite database running the real
migration `006` and the Supabase stubs: a web client (IndexedDB keystore, `fake-indexeddb`) and a
phone client (SecureStore + SQLite keystore with Node's WebCrypto standing in for quick-crypto).
Scenarios, each run with the roles swapped: create a Secret room with an access code, invite by
link, peek, wrong code refused, redeem, admit, sync; text both ways with open timers; file both ways
with decrypted bytes compared; view-once (first open works, second refused, sender cannot open);
removal commit (removed side locked out cryptographically and local keys dropped); burn on both;
screenshot alert from the phone shown on the web as a notice; nickname via the encrypted control
message; concurrent send and sync; panic lock. Every scenario then sweeps the SQL log, a dump of
every `chat_*` table, the stored objects, the phone's SQLite rows and its SecureStore for message
bodies, file names, file keys, invite tokens, access codes, nickname and the MLS signing key, as text,
hex and base64url. Full design: `docs/mobile/test-plan.md` §2.

Findings for Phase 1 (not defects in v1 web behaviour): the room owner never announces a nickname,
so members see `null` for the owner; `sync().newMessages` counts screenshot alerts.

## 4. Device spike (core-crypto, C2): prepared, not run

What is ready:

- `apps/mobile/app/spike.tsx` (reachable from the dev home screen and `onepeek://spike`): checks the
  WebCrypto surface, runs ts-mls create/add/join, encrypts and decrypts 200 messages each way with
  timings, saves and reloads group state, rotates, round-trips the real SecureStore + SQLite keystore
  including a 400 KB value and a wipe, and times AES-GCM on 5 MB. Results are copyable.
- `installRnCrypto()` runs at app start and fails loudly if any primitive is missing: no JS fallback
  exists anywhere.
- Static check: `react-native-quick-crypto` 1.1.9 implements `subtle` AES-GCM, HKDF, SHA-256,
  Ed25519 and X25519, which is everything `ts-mls` → `@hpke/core` calls.
- Metro bundles the full app for Android and iOS to Hermes bytecode (Section 2).

What only a device can prove (from the security reviews): quick-crypto `importKey` non-extractable
semantics and that it copies the key bytes; expo-sqlite BLOB round trip; SecureStore null-vs-throw
behaviour and the sync `getItem`/`setItem` calls; `atob`/`btoa`/`TextEncoder` on Hermes; RN Blob and
FileReader paths with the pinned supabase-js; performance on a budget Android phone.

To run it, the human provides (checklist Part A): an Expo account and `eas init`; for iOS, the Apple
Developer Program and a registered test iPhone. Android needs nothing beyond the Expo account.
Then: `eas build --profile development --platform android` (and `ios`), install, open the spike,
copy the numbers into this document.

Fallback if the spike fails (unchanged from the plan): a native MLS module behind the same
`mls.ts` interface, 3 to 4 weeks; the lead stops and asks first.

## 5. Security review (S0)

- `docs/mobile/security-review/mobile-core-crypto-extract-core.md`: the extraction. Verdict: no high
  or critical; 2 medium (shared wrapping-key cache, keystore required on the platform), 4 low. All fixed.
- `docs/mobile/security-review/mobile-core-crypto-rn-adapters.md`: the RN adapters. Verdict: no high
  or critical; 3 medium (SecureStore `null` must not re-provision a key over existing rows; site and
  API URLs must be validated `https://onepeek.io` literals; panic lock fails closed and persists
  synchronously, flag this-device-only), 6 low. All fixed in commit `1b021e1` with a test per finding
  and a regression proof (the old sources fail 35 tests).
- Verification of those fixes by the reviewer: `docs/mobile/security-review/mobile-core-crypto-review-fixes-2.md`
  verdict: **S0 closed, no open high or critical findings.** One medium (N1, the spike screen wiped the shared wrapping-key entry) fixed in the same commit; three lows (N2 stale wipe marker, N3 lock `reload()` on foreground, N4 docs) carried into Phase 1.

## 6. Setup delivered by the lead

npm workspaces (`packages/*`, `apps/*`) with root scripts fanning out; ESLint 9 flat config and
Prettier (web passes with warnings only, core and mobile with `no-console` as an error); Expo SDK 58
app with Expo Router, strict TypeScript, `app.config.ts` (`io.onepeek.app`, `onepeek://`, Universal
Links and App Links for `/s/*` and `/chat/join`, `allowBackup=false`, encryption flag, site URL as a
literal), Metro monorepo config with stubs for the unused ts-mls ciphersuites, GitHub Actions CI
(typecheck, lint, test, web build, tracked-secret check). Decisions and their reasons are in
`docs/mobile/log.md`.

## 7. Open issues and risks carried into Phase 1

1. Device spike not run (Section 4). Phase 1 UI work can start on simulators once accounts exist; it
   cannot ship without the spike numbers.
2. No staging Supabase project. Automated tests stay on PGlite; manual device checks use throwaway
   rooms on production. Phase 1's migration `008` must not be applied by an agent; a staging project
   is recommended before it (plan §8 Q1).
3. React 18 (web) and React 19 (app) share one hoisted tree via `legacy-peer-deps` and a Metro
   resolver override; expo-doctor flags both. Peers of native modules must be added explicitly
   (`react-native-nitro-modules` was the first).
4. The lead's `app/spike.tsx` lives in mobile-ui's path and is deleted after the spike runs.
5. Disk on this Mac is tight (about 2 GB free after cleanup); agent worktrees share one
   `node_modules` by symlink.

## 8. What the human decides now

- Approve Phase 0 with the device spike deferred, or hold the gate until it runs.
- Create the Part A accounts (Expo, and Apple if iOS is in the spike) and tell the lead.
- Open the Phase 0 pull request `mobile/integration` → `main` from this branch (no `gh` here), or let
  the lead push the branch and give the compare link.
