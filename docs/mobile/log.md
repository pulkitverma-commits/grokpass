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
