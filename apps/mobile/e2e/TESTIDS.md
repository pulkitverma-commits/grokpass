# testID contract (single source of truth)

`mobile-ui` builds screens with exactly these ids; the Maestro flows in `flows/` use them verbatim;
`scripts/check-flows.mjs` fails when a flow uses an id that is not in this file. Status:

- `contract`: Phase 1 wave 1, fixed by the lead on 2026-10-31.
- `wave-2`: Phase 1 wave 2, fixed by the lead; screens land with U5/U7/N4.
- `proposed`: needed by a flow but not in the contract yet. The flow step is marked `TODO(testid)`
  and the lead decides. Until then those steps are dry (written, not runnable).

Rules (unchanged from test-plan §3.2): lower-case, dot-separated `screen.element`; never dynamic
data except the `<id>` in `msg.<id>`; one id per interactive element and per screen container.

## Wave 1

| id | screen | status |
| --- | --- | --- |
| `welcome.getStarted` | Welcome (01) | contract |
| `welcome.signIn` | Welcome (01) | contract |
| `signin.apple` | Sign in (02) | contract |
| `signin.google` | Sign in (02) | contract |
| `signin.email` | Sign in (02), the email field | contract |
| `signin.sendLink` | Sign in (02) | contract |
| `signin.guest` | Sign in (02) | contract |
| `chats.screen` | Chats home (04) container | contract |
| `chats.search` | Chats home (04) | contract |
| `chats.new` | Chats home (04) | contract |
| `chats.settings` | Chats home (04) | contract |
| `chats.room` | Chats home (04), a room row (one id for every row; flows pick by index) | contract |
| `chats.letIn` | Chats home (04), pending-join "Let in" | contract |
| `new.kind.secret` | New chat (08) | contract |
| `new.kind.quick` | New chat (08) | contract |
| `new.timer` | New chat (08) | contract |
| `new.code` | New chat (08) | contract |
| `new.name` | New chat (08) | contract |
| `new.nick` | New chat (08) | contract |
| `new.create` | New chat (08) | contract |
| `invite.link` | Invite sheet, the link text | contract |
| `invite.copy` | Invite sheet | contract |
| `invite.share` | Invite sheet | contract |
| `invite.done` | Invite sheet | contract |
| `join.code` | Join (09) | contract |
| `join.nick` | Join (09) | contract |
| `join.submit` | Join (09) | contract |
| `settings.signOut` | Settings (12) | contract |
| `settings.reset` | Settings (12), "Reset chats on this phone" | contract |
| `reset.confirm` | Reset confirmation | contract |
| `room.screen` | Conversation (05/06) container | contract |

## Wave 2

| id | screen | status |
| --- | --- | --- |
| `room.composer` | Conversation, text input | wave-2 |
| `room.send` | Conversation | wave-2 |
| `room.attach` | Conversation | wave-2 |
| `room.menu` | Conversation | wave-2 |
| `room.burn` | Room menu | wave-2 |
| `room.burn.confirm` | Burn confirmation | wave-2 |
| `msg.<id>` | Conversation, one bubble per message; `<id>` is the message id | wave-2 |
| `locked.screen` | Locked (03) container | wave-2 |
| `locked.unlock` | Locked (03) | wave-2 |
| `panic` | Panic Exit control (global) | wave-2 |

## Proposed (not in the contract; lead to accept, rename or reject)

| id | screen | status | needed by |
| --- | --- | --- | --- |
| `signin.sent` | Sign in (02), the "check your inbox" state container | proposed | 02 |
| `join.waiting` | Join (09), "waiting to be let in" state container | proposed | 04 |
| `join.error` | Join (09), wrong-code message | proposed | 04 (negative path) |
| `new.timer.1h` | New chat (08), the 1-hour timer option (also `new.timer.30s`, `.5m`, `.1d`) | proposed | 03 |
| `room.back` | Conversation, back to Chats (iOS has no system back; the flow falls back to an edge swipe) | proposed | 04-let-in, 08 |
| `attach.photo` | Attach sheet, "Photo" source | proposed | 06 |
| `attach.file` | Attach sheet, "File" source | proposed | 06 |
| `attach.viewOnce` | Attach sheet, view-once toggle | proposed | 06 |
| `attach.send` | Attach sheet, send | proposed | 06 |
| `viewer.screen` | View-once viewer container | proposed | 06 |
| `viewer.close` | View-once viewer | proposed | 06 |
| `viewer.gone` | "Already viewed" state after a second open | proposed | 06 |
| `room.notice` | Conversation, a screenshot notice row (not a `msg.<id>`) | proposed | 07 |

## Rendering requirements the flows depend on

- `invite.link` renders the **full** link in one `Text` (no `numberOfLines`, no middle ellipsis):
  Maestro's `copyTextFrom` reads the rendered text, and a truncated link cannot be opened on the
  second device. The share/copy buttons may show a short form; the `invite.link` element may not.
- `chats.room` is the same id on every row. Flows select by `index`; the row's
  `accessibilityLabel` may carry the room name, never the `testID`.
- `msg.<id>` is on the outer pressable of a bubble so `longPressOn` (hold-to-read) hits it.
- `chats.letIn` exists only while a join is pending; flows wait for it to appear and disappear.
- `locked.screen` must be the only thing visible while locked: flows assert `chats.screen` and
  `room.screen` are **not** visible on it.
