# OnePeek mobile (Expo)

Chat-first iOS and Android client for onepeek.io Secret Chat. See `docs/mobile/plan.md` at the
repo root for the build plan, ownership and rules. Native behaviour lives in `app.config.ts` and
config plugins only; `ios/` and `android/` are generated.

- `app/`: Expo Router screens (mobile-ui)
- `components/`, `theme/`: UI primitives and tokens (mobile-ui)
- `modules/`, `security/`: native protections and secure storage (native-security)
- `e2e/`: Maestro flows (qa)
- `store/`, `eas.json`: release material (release)

Commands: `npm run typecheck`, `npm run lint`, `npm test` from the repo root run every workspace.
