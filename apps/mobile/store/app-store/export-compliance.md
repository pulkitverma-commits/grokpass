# Export compliance (encryption) answers for OnePeek 1.0

**DRAFT FOR A HUMAN ADVISER, NOT LEGAL ADVICE.** Every answer below is a draft written by the release agent
from the app's code and Apple's App Store Connect help as of 2026-11-01. U.S. export rules (EAR) change,
Apple reorders its questions, and the developer entity is outside the U.S.; a trade-compliance or legal
adviser must confirm each answer before anything is submitted or filed with BIS. Nothing here has been
reviewed by a lawyer.

## What the app actually does with encryption (facts the answers rest on)

| Fact | Source |
| --- | --- |
| `ITSAppUsesNonExemptEncryption` is **`true`** in `Info.plist` | `apps/mobile/app.config.ts` `ios.infoPlist`. Setting it true means App Store Connect asks the encryption questions (or uses the app-level answers) instead of skipping them. |
| Chat messages and files are end-to-end encrypted with **MLS (RFC 9420)** through the open-source TypeScript library **`ts-mls`**, which uses **HPKE (RFC 9180)** via `@hpke/core` and the **`@noble`** curves | `packages/core/src/chat/mls.ts`, `docs/secret-chat/known-limitations.md` 2 |
| Algorithms: **AES-128-GCM / AES-256-GCM**, **HKDF-SHA256**, **SHA-256**, **X25519** (key agreement), **Ed25519** (signatures); one-time links use **AES-256-GCM** with the key in the URL fragment | `lib/crypto.ts` / `packages/core/src/crypto.ts`, web `app/encryption/page.tsx` |
| On the phone, WebCrypto-equivalent primitives come from **`react-native-quick-crypto`**, which bundles **OpenSSL** as a native library (so the app *implements* encryption in addition to using iOS's own) | `apps/mobile/package.json`, `installRnCrypto()` in the root layout |
| Local storage (SQLite rows, Supabase session) is sealed with AES-GCM under a key in the iOS Keychain / Android Keystore | `packages/core/src/adapters/rn/`, `security/README.md` N3 |
| Transport is HTTPS (TLS) to onepeek.io and Supabase | standard |
| No proprietary or non-standard algorithm anywhere; all algorithms are IETF / NIST standards | the list above |
| The app is free, for the general public, downloadable from the stores; no key-recovery or escrow feature; not designed for government or financial-institution use | product |
| Encryption is the app's primary function (it is a secure messenger), not ancillary | product |

## Apple's questions (App Store Connect → App → App Information → "App Encryption Documentation", or per build under "Export Compliance Information")

Apple lets you answer once at the app level since 2024 so that each new build inherits the answer; do that.
Wording below follows Apple's help "Complying with Encryption Export Regulations" and the console as last
checked; if the console shows different question text, map by meaning and note the difference.

| # | Apple's question | Draft answer | Reasoning |
| --- | --- | --- | --- |
| 1 | Does your app use encryption? (Includes using HTTPS, encrypting local data, using OS encryption, implementing algorithms.) | **Yes** | End-to-end encryption plus sealed local storage plus HTTPS. |
| 2 | Does your app qualify for any of the exemptions provided in Category 5, Part 2 of the U.S. Export Administration Regulations? | **Yes**, and pick the exemption line that reads: *"(b) Your app uses, accesses, implements or incorporates encryption that is limited to standard encryption algorithms (for example AES, RSA, elliptic curve) instead of, or in addition to, using or accessing the encryption within Apple's operating system"*; NOT the "(a) only uses encryption within Apple's OS / only for authentication, digital signatures or decryption of copy-protected content" line | The app ships its own crypto (OpenSSL via quick-crypto, pure-JS HPKE/MLS), so it is not limited to Apple's OS encryption; everything it ships is standard. This is the mass-market, self-classifiable case. |
| 3 | Does your app implement any encryption algorithms that are proprietary or not accepted as standard by international standard bodies (IEEE, IETF, ITU, etc.)? | **No** | AES-GCM, HKDF, SHA-256, X25519, Ed25519, HPKE (RFC 9180), MLS (RFC 9420): all IETF/NIST. |
| 4 | Does your app implement any standard encryption algorithms instead of, or in addition to, using or accessing the encryption within Apple's operating system? | **Yes** | OpenSSL inside react-native-quick-crypto; the JS implementations in `ts-mls` / `@hpke/core` / `@noble`. |
| 5 | Is your app going to be available on the App Store in France? | Answer per the human's distribution choice (default **Yes**, worldwide) | If France is included, Apple historically asked for a French encryption declaration (ANSSI) for apps that are not limited to OS encryption. Apple's current flow may or may not show an upload field; **the adviser decides whether a French declaration is required** for a free mass-market messenger, and files it if so. Apple's help says the declaration is obtained from the French government and uploaded once. |
| 6 | Upload export compliance documentation (CCATS, ERN, or self-classification) | **None required under 740.17(b)(1)** for the console; see "BIS filing" below | Mass-market, self-classified items need no CCATS or ERN. Apple shows "Missing Compliance" only when a build has no answer; the app-level answers remove that. |

Apple also asks (new since 2024, if shown): *"Does your app contain, use, or access encryption that is exempt under…"* with the same (a)/(b) split, and a question whether the encryption is used *"only for authentication / only within Apple's OS"*. Answer **No** to "only" variants.

## U.S. EAR classification (draft, for the adviser)

- Likely classification: **ECCN 5D992.c** (mass-market encryption software) exported under **License
  Exception ENC §740.17(b)(1)** after **self-classification** (no classification request to BIS, no
  CCATS, no ERN). Grounds: the software is generally available to the public via the App Store / Play
  Store at no cost, the cryptographic functionality cannot be easily changed by the user, it is designed
  for installation by the user without substantial support, and it is not specially designed for
  government end users, financial institutions or network infrastructure; it is a messaging app using
  standard algorithms and key lengths (AES-256, 255-bit curves, SHA-256).
- Why **not** the "publicly available / open source" notification route (§742.15(b)): that route covers
  the published **source code** of `ts-mls`, OpenSSL and the `@noble` libraries, which their authors
  may already have notified. OnePeek's **app binary** is a product that incorporates them; the app's
  own crypto-using source is not published, so the app itself is classified as a product (5D992.c), not
  as publicly available source.
- Why not 5D002 with a one-time review (§740.17(b)(2)/(b)(3)): those cover items that are not mass market
  (for example, products for government end users, or with cryptanalytic or "non-standard cryptography"
  features). Nothing in the app fits.
- **Developer location.** The developer/legal entity is in India, not the U.S. The EAR still applies to
  the distribution because Apple and Google export the binary from U.S. servers, and Apple's agreement makes
  the developer responsible for the compliance answers; this is why Apple asks every developer regardless
  of country. Whether the Indian entity itself is the "exporter" for BIS reporting purposes, or Apple is,
  is the first question for the adviser (Apple's help states the developer must file the annual report
  when self-classifying under (b)(1)). Indian export control for mass-market software is not covered
  here at all; the adviser should say whether anything is required on the Indian side.

## BIS filing: the annual self-classification report

- Under §740.17(e)(3) and Supplement No. 8 to Part 742, anyone who exports mass-market encryption under
  §740.17(b)(1) must send an **annual self-classification report** covering the previous calendar year to
  **BIS and the ENC Encryption Request Coordinator** by **1 February** each year, in the CSV format
  Supplement No. 8 prescribes (product name, model, ECCN 5D992.c, authorization type "MMKT", item type
  "Mobility and mobile applications n.e.s." or similar, manufacturer, non-U.S. components: yes).
- Email addresses and the exact CSV columns: take them from the current BIS page
  (https://www.bis.doc.gov, "Encryption and Export Administration Regulations", self-classification
  report), not from this file; they have changed before.
- First report: due **1 February of the year after the first App Store / Play release**, listing OnePeek
  (iOS and Android are one product; list both if the adviser prefers).
- **No CCATS** is needed for (b)(1). **No ERN** either; ERN was the old name for what the console accepted
  as proof of a BIS classification for (b)(2)/(b)(3) items.
- Alternative the adviser may raise: if the adviser concludes the app is instead "publicly available"
  encryption source code under §742.15(b) (it is not, see above) or that Apple as the exporter files on
  the developer's behalf (Apple's help says the developer is responsible), the report may not be due.
  Record the conclusion in `docs/mobile/log.md`.

## Google Play

Play has no encryption questionnaire. The same EAR analysis covers the Android binary (also exported from
U.S. servers). Nothing to enter in the console; keep the Play build in the same self-classification report.

## Open questions for the adviser (each needs a written answer before submission)

1. Confirm 5D992.c / §740.17(b)(1) self-classification for an India-based developer distributing through
   Apple and Google, and who files the 1 February report.
2. Confirm "(b) standard encryption algorithms" is the right exemption line in App Store Connect, given
   that the app bundles OpenSSL and pure-JS MLS rather than relying only on iOS CryptoKit.
3. France: is a French declaration required for this app under the current rules, and does Apple's
   console still ask for it?
4. Any Indian-side export or import formality for an Indian entity publishing encryption software.
5. Whether the lack of an independent audit of `ts-mls` (a product fact disclosed in the listing) has any
   bearing on the classification. (Expected: none; classification turns on algorithms and market, not on
   audit status.)
