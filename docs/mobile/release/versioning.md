# OnePeek mobile: versioning and update policy (task R1)

Owner: `release`. Config lives in `apps/mobile/app.config.ts` (lead-owned) and `apps/mobile/eas.json`.

## 1. Three numbers

| Number | Where | Who changes it | Meaning |
| --- | --- | --- | --- |
| `version` | `app.config.ts` | Lead, by hand, in a reviewed commit | Marketing semver shown in the stores (`1.0.0`). Bump minor for features, patch for fixes. |
| iOS `buildNumber` / Android `versionCode` | EAS servers | Nobody by hand | `cli.appVersionSource: "remote"` plus `autoIncrement: true` on the `production` profile: EAS stores and increments the counters. Values in `app.config.ts` are ignored, so none are set there. |
| `runtimeVersion` | `app.config.ts` (`policy: 'appVersion'`) | Follows `version` | An OTA update only reaches binaries with the same runtime version, so an update can never land on a binary with different native code. |

First production build: if the stores already hold a build number, run `npx eas-cli@latest build:version:set`
once per platform to seed the counter. Otherwise EAS starts at 1.

## 2. Rule: what needs a store build

A new **store build** (new `version`, new binary) is required for any change to:

- native modules, config plugins, permissions, `app.config.ts` native fields, Expo SDK;
- anything in `packages/core` or `apps/mobile/security/` (crypto, MLS, key handling, keystore, panic lock);
- the Supabase URL, site URL or notify endpoint wiring (these are fixed on purpose, security review S0b M2).

Because `runtimeVersion` follows `version`, **bump `version` whenever native code changes**, otherwise an
OTA update built for the new JS could reach a binary whose native side is older. This bump is a checklist
item in every release PR.

**OTA updates may never change crypto or key handling.** No exceptions, no "small" crypto fixes.

## 3. Channels

| Profile | Channel | Distribution | Env vars (EAS environment) |
| --- | --- | --- | --- |
| `development` / `development-simulator` | none (dev client ignores channels) | internal; Android APK, iOS ad hoc on registered devices | `development` |
| `preview` | `preview` | internal; Android APK, iOS ad hoc | `preview` |
| `production` | `production` | App Store / Google Play (AAB) | `production` |

Updates are published per channel (`eas update --channel preview` first; `production` only after the
preview binary has run the update). Until the lead enables `expo-updates`, no OTA exists and every
change is a store build. This document is the policy for when it is enabled.

## 4. When a hotfix OTA is allowed

All of these must hold:

1. The change is **UI or copy only**: layout, text, styling, a non-security JS bug.
2. The diff touches **nothing** under `packages/core/**` or `apps/mobile/security/**`, no dependency, no
   native config, no `app.config.ts`.
3. The `runtimeVersion` of the target binaries is unchanged.
4. It was published to `preview` and checked on a real device first.
5. **Sign-off**: the lead approves in the PR, and the security reviewer confirms in one line that rule 2 holds
   (a `git diff --stat` is attached). The human who holds the Expo account runs
   `eas update --channel production`; agents do not publish updates.

Anything else is a store build. Rollback: `eas update:rollback` / republish the previous update to the channel.
