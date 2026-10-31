# OnePeek mobile: running log

Newest first. One line per decision, blocker or agent report.

## 2026-10-31

- Lead: cloned `grokpass` to `~/grokpass` (no local checkout existed). Baseline on `main` `47f46ee`:
  typecheck clean, 58/58 tests green. No ESLint, no CI, no `gh`, Node only at `~/Sites/newspop/.node/bin`.
- Lead: copied the 13 design PNGs into `docs/mobile/design/`.
- Lead: read `lib/crypto.ts`, `lib/chat/{mls,client,keystore}.ts`, migrations 006/007, `lib/alerts.ts`,
  `app/api/chat/notify/route.ts`, the integration test, the Secret Chat docs. Notes in `plan.md` §0.
- Lead: found that `ts-mls` → `@hpke/core` needs `crypto.subtle` for AES-GCM, HKDF, SHA-256 and
  Ed25519 (X25519 is pure JS). This is the Phase 0 spike (task C2).
- Lead: wrote `plan.md` and the seven agent files in `.claude/agents/`. Branch `mobile/phase-0-plan`.
- **Blocked on human:** approval of the plan and the open questions in `plan.md` §8 (staging,
  accounts, lint scope, Node, `gh`, bundle ids). No agent launched yet.
- Lead (Phase 0 started, human approved): `mobile/integration` created. L1 npm workspaces (`packages/*`, `apps/*`),
  root scripts fan out with `--workspaces --if-present`. L2 ESLint 9 flat config + Prettier; web code passes with
  0 errors / 60 warnings (grandfathered). `@next/eslint-plugin-next@15` is used only for its rules because the
  v14 plugin crashes on ESLint 9. L3 `apps/mobile` on Expo SDK 58 (RN 0.88, React 19.3), Expo Router, strict TS,
  `app.config.ts` with `io.onepeek.app`, scheme `onepeek`, Universal Links / App Links intent filters,
  `allowBackup=false`, `ITSAppUsesNonExemptEncryption=true`, native deps installed (secure-store, sqlite,
  quick-crypto, notifications, local-authentication, screen-capture, camera, pickers, sharing, apple-auth).
- Lead: monorepo React split. The web (Next 14) needs React 18, the app React 19, so `.npmrc` sets
  `legacy-peer-deps=true` and `apps/mobile/metro.config.js` resolves from the app's node_modules first with
  `disableHierarchicalLookup=true`. expo-doctor reports those two as warnings; the device build at Gate 0 is
  the real check.
- Lead: **no Xcode, Android Studio, Java or emulator on this Mac** (only CommandLineTools). Device and
  simulator builds must go through EAS Build in the cloud, which needs the human's Expo account, and the
  Apple Developer Program for the iPhone build. C2 (device spike) is blocked on that; everything else proceeds.
- Lead: assumed answers to plan §8 (human said "approved" without picking): Q1 (b) production with throwaway
  rooms for Phase 0; Q3 yes; Q4 newspop Node; Q5 PRs via web UI; Q6 `io.onepeek.app`.
- Lead: L4 GitHub Actions `ci.yml` (typecheck, lint, test, web build, tracked-secret check) on PRs and
  pushes to `main` and `mobile/integration`.
- Lead: static check of `react-native-quick-crypto` 1.1.9: its `subtle` implements AES-GCM, HKDF, SHA-256,
  Ed25519 and X25519, i.e. everything `ts-mls` → `@hpke/core` calls. The spike risk drops to "works on
  Hermes at acceptable speed", which only a device build can answer.
- Lead: launched `core-crypto` (C1), `qa` (Q2) and `release` (R0) in parallel, each in its own worktree with
  node_modules symlinked to the main checkout (disk is at 6.6 GB free; a second install would not fit twice).
- qa (Q2) done: `docs/mobile/test-plan.md` v1 (572 lines), merged. Lead's answers to its open questions:
  (1) push payload: the web already sends `url:/chat/r/<room>` and `tag:chat-<room>`; the native payload may
  carry the room id as an opaque routing key (no content, sender or room name), so `ROOM_IN_PAYLOAD=true`.
  (2) FLAG_SECURE also covers the Chats list: yes (N1 scope). (3) Q1 may extract the harness into
  `supabase/tests/harness.ts` as long as the web test's assertions are untouched. (4) owner nickname: core-crypto
  to confirm in C1 review. (5) no simulators on this Mac: Maestro runs on a GitHub `macos` runner or Maestro
  Cloud; decision deferred to Phase 1, flows get written regardless. (6) use `better-sqlite3`-free approach:
  Node 22.22 here supports `node:sqlite`; CI pins Node 22 (setup-node `22` resolves ≥22.13). (7) noted.
- release (R0) done: `docs/mobile/release/accounts-checklist.md`, merged. Costs: Apple $99/yr before Gate 1,
  Google Play $25 before beta; Android spike APK is free on EAS; iOS on a real phone has no free path.
  Lead decisions on its questions: (1) push model stays as planned: the server (`lib/alerts.ts`) sends
  directly to APNs and FCM v1, so the `.p8` and the FCM service account live in Vercel env only; the app
  registers raw device tokens via expo-notifications (`getDevicePushTokenAsync`), not Expo push tokens.
  (2) backend confirms the `APNS_*` / `FCM_SERVICE_ACCOUNT_JSON` names in B2. (4) `google-services.json`,
  `GoogleService-Info.plist` and `.env` added to `apps/mobile/.gitignore`; `googleServicesFile` wiring and
  `eas.json` profiles are R1 (Phase 1).
- core-crypto (C1) reported: `packages/core` extracted on `mobile/core-crypto/extract-core` (2 commits), web
  `lib/*` are thin shims, all 4 checks pass (root 58/58, core 19/19, lint 0 errors, next build OK), existing
  tests byte-identical. Lead reviewed the whitespace-insensitive diff of client.ts: mechanical. Sent to
  `security-reviewer` (S0a) before merge. Decisions on its questions: (1) Blob handling resolved in C3 (RN
  adapters, launched from the C1 branch); (2) `env.notify(roomId, token)` shape accepted; (3) `.gitignore`
  now ignores a bare `node_modules` symlink; (4) passkey calls stay required on the port; RN stubs them.
  Deviations accepted: nullable `supabase` on the platform, generic session type, no `open()` on KeyStore.
- core-crypto (C3 + C1 review fixes, branch `mobile/core-crypto/rn-adapters`): RN adapters in
  `packages/core/src/adapters/rn/` (SecureStore + SQLite keystore with the web's sealing format, quick-crypto
  `installRnCrypto()`, `createRnPlatform` with env/lock/fileSource and a Supabase wrapper), exported from
  `packages/core/src/rn.ts` only. Attachment bytes now cross the storage port as `Uint8Array`; the web adapter
  wraps them in the same `Blob` as before (RN's Blob cannot be built from typed arrays). Review fixes M1 (shared
  wrapping-key cache + re-read on decrypt failure, web and RN), M2 (keystore required), L1 (restricted globals
  for `src/chat/**`, `src/crypto.ts`, `src/adapters/rn/**`), L4 (`ts-mls` declared), L2/L3 (origin/notify tests).
  Root 58/58, core 50/50, web build green. Not run on a device: quick-crypto on Hermes and RN Blob/FileReader
  behaviour remain C2's proof.
- security-reviewer (S0b) on C3: no high/critical; 3 medium (M1 SecureStore `null` must not re-provision the
  wrapping key while sealed rows exist; M2 siteUrl/apiBaseUrl must be validated https onepeek.io literals, not
  env; M3 panic lock must fail closed and persist synchronously, flag THIS_DEVICE_ONLY) and 6 low. Merged
  C3 + review into `mobile/integration`; fixes go on `mobile/core-crypto/review-fixes-2` before any screen
  uses the adapters. Root 58/58, core 50/50 after merge.
