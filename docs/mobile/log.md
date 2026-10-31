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
