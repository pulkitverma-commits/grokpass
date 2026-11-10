# Send Securely (TopShelf × OnePeek)

TopShelf's **Send Securely** lets a Mac user share files, text, screenshots and clipboard
content through OnePeek without leaving TopShelf. TopShelf encrypts on the Mac; OnePeek stores
and delivers only ciphertext through an authenticated app API; recipients open the existing
OnePeek viewer at `https://onepeek.io/s/<id>#<key>`.

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, data flow, database objects, what each side stores |
| [SECURITY.md](SECURITY.md) | Encryption design, what OnePeek can and cannot decrypt, threat model, limits |
| [API.md](API.md) | `/api/v1` reference (installs, uploads, shares, revoke, passphrase unlock) |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Environment variables, migration order, rollback, production checklist |
| [VERIFICATION.md](VERIFICATION.md) | What was tested, how, and what is still unverified |

Code:

* OnePeek (this repo): `supabase/migrations/011_app_api.sql` (+ `_down`), `lib/appapi.ts`,
  `app/api/v1/**`, passphrase support in `app/s/[id]/page.tsx` and `packages/core/src/crypto.ts`,
  tests in `supabase/tests/app-api.test.ts`, `packages/core/src/passphrase.test.ts`,
  `tests/integration/send-securely.e2e.ts`.
* TopShelf (`yuzu-store/Notch`): `Sources/NotchCore/SendSecurely/*`,
  `Sources/NotchApp/Modules/SendSecurely/*`, `Sources/NotchApp/Settings/SendSecurelySettingsView.swift`,
  tests in `Tests/NotchCoreTests/SendSecurelyTests.swift`.
