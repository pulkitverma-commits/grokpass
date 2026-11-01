# testID contract (single source of truth)

`mobile-ui` builds screens with exactly these ids; the Maestro flows in `flows/` use them verbatim;
`scripts/check-flows.mjs` fails when a flow uses an id that is not in this file. Status:

- `contract`: in the code on `mobile/integration` (reconciled against `grep -rho 'testID=...'` over
  `apps/mobile/app`, `components` and `security` on 2026-10-31, after mobile-ui wave 2 merged).
- `proposed`: needed by a flow but not in the code yet. The flow step is marked `TODO(testid)`
  and the lead decides. Until then those steps are dry (written, not runnable).

Rules (unchanged from test-plan §3.2): lower-case, dot-separated `screen.element`; never dynamic
data except the `<id>` in `msg.<id>` / `file.<id>` / `row.<id>` / `timer.<id>` / `reply.<id>`
(the message id) and the option value in `new.timer.<s>` / `room.timer.<s>` / `timer.ttl.<s>` /
`new.lifetime.<s>` / `invite.expires.<s>` / `invite.uses.<n>` (seconds / count, from
`lib/format.ts` `TIMERS` = 10, 30, 60, 300, 3600, 86400 and `LIFETIMES` = 3600, 86400, 604800);
one id per interactive element and per screen container.

## Welcome, Sign in, auth callback

| id | screen | status |
| --- | --- | --- |
| `welcome.screen` | Welcome (01) container | contract |
| `welcome.getStarted` | Welcome (01) | contract |
| `welcome.invite` | Welcome (01), "I have an invite link" | contract |
| `welcome.signIn` | Welcome (01) | contract |
| `signin.screen` | Sign in (02) container | contract |
| `signin.apple` | Sign in (02), iOS only | contract |
| `signin.google` | Sign in (02) | contract |
| `signin.passkey` | Sign in (02); rendered only when `PASSKEYS_AVAILABLE` (hidden for Gate 1) | contract |
| `signin.email` | Sign in (02), the email field | contract |
| `signin.sendLink` | Sign in (02) | contract |
| `signin.emailSent` | Sign in (02), the "check your inbox" state container (was proposed as `signin.sent`) | contract |
| `signin.emailAgain` | Sign in (02), "Use a different email" | contract |
| `signin.error` | Sign in (02), error notice | contract |
| `signin.joinGuest` | Sign in (02), "Join with an invite link" | contract |
| `signin.guest` | Sign in (02), "Start a Quick Chat as a guest" | contract |
| `auth.screen` | `onepeek://auth` callback container | contract |
| `auth.error` | auth callback, error notice | contract |
| `auth.retry` | auth callback, back to sign in | contract |

## Chats home

| id | screen | status |
| --- | --- | --- |
| `chats.screen` | Chats home (04) container | contract |
| `chats.search` | Chats home (04) | contract |
| `chats.new` | Chats home (04) | contract |
| `chats.secret` | Chats home (04), "One-time secret" | contract |
| `chats.join` | Chats home (04), join with a link | contract |
| `chats.settings` | Chats home (04) | contract |
| `chats.room` | Chats home (04), a room row (one id for every row; flows pick by index) | contract |
| `chats.pending` | Chats home (04), a pending-join row | contract |
| `chats.letIn` | Chats home (04), pending-join "Let in" button | contract |
| `chats.empty` | Chats home (04), empty state | contract |
| `chats.start` | Chats home (04), empty-state "Start a chat" | contract |
| `chats.noMatch` | Chats home (04), search with no result | contract |

## New chat, invite sheet, join

| id | screen | status |
| --- | --- | --- |
| `new.screen` | New chat (08) container | contract |
| `new.kind.secret` | New chat (08) | contract |
| `new.kind.quick` | New chat (08) | contract |
| `new.kind.business` | New chat (08) | contract |
| `new.timer` | New chat (08), timer group | contract |
| `new.timer.<s>` | New chat (08), one timer option; `<s>` ∈ TIMERS (`new.timer.3600` is 1 hour) | contract |
| `new.mode` | New chat (08), "Timer starts" group | contract |
| `new.mode.read` | New chat (08), "once read" | contract |
| `new.mode.sent` | New chat (08), "once sent" | contract |
| `new.lifetime` | New chat (08), "Chat lifetime" group | contract |
| `new.lifetime.<s>` | New chat (08), one lifetime option; `<s>` ∈ LIFETIMES | contract |
| `new.code` | New chat (08) | contract |
| `new.name` | New chat (08) | contract |
| `new.nick` | New chat (08) | contract |
| `new.create` | New chat (08) | contract |
| `new.error` | New chat (08), error notice | contract |
| `invite.sheet` | Invite sheet container | contract |
| `invite.link` | Invite sheet, the link text. **Masked** (`#••••••`, W1-9) unless the build is the `e2e` EAS profile (`extra.e2e`, W3-2); see "Rendering requirements" | contract |
| `invite.copy` | Invite sheet | contract |
| `invite.share` | Invite sheet | contract |
| `invite.done` | Invite sheet | contract |
| `invite.toast` | Invite sheet, "Copied" toast | contract |
| `invite.create` | Room menu → Invite, "Create invite link" | contract |
| `invite.expires` | Room menu → Invite, "Link works for" group | contract |
| `invite.expires.<s>` | Room menu → Invite, one option; `<s>` ∈ LIFETIMES | contract |
| `invite.uses` | Room menu → Invite, "Can be used" group | contract |
| `invite.uses.<n>` | Room menu → Invite, one option; `<n>` ∈ 1, 5, 20 | contract |
| `invite.row` | Room menu → Invite, an active invite row | contract |
| `invite.revoke` | Room menu → Invite, "Revoke" on a row | contract |
| `join.screen` | Join (09) container (every state) | contract |
| `join.link` | Join (09), paste-a-link field | contract |
| `join.continue` | Join (09), "Continue" after pasting | contract |
| `join.invalid` | Join (09), invalid-link state | contract |
| `join.again` | Join (09), "Paste a different link" | contract |
| `join.code` | Join (09) | contract |
| `join.nick` | Join (09) | contract |
| `join.submit` | Join (09) | contract |
| `join.error` | Join (09), error notice (wrong code) | contract |

## Conversation

| id | screen | status |
| --- | --- | --- |
| `room.screen` | Conversation (05/06) container, also the ended state | contract |
| `room.back` | Conversation, back to Chats (header; also the "Back to chats" button of the ended state) | contract |
| `room.title` | Conversation, header title | contract |
| `room.menu` | Conversation, header menu button | contract |
| `room.composer` | Conversation, text input | contract |
| `room.send` | Conversation | contract |
| `room.attach` | Conversation | contract |
| `room.timer` | Conversation, the timer pill in the composer (opens `room.timerSheet`) | contract |
| `room.timerSheet` | Composer timer sheet container | contract |
| `room.timer.options` | Composer timer sheet, the group | contract |
| `room.timer.<s>` | Composer timer sheet, one option; `<s>` ∈ TIMERS | contract |
| `room.replyCancel` | Composer, cancel reply | contract |
| `room.waiting` | Conversation, "Waiting for the owner to let you in" (replaces the proposed `join.waiting`: Join navigates to the room right after redeem) | contract |
| `room.ended` | Conversation, ended/removed/burned state | contract |
| `room.error` | Conversation, error notice | contract |
| `room.notice` | Conversation, a screenshot notice row (not a `msg.<id>`) | contract |
| `msg.<id>` | Conversation, one bubble per message; `<id>` is the message id. On someone else's text in a Secret room it is the hold-to-read Pressable | contract |
| `row.<id>` | Conversation, the bubble's outer row (bubble + meta) | contract |
| `file.<id>` | Conversation, the tappable file row inside a file bubble (opens the viewer); `enabled: false` once a view-once file was viewed | contract |
| `timer.<id>` | Conversation, a bubble's countdown text | contract |
| `reply.<id>` | Conversation, a bubble's Reply button | contract |
| `attach.sheet` | Attach sheet container | contract |
| `attach.photo` | Attach sheet, "Photo" source (opens the system picker, which is outside this contract) | contract |
| `attach.file` | Attach sheet, "File" source | contract |
| `attach.picked` | Attach sheet, the selected-file row | contract |
| `attach.viewOnce` | Attach sheet, view-once Switch (`checked: true` by default in Secret rooms) | contract |
| `attach.send` | Attach sheet, "Encrypt and send" | contract |
| `attach.cancel` | Attach sheet | contract |
| `attach.error` | Attach sheet, error notice | contract |
| `viewer.screen` | File viewer container | contract |
| `viewer.hold` | File viewer, hold-to-view area (Secret rooms, image/text previews) | contract |
| `viewer.close` | File viewer, header close | contract |
| `viewer.done` | File viewer, "Close" button | contract |
| `viewer.share` | File viewer, "Share or save…" (never for a view-once preview) | contract |
| `viewer.gone` | File viewer, "Already viewed" state (server said `gone`) | contract |
| `security.watermark` | Watermark overlay (Secret rooms while held) | contract |

## Room menu

| id | screen | status |
| --- | --- | --- |
| `room.menuSheet` | Room menu sheet container (every view) | contract |
| `room.menu.timer` | Room menu, "Message timer" | contract |
| `room.menu.invite` | Room menu, "Invite someone" (owner, or any member of a Quick room) | contract |
| `room.menu.verify` | Room menu, "Verify people" | contract |
| `room.menu.members` | Room menu, "Room details" | contract |
| `room.menu.rename` | Room menu, "Name this chat" (owner) | contract |
| `room.panic` | Room menu, "Panic Exit" (single tap, no confirmation) | contract |
| `room.burn` | Room menu, "Burn chat" (owner) | contract |
| `room.burn.confirm` | Burn confirmation, the destructive button | contract |
| `room.leave` | Room menu, "Leave chat" (member) | contract |
| `room.leave.confirm` | Leave confirmation, the destructive button | contract |
| `confirm.cancel` | Burn / leave confirmation, "Cancel" | contract |
| `members.pending` | Room details, a "Waiting to join" row (owner) | contract |
| `members.letIn` | Room details, "Let in" on a pending row | contract |
| `members.row` | Room details, an active member row | contract |
| `members.remove` | Room details, "Remove" on a row (owner) | contract |
| `members.remove.confirm` | Room details, remove confirmation box | contract |
| `members.remove.yes` | Room details, remove confirmation, "Remove" | contract |
| `members.remove.no` | Room details, remove confirmation, "Keep" | contract |
| `verify.member` | Verify people, a member row (shown when more than one member, or after marking) | contract |
| `verify.number` | Verify people, the safety number (12 groups of 5; `accessibilityLabel` "Safety number …") | contract |
| `verify.mark` | Verify people, "They match — mark verified" | contract |
| `verify.back` | Verify people, "Someone else" | contract |
| `timer.ttl` | Message timer view, the group | contract |
| `timer.ttl.<s>` | Message timer view, one option; `<s>` ∈ TIMERS | contract |
| `timer.mode` | Message timer view, room default group (owner) | contract |
| `timer.mode.read` | Message timer view, "once read" | contract |
| `timer.mode.sent` | Message timer view, "once sent" | contract |
| `timer.save` | Message timer view, "Save as room default" (owner) | contract |
| `rename.name` | Name this chat, the field | contract |
| `rename.save` | Name this chat | contract |

## Locked screen and Settings

| id | screen | status |
| --- | --- | --- |
| `locked.screen` | Locked (03) container; present only while **locked** (the inactive/recording cover has no ids) | contract |
| `locked.unlock` | Locked (03) | contract |
| `locked.passcode` | Locked (03), "Use phone passcode" (biometric devices) | contract |
| `locked.insecure` | Locked (03), no-passcode warning | contract |
| `locked.failed` | Locked (03), "Couldn't unlock" notice | contract |
| `app.cover` | Inactive / recording cover view (`LockCover`) | contract |
| `settings.screen` | Settings (12) container | contract |
| `settings.account` | Settings (12), account row | contract |
| `settings.lock` | Settings (12), lock-state row | contract |
| `settings.protection` | Settings (12), screen-protection row | contract |
| `settings.lockNow` | Settings (12), "Lock now" | contract |
| `panic` | Settings (12), "Panic Exit" row. **Single tap**, no confirmation; there is no `panic.confirm*` anywhere | contract |
| `settings.notifications` | Settings (12), notifications row | contract |
| `settings.notify` | Settings (12), the notifications Switch | contract |
| `settings.notifyError` | Settings (12), notifications error notice | contract |
| `settings.reset` | Settings (12), "Reset chats on this phone" | contract |
| `settings.spike` | Settings (12), Phase 0 spike (`__DEV__` only) | contract |
| `settings.device` | Settings (12), a device row | contract |
| `settings.device.revoke` | Settings (12), "Sign out" on a device row | contract |
| `settings.device.confirmBox` | Settings (12), device sign-out confirmation box | contract |
| `settings.device.confirm` | Settings (12), device sign-out confirmation, "Sign out" | contract |
| `settings.device.keep` | Settings (12), device sign-out confirmation, "Keep" | contract |
| `settings.protectionCopy` | Settings (12), the honest-copy card | contract |
| `settings.signOut` | Settings (12) | contract |
| `reset.screen` | Reset confirmation container | contract |
| `reset.reset` | Reset screen, first tap ("Reset chats on this phone", reveals the confirmation) | contract |
| `reset.confirm` | Reset screen, the destructive "Yes, reset chats on this phone" | contract |
| `reset.cancel` | Reset confirmation | contract |
| `secret.screen` | One-time secret (lead-owned) container | contract |

## Primitives (default ids rendered by shared components)

| id | screen | status |
| --- | --- | --- |
| `sheet.handle` | Every sheet (`Sheet`), the grab handle; tapping it closes the sheet | contract |
| `header.back` | Every `Header` without its own id, the back button | contract |
| `header.close` | Every modal `Header` (`close`), the close button | contract |

## Proposed (not in the code; lead to accept, rename or reject)

| id | screen | status | needed by |
| --- | --- | --- | --- |
| `verify.qr` | Verify people, the QR code wrapper (today only an `accessibilityLabel`, no id); would let 11 assert the QR is rendered | proposed | 11 (optional) |

Everything proposed on 2026-10-31 landed under a contract name (`signin.sent` → `signin.emailSent`,
`join.waiting` → `room.waiting`, `new.timer.1h` → `new.timer.3600`) or verbatim (`join.error`,
`room.back`, `attach.*`, `viewer.*`, `room.notice`).

## Phase 2 proposed (qa, 2026-11-01; mobile-ui reconciles against U8/N6 as the screens land)

Needed by flows 12–16 (`docs/mobile/test-plan.md` §3.3, Phase 2 rows). `secret.screen` and the `viewer.*`
ids above are **contract** and are reused: the one-time-secret screen (lead-owned) and the file viewer
double as the secret viewer, so the flows only add the states that secrets introduce. Same rules: lower-case
`screen.element`, no dynamic data except `link.<id>` (message id) and the option values `secret.views.<n>`
(1, 3, 5, 10), `secret.expires.<s>` (300, 3600, 86400, 604800), `secret.timer.<s>` (TIMERS). Until accepted,
every step using one of these is dry (`check-flows.mjs` lists them).

| id | screen | status | needed by |
| --- | --- | --- | --- |
| `room.secret` | Conversation, composer "Send as secret" button (opens `secret.sheet`) | proposed | 12 |
| `secret.sheet` | Send-as-secret sheet (07) container, in a room | proposed | 12 |
| `secret.text` | Send-as-secret sheet (07) and One-time secret screen, the text field | proposed | 12, 13 |
| `secret.mode.inChat` | 07, "View once in this chat" | proposed | 12 |
| `secret.mode.link` | 07, "onepeek.io link" | proposed | 12 |
| `secret.views` | 07 / `secret.screen`, "Can be opened" group | proposed | 12, 13 |
| `secret.views.<n>` | one option; `<n>` ∈ 1, 3, 5, 10 (`secret.views.1` is view once) | proposed | 12, 13 |
| `secret.expires` | 07 / `secret.screen`, "Link works for" group | proposed | 13 |
| `secret.expires.<s>` | one option; `<s>` ∈ 300, 3600, 86400, 604800 | proposed | 13 |
| `secret.timer` | 07 / `secret.screen`, viewer-timer group | proposed | 13 |
| `secret.timer.<s>` | one option; `<s>` ∈ TIMERS | proposed | 13 |
| `secret.guard` | 07 / `secret.screen`, "Blur until held" Switch | proposed | 12, 13 |
| `secret.noCopy` | 07 / `secret.screen`, "Allow copying" Switch (off = noCopy) | proposed | 13 |
| `secret.create` | 07 / `secret.screen`, "Encrypt and send" / "Create link" | proposed | 12, 13 |
| `secret.cancel` | 07 / `secret.screen`, cancel | proposed | 12 |
| `secret.error` | 07 / `secret.screen`, error notice | proposed | 12, 13 |
| `secret.link` | `secret.screen` result, the link text. **Masked** like `invite.link` (`…#••••••`) except on the `e2e` EAS profile | proposed | 13 |
| `secret.copy` | `secret.screen` result, Copy | proposed | 13 |
| `secret.share` | `secret.screen` result, Share | proposed | 13, 15 |
| `secret.qr` | `secret.screen` result, the QR code wrapper (carries the full link; never the text) | proposed | 13, 16 |
| `secret.done` | `secret.screen` result, Done | proposed | 13, 15 |
| `link.<id>` | Conversation, the tappable secret-link card inside bubble `<id>` (opens the viewer) | proposed | 12 |
| `viewer.peek` | Secret viewer, the pre-open state container ("Someone sent you a secret", views left, kind chip; never content) | proposed | 12, 13, 16 |
| `viewer.open` | Secret viewer, "Open" (counts the view) | proposed | 12, 13 |
| `viewer.revealed` | Secret viewer, the revealed-state container (content inside is never asserted on) | proposed | 12, 13 |
| `viewer.timer` | Secret viewer, the countdown text | proposed | 13 |
| `viewer.copy` | Secret viewer, Copy (absent when the header has `noCopy`) | proposed | 13 |
| `viewer.wifi` | Secret viewer, the Wi-Fi card (join button / QR) | proposed | 13 (optional) |
| `share.screen` | Share-target route (10) container, after the system share sheet handed us content | proposed | 14, 15 |
| `share.item` | Share target, the received item row: kind and size only, **never the file name as text** (`accessibilityLabel` "1 photo", "1 file") | proposed | 14, 15 |
| `share.toChat` | Share target, "Send to a chat" | proposed | 14 |
| `share.room` | Share target, a room row in the picker (one id for every row; flows pick by index) | proposed | 14 |
| `share.viewOnce` | Share target, view-once Switch (`checked: true` by default) | proposed | 14 |
| `share.send` | Share target, "Encrypt and send" | proposed | 14 |
| `share.link` | Share target, "Make a onepeek.io link" (opens `secret.screen` prefilled with the file) | proposed | 15 |
| `share.cancel` | Share target, cancel (discards the copy) | proposed | 14, 15 |
| `share.error` | Share target, error notice (too large, unsupported type) | proposed | 14, 15 |
| `chats.scan` | Chats home (04), "Scan a code" | proposed | 16 |
| `join.scan` | Join (09), "Scan instead" | proposed | 16 (optional) |
| `scan.screen` | Scan QR (11) container | proposed | 16 |
| `scan.camera` | Scan QR, the camera view | proposed | 16 |
| `scan.permission` | Scan QR, camera-permission-denied state | proposed | 16 |
| `scan.allow` | Scan QR, "Allow camera" / open settings | proposed | 16 |
| `scan.paste` | Scan QR, "Paste a link instead" | proposed | 16 |
| `scan.foreign` | Scan QR, "Not a OnePeek code" notice (stays on the scanner; the payload is never shown) | proposed | 16 |
| `scan.close` | Scan QR, close | proposed | 16 |
| `invite.qr` | Invite sheet, the QR code wrapper (carries the full link; the text stays masked) | proposed | 16 |
| `room.menu.report` | Room menu, "Report this chat" | proposed | (unit tests; no flow) |
| `report.sheet` | Report sheet container | proposed | — |
| `report.reason.<k>` | Report sheet, one reason; `<k>` ∈ spam, harm, other (fixed keys) | proposed | — |
| `report.submit` | Report sheet, "Send report" (ids only; the copy says no message content is sent) | proposed | — |
| `report.cancel` | Report sheet, cancel | proposed | — |
| `report.sent` | Report sheet, sent confirmation | proposed | — |
| `members.block` | Room details, "Block" on a member row (owner or member) | proposed | — |
| `block.confirm` | Block confirmation box | proposed | — |
| `block.yes` | Block confirmation, "Block" | proposed | — |
| `block.no` | Block confirmation, "Keep" | proposed | — |
| `members.blocked` | Room details, the "Blocked" state on a row | proposed | — |

Rendering requirements for the flows (same spirit as below): `secret.link` masks like `invite.link` and
unmasks only on the `e2e` profile (`extra.e2e`); the secret viewer's revealed content is inside
`viewer.revealed` and is never asserted on, in a Secret room it stays behind `viewer.hold`; `share.item`
carries no file name as text; `scan.foreign` never echoes the scanned payload; `link.<id>` is on the card so a
tap opens the viewer and a `longPressOn` on `msg.<id>` still works for hold-to-read.

## Rendering requirements the flows depend on

- `invite.link` is **masked** on screen (`maskLink`: `…#••••••`, one line, middle ellipsis) in every
  normal build, so a shoulder-surfer or a photo of the owner's screen never gets the bearer token
  (security review W1-9). Only a build of the `e2e` EAS profile renders the full link in one `Text`
  (no `numberOfLines`, no ellipsis), which is what Maestro's `copyTextFrom` in flow 03 reads.
  **The `e2e` EAS profile is the only way to unmask** (W3-2): `app.config.ts` sets `extra.e2e` true
  only when `EAS_BUILD_PROFILE=e2e`, and `InviteSheet` checks that value, not an env var; a shell
  `EXPO_PUBLIC_E2E=1` unmasks nothing (and the config refuses to evaluate with it on `preview` or
  `production`). A flow run against any other build fails at `copyTextFrom` (the masked text is not
  a link), which is the intended failure, never a pass.
- `chats.room` is the same id on every row. Flows select by `index`; the row's
  `accessibilityLabel` may carry the room name, never the `testID`.
- `msg.<id>` is on the outer pressable of a bubble so `longPressOn` (hold-to-read) hits it. The
  message text is **not in the tree** until held (Secret rooms), so `assertNotVisible: <body>` is a
  real check, and the revealed state is never asserted on text.
- `file.<id>` is the pressable inside a file bubble. After a view-once file was opened it is
  `enabled: false` ("Already viewed"); flows assert that state instead of a second open.
- `chats.letIn` exists only while a join is pending; flows wait for it to appear and disappear.
- `locked.screen` must be the only thing visible while locked: flows assert `chats.screen` and
  `room.screen` are **not** visible on it. The inactive/recording cover (`app.cover`) carries no
  other id and no content.
- Panic Exit is a **single tap** (`panic` in Settings, `room.panic` in the room menu): the flows
  tap once and assert `locked.screen`. There is no `panic.confirm`; a flow that waits for one is wrong.
- `attach.viewOnce` starts `checked: true` in Secret rooms. Flow 06 asserts the state and never
  taps it (a tap would turn view-once off).
- `settings.notify` is a Switch: flows assert `checked: true|false`, never the token (the token is
  never rendered anywhere).
