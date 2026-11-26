# FoxStack secure sharing

FoxStack Android creates one-view OnePeek text links inside its chat composer. Employees use their existing verified FoxStack company sign-in. This is a scoped OnePeek creation identity; it does not issue a general OnePeek web/Supabase session, merge web accounts, expose account history, or grant upload/list/revoke capabilities.

## Trust and request flow

1. The app generates a fresh 32-byte random install proof, kept only in memory. It sends **SHA-256 of the proof string** to the authenticated FoxStack route `POST /api/mobile/v1/onepeek/session`.
2. FoxStack revalidates the existing mobile user, active staff profile and Auth-confirmed corporate email. The body cannot choose a user, address, issuer, audience or scope. A per-employee limiter allows 30 assertions/hour.
3. FoxStack returns a dedicated HS256 assertion with a 60-second lifetime, a random 32-byte `jti`, issuer `https://crm.foxnetglobal.com`, audience `onepeek:foxstack:shares`, scope `share:create`, verified employee subject/email/name, and `cnf.install_secret_sha256`. It contains no FoxStack, Google, or Supabase session token.
4. The native client posts the assertion and its proof to `POST https://onepeek.io/api/v1/foxstack/session`, using an independent HTTP client without FoxStack interceptors or redirect following.
5. OnePeek verifies the fixed algorithm/type/key ID, issuer, audience, scope, identity, timestamps and proof. The `foxstack_exchange_session` transaction consumes the nonce once and creates a ten-minute session. A stable provider install per employee preserves existing creation quotas and idempotency across sessions. Its general install secret is never issued.
6. The response includes `sessionId`, `expiresAt`, `scope` and the linked employee identity. Subsequent creation uses `Authorization: OnePeek-FoxStack <sessionId>.<proof>` at `POST /api/v1/foxstack/shares`. The credential is not accepted by the general install APIs.
7. Android encrypts text and header with independent random IVs using OnePeek's existing AES-256-GCM format (`12-byte IV || ciphertext || 16-byte tag`, base64url). The provider receives ciphertext and sharing limits. The app adds the 32-byte content key to the returned URL's fragment and puts the finished link in the chat draft. A separate Send action posts that link to the chosen FoxStack conversation.

The OnePeek provider never receives the content key or plaintext. FoxStack chat receives the complete link when the employee chooses Send, as it did for manually pasted OnePeek links; this change does not claim that ordinary FoxStack chat storage is end-to-end encrypted. Plaintext input, prepared encryption state and the scoped credential are memory-only. The secret dialog prevents screenshots, disables keyboard correction, and does not use the clipboard or offline outbox. Only the finished share link may enter the existing chat outbox.

## Required deployment configuration

This implementation was prepared against `pulkitverma-commits/grokpass` commit `3da3803613dfec929eb8d79758f8f01f2c2625e3` and FoxStack commit `cbd854e22802febcfb19f37b81d7466bf708f3b0`.

Both services require **`ONEPEEK_SSO_SHARED_SECRET`**, the same dedicated 32 random bytes encoded as 64 lowercase hexadecimal characters. It is server-only. Do not give it a `NEXT_PUBLIC_` prefix, put it in the APK, reuse another service key, or include its value in deployment logs or reports. Missing/invalid configuration fails closed with a temporary-unavailable response.

OnePeek also requires its existing `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and canonical `NEXT_PUBLIC_SITE_URL=https://onepeek.io` configuration. No new provider secrets are delivered to FoxStack clients.

Apply `supabase/migrations/20261125183016_foxstack_scoped_sso.sql` to the **OnePeek database** before deploying the new provider routes. The existing migrations through `011_app_api.sql` are prerequisites. No FoxStack schema migration is required. The public OnePeek page identifies Supabase project `xndotbjwzbkknewyuqvf`; independently confirm that project in the owning deployment before applying anything. It is distinct from FoxStack's database.

Deploy the provider routes and shared configuration before releasing the native flow. The FoxStack issuing route is additive and follows the existing versioned mobile API envelope. The new provider routes do not alter existing install credentials. The existing creation handler is shared without changing its validation or output contract.

Only the provider service role can access the new identity/session tables or RPCs. RLS is enabled and there are no browser grants. The new RPCs use `SECURITY INVOKER`. One narrow service-role grant permits the existing random-ID helper to be used from the invoker function. The service-role credential stays on OnePeek.

## Lifetime and revocation

Assertions expire after 60 seconds and cannot be replayed. Creation sessions last ten minutes and are checked against the provider database on every call. Expired sessions are retained for one day to keep nonce replay records beyond assertion validity, then removed during later exchanges. An app account change cancels in-flight work and prevents reuse of the previous employee's connection.

An employee disabled in FoxStack cannot obtain new assertions. An already issued OnePeek creation credential can remain valid for its remaining ten-minute lifetime. For immediate provider-side revocation, revoke the corresponding `app_installs` row reached through `foxstack_sso_identities.subject`; existing provider authentication then fails and a fresh exchange cannot reactivate it. Rotating the shared key invalidates outstanding assertions, while already issued scoped sessions keep their existing expiry.

## Verification

Run from the provider repository:

```sh
npx vitest run lib/foxstack-sso.test.ts app/api/v1/foxstack/routes.test.ts supabase/tests/foxstack-sso.test.ts supabase/tests/app-api.test.ts
npx tsc --noEmit
npx eslint lib/foxstack-sso.ts lib/app-share.ts app/api/v1/foxstack app/api/v1/shares/route.ts lib/foxstack-sso.test.ts supabase/tests/foxstack-sso.test.ts
```

The database suite applies the full existing schema history plus the new migration to PGlite. It verifies browser-role denial, invoker permissions, nonce replay rejection, credential expiry, cross-employee isolation, revocation, stable install identity/idempotency and inability to use the proof with the general install API. The database's unique nonce constraint and transaction lock enforce concurrent replay safety; PGlite itself exercises sequential semantics, not independent concurrent Postgres connections.

FoxStack adds route/signature tests and Kotlin JUnit tests for cross-runtime AES-GCM fixtures, URL validation, proof binding, idempotent retry, renewal, account switching, and cancellation during sign-out. The temporary local JVM run uses the repository's pinned Kotlin/dependency versions and actual repository/auth/network classes; it does not replace the Android Compose compilation and APK build gates.

For a configured staging deployment, verify the complete employee flow using synthetic text: open a conversation, choose Send Securely, confirm the linked identity, create a one-view link, check that it appears only in the draft, then explicitly send it. Open the link with OnePeek's existing viewer and check plaintext recovery, one-view exhaustion, and expiry. Do not test with real employee secrets or send messages to real recipients without authorization.

Local implementation and synthetic tests do not establish that the shared secret, provider migration or either deployment has been activated. Those are separate release steps.

## Candidate verification and existing CI failures

The 25 November 2026 candidate passes all-workspace `npm run typecheck`, lint for every changed TypeScript file, all 208 provider web tests (including the 49 focused SSO/creation regression tests), and all 460 existing mobile workspace tests. The core workspace passes 311 tests, while five existing integration suites fail during schema setup and skip their 76 cases with `function public.reap_expired_secrets() does not exist`. Those same five setup failures were reproduced in an unmodified checkout at the exact base commit above, using the same locked dependencies. The core chat harness loads migration `011_app_api.sql` without the earlier secret schema that defines that function; this change does not alter that harness or migration.

The baseline [CI job for `3da3803`](https://github.com/pulkitverma-commits/grokpass/actions/runs/43165851785/job/131007427259) passed typecheck but failed lint at unchanged `next.config.js:1:34` (`@typescript-eslint/no-require-imports`), reporting one error and 69 warnings. The candidate reproduces exactly that lint result with no diagnostics in changed files. Baseline tests and web build were skipped after lint failed. The overall repository checks are therefore still red for these separately identified baseline issues; a successful production build and configured end-to-end activation are not claimed.

The existing production deployment identifies Vercel team `framemagazine` / FRAME and project `grokpass`; the database reference is `xndotbjwzbkknewyuqvf`. Provider configuration and migration access must be made available through those owning accounts before activation. This draft contains no environment values or production database changes.
