# OnePeek mobile: running log

Newest first. One line per decision, blocker or agent report.

## 2026-11-01

- qa (Q5 + W3-3) merged: `packages/core/test/secrets.interop.test.ts` (17 scenarios on PGlite with migrations 002–009:
  web path, app → web and web → app text/Wi-Fi/file, multi-view, expiry, wrong key, `/api/open` modelled from
  `route.ts` with a source-contract test; sweep of key/body/file name/password in four encodings), sink lint extended
  (Sharing, Notifications content, MediaLibrary, file writes, `Paths.document`, remote `Image` sources), flows 12–16
  (secret link in app / from browser, share from Photos / Files, QR kinds), TESTIDS "Phase 2 proposed" (59 ids), test
  plan v1.3 with a Gate 2 map (§9) and device checks P1–P10. Core 322. Decisions: `/api/open` handler stays modelled
  (no `@` alias in the core vitest config); the Gate 2 criteria are reconstructed in `gates/phase-2.md` because the
  build prompt file is no longer on this Mac (human confirms them at the gate).
- Lead: installed `expo-share-intent@9.0.0` (peers satisfied: expo ^58, expo-linking, expo-constants); native-security
  wires its iOS hook into `security/shareIntent.ts` next. Disk dropped to 0.4 GB during the Phase 2 runs (jest and
  Metro caches); cleared tooling caches only, 1.1 GB free. All Phase 2 branches merged: web 142, core 322, mobile 376.
- mobile-ui (U8 + carry-overs) merged: one-time secret composer (07: text / Wi-Fi / photo / file, views, expiry, viewer
  timer, hold-to-view, copy/save flags; "in this chat" vs onepeek.io link with masked result, QR, copy, share, send
  link in chat), secret viewer `app/s/[id]` (peek states, lock-email unlock, hold-to-view with watermark, timer,
  content cleared on background/blur/unmount, geofenced links handed to the browser), share target `app/share`,
  QR scanner `app/scan` (invite / secret / safety number / foreign), block member (local to the phone), report chat
  (ids only). Carry-overs: PushRefresher re-registers after sign-in; root layout drives `auth.setForeground`. Secret
  links never travel as route params (one-shot in-memory hand-off). Mobile 376 tests; iOS bundle 2601 modules.
  Design 07's passcode option and camera capture are not built (no contract / Phase 3). New testIDs go to qa.
- native-security (N6) merged: Android share receive (intent filters + local Kotlin module `modules/share-intent`
  copying shared items into `<cache>/share-intent/`, consumed once, swept), `useShareIntent()` routing to `/share`
  (lead wired `ShareIntentBridge` in the root layout), strict `parseOnePeekLink` (secret / invite / verify / auth),
  `forgetLinkingURL()` so the fragment leaves the native initial-URL cache after the key is imported, App Group reader
  for iOS, `withShareExtension` plugin: App Group entitlement always on, the hand-rolled Share Extension target
  **experimental and off** (`ONEPEEK_SHARE_EXTENSION=1`). Fragment audit in README N6c: expo-router never puts the
  hash into navigation state. Recommendation accepted: install `expo-share-intent@9.0.0` for iOS once the running
  agents finish (shared node_modules), keep the plugin's extension half off. Mobile 327 tests. Native code compiles
  only on EAS (MANUAL-CHECKS S21–S27).
- backend (B5) merged: migration `009_chat_reports` (+down; table service-role only, no policies), RPC `report_chat`
  (member check via 006's `chat_is_member`, reason enum, 20/day cap, upsert per room+reporter), route
  `POST /api/chat/report` with the caller's bearer (anon key + session; exactly `{ p_room, p_reason }` forwarded).
  13 PGlite + 6 route tests; web 142. Not applied anywhere.
- core-crypto (C4) merged: `packages/core/src/secrets.ts` (create/peek/open/unlock, byte-for-byte the web's header,
  ciphertext, `create_secret` args incl. the offset-timezone retry, `/api/open` body and error codes; file ciphertext in
  the `secrets` bucket as on the web), `src/time.ts` moved from `lib/time.ts` (web re-exports, zero behaviour change),
  `apps/mobile/lib/secrets.ts` implemented with a widened contract (wifi input, unlock-code helpers, `SecretError`,
  superset peek/open types), client id for the free quota in SecureStore (not wiped by reset: quota identity, lead
  decision), `auth.setForeground()` for Supabase token refresh. Core 275, mobile 230. Geofenced links stay
  website-only in the app (no expo-location); told mobile-ui and qa.
- **Human approved Gate 1 with device verification deferred** (2026-11-01). Phase 2 starts: C4 secrets in core,
  U8 (send-as-secret sheet, share target, QR scanner, block member, report chat), N6 (share extension / share intent,
  FLAG_SECURE on the secret viewer, Universal Links with the fragment on device), B5 (report endpoint, ids only), Q5
  (cross-platform secret tests). Carry-overs assigned: W2-8 re-register after sign-in (mobile-ui), W3-3 sink lint (qa),
  Supabase AppState token refresh (core-crypto). Contract fixed by the lead: `apps/mobile/lib/secrets.ts`
  (`createSecretLink`, `peekSecretLink`, `openSecretLink`) implemented by core-crypto on top of
  `packages/core/src/secrets.ts`; the web's `create_secret` RPC, `/api/open` route and `/s/<id>#<key>` format are
  the spec; nothing new on the server for secrets.
- W3 fixes merged (W3-1 hidden Secret parent never quoted in a sent bubble; W3-2 the invite link unmasks only when
  `extra.e2e` is true, which only the `e2e` EAS profile sets; W3-4 `treeText()` deny-list; W3-5 no backend call between
  `verifyOtp` and the login-CSRF sign-out). Totals: web 123, core 194, mobile 203; 17 flows clean. **Gate 1 reached:**
  `docs/mobile/gates/phase-1.md` written. Stopping for human approval; nothing pushed (PAT lacks `workflow`), nothing
  applied to production, no accounts created.
- security-reviewer close-out `phase-1-close-out.md`: no open high or critical; W2-1/2/3/5/7/8/10, W1-10 and the backend
  test gaps closed with tests; W2-4 closed by decision; W2-6 partial (guard relies on an EAS-only variable). **New
  medium W3-1:** a sent reply quotes the hidden Secret parent's text in the sender's bubble (same on the web). Lows
  W3-2 (E2E guard should fail closed on the `e2e` profile only), W3-3 (sink lint blind spots: Sharing, Notifications,
  MediaLibrary; name-based), W3-4 (`treeText()` allow-list), W3-5 (core-side W2-9 test). Dispatched W3-1, W3-2 (fail
  closed via `extra.e2e`), W3-4, W3-5 to one fix branch; W3-3 to qa in Phase 2. Consolidated open lows are listed in
  the report; the web parity items (reply preview and parent quote) go to the human as a web change.

## 2026-10-31

- Wave 2 review fixes merged: backend W2-5 (`push_devices` grants select/delete only) and the four §1.5 test gaps
  (push-devices 17 tests, alerts.native 37: fixture sweep over every request, credentials never in errors); mobile-ui
  W2-1 (Secret reply preview content-free, cleared on screenshot/inactive), W2-2/W2-3 (picker copies deleted after
  send/cancel/oversize, caches swept on launch and reset), W2-4 (EXIF sentence; `expo-image-manipulator` deferred to
  Phase 3), W2-7 (Secret composer: no autocorrect/spellcheck/autofill), W2-8 (`PushRefresher` re-registers at start and
  on rotation, never prompts), W2-9 (AuthGate invariant + test), W2-10 (copy). Decisions: Secret reply dropped on every
  inactive (safer default); re-register after sign-in added in Phase 2 (W2-8 follow-up). Web parity note for the
  human: the website's reply preview (`app/chat/r/[id]/page.tsx`) shows Secret text the same way (W2-1); a one-line
  web fix with a web test is recommended but outside the mobile scope. Totals: web 123, core 194, mobile 193; iOS
  bundle 2577 modules. Final verification review running.
- qa wave 2 merged: W1-10 closed (expo-insights/expo-updates imports; off-device sinks Clipboard/Share/Linking/
  WebBrowser/Alert/WebSocket/XHR flagged with secret-named arguments; `redact` arrays), TESTIDS reconciled to the code
  (168 ids), flows 03–09 on real ids, new 10 (notifications) and 11 (safety number), test plan v1.2 (§1.5 review of the
  backend tests: four additive gaps d, f, 1+2, 8; §4.1 device checks S1–S20 with owners; §8 Gate 1 map updated). Core
  194. Lead added the `e2e` EAS profile (simulator, `EXPO_PUBLIC_E2E=1`, internal only; the config guard refuses the
  flag on preview/production) and dispatched the four backend test gaps.
- security-reviewer (S1, second pass) `phase-1-wave-2.md`: **no high or critical**; W1-1..W1-7 and W1-9 closed with tests,
  W1-8 closed by decision, W1-10 with qa. Wave 2: mediums W2-1 (reply preview shows Secret text unheld) and W2-2
  (picker cache copies never deleted), lows W2-3..W2-10. Dispatched: mobile-ui (W2-1, W2-2, W2-3, W2-4 honest sentence
  instead of a re-encode library, W2-7 composer keyboard flags, W2-8 push re-registration, W2-9 AuthGate invariant +
  test, W2-10 copy), backend (W2-5 table grants select/delete only). Lead: W2-6 `app.config.ts` throws when
  `EXPO_PUBLIC_E2E=1` meets the preview or production EAS profile.
- mobile-ui wave 2 (U3, U5, U7) merged: Locked screen as the provider cover (biometric wording, insecure-phone warning,
  Panic state), Conversation (sync/subscribe/poll, owner auto-admit like the web, hold-to-read with text absent from the
  tree until held, `markOpened` once, timers, replies, files via a viewer with cache temp files deleted on close,
  view-once, watermark while held, screenshot notices, waiting/ended states), room menu (timer, invites with revoke,
  safety number + QR + verify, members with let-in/remove, rename, Panic, leave, burn), Settings (lock state, Lock now,
  single-tap Panic Exit, Notifications via `push.register/unregister`, devices, honest protection copy, sign out, reset).
  `auth` screen copy explains device-bound links. 129 → mobile 172 tests in total; iOS bundle 2576 modules. Decisions:
  single-tap Panic everywhere; watermark only while held; web screenshot-notice wording; SVG gradient. New testIDs from
  its report go to qa for `TESTIDS.md`. Carried: AppState-driven Supabase `startAutoRefresh/stopAutoRefresh` helper
  (core-crypto + layout); `expo-notifications` config plugin / `aps-environment` entitlement check (lead, before the
  first push test). Still unverified on device: gestures, keyboard, pickers, sharing, push token, realtime.
- Wave 1 review fixes merged: core-crypto (W1-1 email link bound to the address requested on this phone within 1 h,
  session email compared after `verifyOtp`, local sign-out on mismatch; W1-2 `push.register/unregister/current` with the
  token sealed and unregistered before sign-out/reset; W1-6 Supabase URL must be `https://<ref>.supabase.co`), backend
  (W1-2 `unique (token)` with owner takeover; W1-3 token shape `[A-Za-z0-9:_-]{32..512}`, 10 rows per owner, reads and
  sends capped/chunked at 10; W1-5 http2 idle/deadline timeouts; `search_path = ''`), native-security (W1-4 no
  `allowScreenCaptureAsync` anywhere, app key re-asserted on every foreground; W1-7 unlock generation counter).
  Web 108, core 162, mobile 145 (before wave 2). Open from the review: W1-10 (qa, next pass). Accepted trade-off:
  the pending email lives in module memory, so a link tapped after the app was killed asks for a new link.
- security-reviewer (S1, wave 1) `phase-1-wave-1.md`: **one high** W1-1 (a `token_hash` email link is a bearer, so a
  crafted `onepeek://auth` link signs the phone into an attacker's account, after which `sync()` forgets the victim's
  rooms); mediums W1-2 (push token outlives the account on a shared phone; unique(owner, token)), W1-3 (no per-owner
  cap, unbounded fan-out), W1-4 (`allowScreenCaptureAsync` on unmount can clear FLAG_SECURE for the process); lows
  W1-5..W1-10. S0a/S0b held; N1, N2, N4 closed. Fixes dispatched in parallel: core-crypto (W1-1 device-bound email
  link, W1-2 `push` helper + unregister on sign-out/reset, W1-6 supabase URL check), backend (W1-2 unique(token),
  W1-3 cap 10/owner + token charset + chunked sends, W1-5 http2 deadline), native-security (W1-4 never allow, re-assert
  on active; W1-7 unlock generation counter). Lead: W1-8 spike route needs a session (deleted after the spike runs);
  W1-9 masked invite link stays (full link only under `EXPO_PUBLIC_E2E=1`, told mobile-ui); W1-10 to qa in wave 2.
  No tester build before W1-1 lands; 008 not to be applied before W1-2/W1-3 land.
- native-security (N1–N5) merged: `withSecureWindow` plugin (FLAG_SECURE in MainActivity, app-wide) + `useSecureScreen`;
  `withBackupRules` plugin (full-backup-content and data-extraction-rules excluding every domain; expo-secure-store's own
  backup config disabled); local Expo module `modules/screen-state` (iOS `UIScreen.isCaptured` + change events,
  `isExcludedFromBackup` for the SQLite directory; Android stubs); `SecurityProvider` (locked on cold start, 60 s
  auto-lock, Panic Exit → lock store + `chat.lock()`, lock-store reload on foreground, cover while inactive/captured,
  children unmounted while locked), `useScreenshotAlert` → core only, `Watermark` with the web wording, README and
  MANUAL-CHECKS S1–S20. 33 jest tests. Lead wired the provider into `app/_layout.tsx` with a provisional
  "Unlock OnePeek" cover until U3. Decisions on its questions: `reload()` stays optional-sync; `CHAT_DB_NAME` copy
  with the equality test is fine; iOS best-effort `preventScreenCaptureAsync` stays on (no copy relies on it);
  screenshot notice wording stays the web's for now (mobile-ui may propose phone wording in U5); app-wide FLAG_SECURE
  plus explicit hooks on chat/secret screens is the intent. Only a device build can prove the native parts
  (MANUAL-CHECKS). Wave 1 complete: web 96, core 162, mobile 102 tests; Android bundle 2461 modules.
- qa (Q3, Q4) merged: leak-guard lint rules in both configs (telemetry calls and imports, ad-hoc loggers, stringify of
  secret-named identifiers into sinks, literal `fetch` hosts outside onepeek.io/supabase.co) with 53 ESLint-API probe
  tests + static `console.` sweep; `packages/core/src/log.ts` (`log` no-op, `redact`) now exported from the package
  root; 14 Maestro flows (9 journeys, two-device ones via a local relay, no screenshots ever), `TESTIDS.md` as the
  single source of truth, `check-flows.mjs`; test plan v1.1 with the Gate 1 criteria map (§8). Core 101 → 162.
  Decisions: the 13 proposed testIDs are accepted (mobile-ui wave 2 uses them; `invite.link` renders the full link,
  `locked.screen` is the only container while locked); strict `console.` grep stays; E2E runner recommendation is
  GitHub Actions (`macos-15` + `ubuntu` KVM), Maestro Cloud only for the `single` set, final call and the
  `MAESTRO_EMAIL` inbox are the human's (cost); the first two-device run happens once a dev build exists.
- core-crypto Phase 1 merged: `createRoom({ nickname })` announces the owner's nick (and re-announces after each
  admit, since joiners cannot read rows before their Welcome); `SyncResult.newAlerts` (web room page refreshes on
  alerts too, web integration test asserts the split); N2 stale `wiping` marker cleared; `createRnAuthStorage`
  (session sealed in its own `onepeek-auth.db` / `onepeek.wrap.auth`, self-wipes when `keystore_unavailable`);
  `registerPushDevice`/`unregisterPushDevice`; `apps/mobile/lib/chat.ts` implemented (PKCE/`token_hash` only,
  implicit-flow fragments refused, `onepeek://auth` only, local sign-out, generic device label); known-limitations
  item 9 (`expires_at` outside the AAD). Core 87 → 101, mobile jest 70. Jest now maps `@onepeek/core` by path and
  transforms ts-mls/@hpke/@noble; lead added a 20 s test timeout after a one-off cold-cache timeout. Carried to
  wave 2 (mobile-ui/native-security, root layout): AppState-driven `startAutoRefresh`/`stopAutoRefresh` for the
  Supabase session. **Human (Gate 1):** add `onepeek://auth` to Supabase Auth redirect URLs; enable Apple and Google
  providers.
- mobile-ui wave 1 (U1, U2, U4, U6) merged: theme tokens + primitives, Welcome, Sign in (Apple with hashed nonce,
  Google via system browser + PKCE, email link, guest), `auth` callback (URL never rendered or logged), Chats home
  (rooms, search, pending "Let in", refresh on focus/foreground), New chat → invite sheet (QR, masked link, copy,
  share), Join (paste or `/chat/join#token` deep link, token read from the fragment only), Settings, reset screen for
  `keystore_unavailable`. 43 jest tests; `expo export` 2401 modules. Lead applied its Metro patch (watch realpaths
  behind symlinked node_modules; resolve `@onepeek/core` to this tree) so worktrees can export. Decisions on its
  questions: passkeys stay hidden for Gate 1 (no `signin.passkey` id; the human confirms at the gate); the room
  screen (U5) auto-admits like the web, the home "Let in" row stays as the explicit path; the iOS chats footer
  ("flagged to everyone") stays, it matches what native-security builds. Honest-copy deviations from the PNGs are
  listed in its report and accepted. Not verified on device: fonts, keyboard avoidance, sheet gestures, native
  sign-in flows, fragment routing through expo-router on cold start.
- backend (B1–B4) merged: migration `008_mobile_push_tokens` (+down) with `push_devices`, owner-only RLS, RPCs
  `register_push_device`/`unregister_push_device` (guests may register, like `chat_register_device` in 006);
  APNs (HTTP/2, ES256 token auth) and FCM v1 senders in `lib/alerts.ts` with injectable transports; payload builders
  take only a UUID room id; dead tokens deleted; `/api/chat/notify` fans out to native alongside web push (web payload
  proven byte-identical); `/.well-known/apple-app-site-association` and `assetlinks.json` handlers from env (404 when
  unset). Root tests 58 → 96, `next build` compiles both handlers. Lead set the native body to the web's wording
  ("You have a new message in a private chat.") so qa's assertions match. **Human:** apply 008 (rehearse on a
  throwaway project first), set the Vercel env vars listed in `docs/secret-chat/deployment.md` §5, never by an agent.
- release (R1) merged: `eas.json` (development / development-simulator / preview / production, `appVersionSource`
  remote, EAS `environment` per profile, Android APK for dev and preview), OnePeek icon set and splash derived from
  `public/icon-512.png`, `docs/mobile/release/versioning.md`, `fcm-client-config.md`, checklist section A6 (EAS vars,
  spike commands, Vercel vars). Lead applied the proposed `app.config.ts` lines (`googleServicesFile` from
  `GOOGLE_SERVICES_JSON`, splash `imageWidth` 160) and removed the template tab icons. Decisions on its questions:
  `expo-updates` is not enabled in Phase 1 (every change is a store build; OTA policy in versioning.md applies once
  it is added, no earlier than Phase 3); EAS CLI floor `>= 16` and EAS's default Node accepted.
- Lead (Phase 1 started): pre-installed the shared app packages (fonts, SVG/QR, auth session, web browser,
  haptics, blur, crypto, dev client, jest-expo stack) so no agent runs npm in the shared `node_modules`; set up
  jest-expo + `@testing-library/react-native` for `apps/mobile` with the React 19 copy pinned (`jest.config.js`
  adds both node_modules trees to the resolution path because react-native lives under `apps/mobile/node_modules`).
- Lead: contracts fixed before launch. (a) `apps/mobile/lib/chat.ts` placeholder (`getChat()`, `getLockStore()`,
  `auth.*`, `AUTH_REDIRECT_URL = onepeek://auth`, `resetThisPhone()`); core-crypto implements it, everyone else
  imports it. (b) Security module API (`SecurityProvider`, `useSecurity`, `useSecureScreen`, `useScreenshotAlert`,
  `Watermark`, `LockCover`) owned by native-security, consumed by mobile-ui in wave 2. (c) Migration 008 RPCs
  `register_push_device(p_platform, p_token)` / `unregister_push_device(p_token)` written by backend, called by the
  core's new `registerPushDevice`/`unregisterPushDevice`. (d) Native push payload: fixed strings + opaque room id
  only. (e) testID list in `apps/mobile/e2e/TESTIDS.md` shared by mobile-ui and qa. Supabase session is stored
  sealed through the RN keystore (no AsyncStorage). Passkeys are not in the v1 app sign-in (no native library
  evaluated yet); Apple, Google (system browser, PKCE), email link and guest are. Human items queued for Gate 1:
  add `onepeek://auth` to Supabase redirect URLs, enable Apple/Google providers.
- Lead: wave 1 launched in six worktrees: core-crypto `mobile/core-crypto/phase1-core` (nick on create, newAlerts,
  N2, sealed auth storage, push registration, app glue, doc notes), mobile-ui `mobile/mobile-ui/foundation`
  (U1, U2, U4, U6, reset screen), native-security `mobile/native-security/protections` (N1–N5, lock reload),
  backend `mobile/backend/push-and-links` (B1–B4), release `mobile/release/eas-and-assets` (R1), qa
  `mobile/qa/phase1-tests` (Q4 leak guard, Q3 Maestro flows, test-plan Gate 1 mapping). Wave 2: U3, U5, U7,
  security-reviewer S1 on every branch, qa review of new tests.
- **Human approved Gate 0 with the device spike deferred** (2026-10-31). Phase 1 starts on `mobile/integration`.
  The spike (C2) runs as soon as the Expo account (and Apple Developer Program for iOS) exist; `app/spike.tsx`
  stays until then. Push of `mobile/integration` and the Phase 0 PR remain with the human (PAT lacks `workflow`).
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
- Lead: `apps/mobile` now depends on `@onepeek/core`; root layout calls `installRnCrypto()` first; Metro stubs
  the five unused ts-mls ciphersuite packages (same list as `next.config.js`); `app/spike.tsx` is the Phase 0
  spike screen (lead-owned, deleted after Gate 0). `react-native-nitro-modules` (quick-crypto's peer) had to be
  added explicitly because `legacy-peer-deps` disables automatic peer installs.
- Lead: `expo export` for Android and iOS bundles the whole app through Metro (1567 modules) and compiles it to
  Hermes bytecode with no resolution errors. That proves the monorepo resolution, the core import and the
  ts-mls stubs; it does not prove quick-crypto at runtime (needs a device build, blocked on EAS/Apple accounts).
- qa (Q1) done, merged: `packages/core/test/interop.integration.test.ts` (20 tests, 28 planned assertions, roles
  swapped both ways, every scenario sweeps the SQL log, DB dump, stored objects, phone SQLite rows and SecureStore
  for bodies, file names, keys, tokens, codes, nick and MLS private key). Ran 5× with no flake. Core now 70/70,
  root 58/58. Findings for Phase 1: (a) the owner never sends a `nick` control message, so members see
  `null` for the owner (core-crypto, Phase 1: send nick on room creation); (b) `sync().newMessages` counts
  screenshot alerts (core exposes a separate `newAlerts` counter in Phase 1 so unread badges stay honest).
- core-crypto review fixes (S0b M1–M3, L1–L6) merged: core 67 → 87 with Q1; interop test isolated per phone
  (`wrapKeyId`). Full gate commands green on `024ffbd`. `security-reviewer` verifying the fixes (S0 close-out).
- Lead: `docs/mobile/gates/phase-0.md` written. **Gate 0 status: complete except the device spike, which is
  blocked on the Expo account (and Apple Developer Program for iOS).** Stopping for human approval.
- security-reviewer verified the S0b fixes: **S0 closed, no open high or critical.** N1 (medium, spike screen
  used the shared `onepeek.wrap` entry) fixed: spike uses `wrapKeyId: 'onepeek.wrap.spike'`. Carried into
  Phase 1: N2 clear the `wiping` marker in the no-rows branch (core-crypto), N3 lock `reload()` on AppState
  active (native-security N4), N4 docs: `keystore_unavailable` recovery UI ("Reset chats on this phone"),
  test-plan §1.3 siteUrl line, known-limitations note that expires_at is outside the AAD.
