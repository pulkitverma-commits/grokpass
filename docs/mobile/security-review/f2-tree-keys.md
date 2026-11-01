# Security review: F-2 fix (`mobile/core-crypto/f2-tree-keys`, commit a550379)

Reviewer: security-reviewer. Date: 2026-11-01. Read-only review; no tests or builds run (author reports core 367, web 147, mobile 446 green). ts-mls checked at the pinned 1.6.4 (`node_modules/ts-mls/dist/src`). Line numbers are in the f2 worktree.

Attacker: the server operator. They control `chat_room_members` (including `signature_pub`), key packages, Welcome and commit rows, and every listing response. They can drop, reorder or change rows, and answer each call differently.

## Verdict

**F-2 as reported is closed.** The reported attack was substituting the key of a member the server lists, at admit time or later. Safety numbers now hash this device's own real key and the other member's key from the MLS tree. A substituted key can no longer give matching numbers on both phones, and the numbers are byte-identical to the old ones when the tree and the listing agree.

**The outcome F-2 was about is still reachable: matching safety numbers while the server reads the chat.** The route is tree leaves that the server leaves out of the listing (F2-1, **high**). This hole is a residual, not new in this commit. The web copy still says "nobody is intercepting this chat", which is not true. **No critical.** One medium is new in this commit: the sticky mismatch flag (F2-2). The other medium is the copy (F2-5).

## Findings

### F2-1 (high): leaves the server doesn't list are accepted and never shown, so two phones can show matching numbers while the server reads one side

- `packages/core/src/chat/mls.ts:94`: `if (!listed) return true;` accepts any well-formed leaf the server leaves out of the listing.
- `packages/core/src/chat/client.ts:354-374`: `memberView` builds the member list from the listing rows only. A tree leaf with no row never shows in `members()`, so it never shows in the member list, the verify list or any banner. Nobody can compare its safety number.
- `client.ts:720-732` (check 2) only requires the listed owner to *have* a leaf with the listed key. It does not check that the owner signed the Welcome, although the comment there says so.

**Scenario A: split group with a copied owner leaf.** Owner Alice, joiner Bob.
1. The server lets Alice admit Bob's real key package. Alice's real group is {A, B}, and the server cannot read it.
2. The server holds back Alice's Welcome. It builds its own group with ts-mls containing three leaves:
   - its own device X, which signs the GroupInfo;
   - Alice's real leaf, made from any key package Alice's device ever uploaded with `chat_redeem_invite`. Every package reuses the device's signing key (`mls.ts` `newKeyPackage`). A `key_package`-source leaf node's signature does not cover the group id or leaf index. `validateLifetimeOnReceive` is false (`ts-mls/dist/src/lifetimeConfig.js:4`).
   - Bob's leaf.
3. The server serves this Welcome to Bob first.
4. Bob's checks all pass:
   - the signer X is unlisted, so it is accepted on format alone;
   - Alice's leaf matches the listed A, so check 2 passes;
   - Bob's own leaf matches.
5. Bob ignores the real Welcome when it arrives later (`client.ts:713`, `if (state || !pending) continue`).
6. Both phones show the same number, SN(A, B). The server reads everything Bob sends.
7. With F-3 the server can also send messages as X labelled "Alice". Bob's members list never shows X. Alice sees no replies, and that is the only symptom.

The one precondition: Alice's device has joined any room before.

**Scenario B: invisible device in the real group.**
1. In a non-business room, the owner's app auto-admits every pending row it is shown (`apps/mobile/app/room/[id].tsx:140`, `app/chat/r/[id]/page.tsx:94`). The server lists a pending device X with a key package that is consistent with the listing, and the owner admits it.
2. The server stops listing X to the other members. To them X is invisible, and it reads everything.
3. X can also commit its own adds of further unlisted leaves. Any member's commit is accepted, and those leaves pass on format.
4. The owner's `commitRemovals` would remove X if it were shown a listing without X. The server answers that call with X included and the following `members()` call without it.
5. With an honest server, the same gap hides a revoked or lost device from the member list until the owner's app commits its removal.

`known-limitations.md:74-77` says unlisted devices are caught "only [by] an out-of-band safety-number comparison". That cannot happen: the device is never shown, so there is nothing to compare.

**Fix (core-crypto):**
1. **Welcome signer must be the listed owner.** Require that the GroupInfo signer is the listed owner with the listed key. ts-mls 1.6.4 checks the signer's credential first in `joinGroup` (`clientState.js:578`, before `validateRatchetTree` at `:586`). `keyCheck` can record the first identity it is asked about and `joinRoom` can compare it with the owner. Pin this with a test: a Welcome signed by a non-owner leaf that also contains the owner's real key-package leaf must be refused. An honest owner always signs its own Welcomes, so this has no false positive, and it closes scenario A.
2. **Show every tree leaf.** Build `members()` from the union of tree leaves and listing rows. Show a leaf with no row as its own state, for example `unlisted: true`, with the text "Not listed by the server — this device can still read the chat". Count it in `keyChanged` and in banners. This exposes scenario B and the honest revoked-device window.
3. **Show the device count next to the safety number** ("N devices can read this chat"), so both people compare the group as well as the pair. The number itself stays the same.
4. Optional: refuse commits whose committer is not the owner (only the owner commits in this design). Do **not** refuse new unlisted leaves outright. An honest race (a member admitted, then leaving before others sync) would leave the others stuck for good. Flag those leaves instead (point 2).

### F2-2 (medium, new in this commit): one lying listing response puts a permanent "key mismatch" on a member, or on this device itself, with no way to clear it

- `client.ts:793-799` writes `local.mismatch[id] = true`, and nothing ever clears it.
- `client.ts:363`: `memberView` turns the flag into `keyMismatch`.
- `client.ts:846`: `treeKeyToVerify` throws on it, for the member and also for this device's own row.

**Scenario.** The owner adds Carol. For one sync the server lists Carol to Bob with a different key. Bob refuses the commit, which is correct. The next sync gets an honest listing, the commit applies, and the room carries on. But Carol now shows "Key mismatch" on Bob's phone forever, and Bob can never compute or mark her number.

If the server instead lies about Bob's own key during his join, Bob's own row is flagged, and every safety number in the room fails on his phone for good.

The recovery in `known-limitations.md:82-83` ("removing the member and inviting them again") does not clear the flag. The flag is keyed by device id, which stays the same for a device.

The real damage is false alarms the server can plant whenever it wants: users learn to ignore the warning, and verification is blocked. Withholding rows does not give the server this.

**Fix.**
- Store `{ key, seq, at }` instead of `true`.
- Clear the entry when the refused row later applies with a listing that agrees, or when that device's leaf is removed.
- While only a historical flag remains (tree key equals listed key now), let `safetyNumberWith` work, with a "the server once showed a different key for them; compare again" notice. Make a successful `markVerified` clear the flag.
- Treat a self-flag as "the server's listing is wrong about this device", not as a member to distrust.

### F2-3 (low): a failed listing fetch throws out of `applyRows` without saving what the page already applied

`client.ts:719` and `:760` `throw listing.failure()` from inside the loop. Rows earlier in the page have already been stored with `storeMessage`, but `state` and `lastSeq` are not saved, so the next sync decrypts them again from the old state. Keys are not reused, because the saved state is older, so this is churn and possible duplicate handling, not a leak.

**Fix:** record the error, `break`, run the same save path the mismatch branch uses, then throw.

### F2-4 (low): non-UUID device ids still reach production on the owner's own commits; other members then drop the commit silently

- `mls.ts:61` and `:116`: the stored-state service is `keyCheck()` with no directory, which uses the loose `DEVICE_ID` pattern.
- The owner's `addMembers` runs with that service. `packageMismatch` (`client.ts:343-346`) only compares the package's id with `row.device_id`.

**Scenario.** The server lists a pending row whose `device_id` is, say, `device-a`, with a matching package. The owner admits it. Every other member's `receive` runs with a directory, so it applies the UUID check. `validateCredential` returns false *before* the mismatch bookkeeping, so the commit is caught as an ordinary failure and skipped (`client.ts:761`). From then on every row in the new epoch fails to decrypt and is skipped too. The room goes silently out of sync for every non-owner member, with no error. The effect is denial of service, which the server could cause anyway, but this way nobody is told.

**Fix:** make the chat client use the strict UUID service for its stored state as well, and have `packageMismatch` require a UUID. Optionally, when a commit is refused on its credential, reject the sync instead of skipping the row.

### F2-5 (medium, copy on the live site): the web still says "nobody is intercepting this chat"; the docs promise checks that don't happen

- `app/chat/r/[id]/page.tsx:618`: "If they match on both screens, nobody is intercepting this chat." This is false given F2-1 and F-3.
- App: `apps/mobile/app/scan.tsx:144` and `apps/mobile/components/room/RoomMenu.tsx:324` say "These are the keys inside your encrypted chat". That is literally true but vague, and it reads as more than it proves.
- `docs/secret-chat/known-limitations.md:74-77` and `:82-83` are wrong (see F2-1 and F2-2).

**Exact wording until F2-1 is fixed:**
- Web `page.tsx:618`: "Compare these numbers in person or on a call. If they match on both screens, the key this chat holds for {name} is really {name}’s."
- App `RoomMenu.tsx:324`: "Compare these numbers in person or on a call. If they match, the key this chat holds for {name} is really theirs."
- App `scan.tsx:144`: "The numbers match. The key this chat holds for {name} is really theirs."
- `known-limitations.md` 15, the "Devices the server doesn't list" bullet: "A device that is still in the encrypted group but that the server doesn't list (one that left or was revoked before the owner's app removed it, or one a malicious server hides) isn't shown in the member list, so it can't be compared, and it can read the chat until it is removed."
- `known-limitations.md` 15, the "A refused key stops the chat" bullet: drop "for example by removing the member and inviting them again" until F2-2 is fixed. As things stand, that does not clear the warning.

After F2-1 points 1 and 2 land, the web may say: "If they match on both screens, your messages reach {name}’s real device. Everyone who can read this chat is in the member list."

### F2-6 (low, UI): the app swallows `member_key_mismatch` from sync, and the banner uses "key changed" wording and skips pending members

- `apps/mobile/app/room/[id].tsx:157-160`: `pullOnce` only handles `not_signed_in`. A refused Welcome or commit gives no notice; a joiner just sees the room never fill. The web does show it (`page.tsx:76, 101`).
- `room/[id].tsx:389-391`: the banner filters on `state === 'active'` and always says "security key changed". So the owner gets no banner for a pending joiner whose key package was refused.

**Fix:**
- On `member_key_mismatch` from sync, show a persistent notice: "This chat stopped updating because a member’s key doesn’t match. Don’t trust it until you’ve checked with them."
- Banner: use `friendlyError('member_key_mismatch')` when `m.keyMismatch`, include pending members when `keyMismatch`, and give it its own accessibility label rather than `KEY_CHANGED_LABEL`.

## Answers to the author's open questions

1. **`app/room/[id].tsx` banner wording.** Yes, use the mismatch wording when `keyMismatch`, and show it for pending members too. Also show sync's `member_key_mismatch` (F2-6).
2. **A flag that never clears.** Keep it as a record, not as a block that can't be undone: see the F2-2 fix. As implemented it is a lever the server can pull at will, and the documented recovery does not work.
3. **Quiet skip at admit.** Accept. It fails closed and gives the server nothing new (it can already block any join). Make sure the owner sees it: the members list does, the mobile banner does not (F2-6).

## Checked and correct

- **Numbers are byte-identical when keys agree.** `mls.safetyNumber`/`fingerprint` (`mls.ts:328-344`) are unchanged. The inputs are still (own real key, own id) and (their key, their id), and the tree key is the listed key in every honest case. Verified marks store `toBytea` of the same bytes, so existing verified pairs on the live site see no change. One visible change: a pending member (no leaf yet) now gets `not_a_member` instead of a number.
- **Admit-time substitution.** If the package's key differs from the listing, the owner refuses it (`client.ts:390-391`). If the server changes both the package and the listing, Alice gets SN(A, S) and Bob cannot get the same number without S's private key, so comparing catches it.
- **A fake owner Welcome made with the server's own key for the owner** is refused (check 2 and `keyCheck`), as the test at `tree-keys.integration.test.ts:148` shows. The copied-leaf variant is not refused (F2-1).
- **Listing differs from the leaf, or changes between calls.** The member is flagged in every `members()`, `safetyNumberWith` and `markVerified` call. The safety number itself never reads the listing.
- **Two leaves under one listed id with different keys** are flagged (`memberView`, `keys.some`).
- **UpdatePath.** ts-mls checks the committer's new leaf (`processMessages.js:136`), Update proposals (`clientState.js:670`) and added key packages (`:679`) with the per-call service, and a false result throws at every call site. A leaf can only be replaced under its owner's signature, which covers the group id and leaf index, so the server cannot rotate another member's key. A real key change means a new device and a re-join (test at `:171`).
- **Nothing from a refused state is saved.** `joinRoom` returns nothing. `receive` throws before returning `newState`. The loop stops before the refused row and `lastSeq` stays before it. Earlier rows are saved. The per-call `clientConfig` override is put back (`{ ...joined, clientConfig }`, `newState.clientConfig = state.clientConfig`), so stored state never keeps a listing callback.
- **Listing fetch.** It runs under the room lock (`client.ts:655`), once per page, after the rows are fetched (so it includes members just admitted), and only when ts-mls meets a credential. A failed fetch throws inside `validateCredential`, ts-mls passes the error up, `listing.failure()` turns it into a sync rejection rather than a skip, and the cached rejected promise keeps it failing for the rest of the page.
- **Format-only branch.** Production `joinRoom` and `receive` always get a directory (`applyRows`). The format-only service is used only for the owner's own commits, after the listing check (except F2-4).
- **Denial of service.** A refused row stops that member's room. That fails closed and is no stronger than the server simply holding rows back; the exception is the sticky flag (F2-2).

---

## Re-review of 677ea2c

Reviewer: security-reviewer. Date: 2026-11-01. Read-only review of `a550379..677ea2c`; no tests or builds run (author reports core 374, web 148, mobile 448 green). ts-mls 1.6.4 sources checked again where the fix relies on its internals.

### Verdict

**F-2 is not fully closed: one high remains (F2-7), no critical.**

The commit lands F2-2, F2-3, F2-4 and F2-6, and F2-1 parts (2) and (3). The Welcome-signer check, F2-1 (1), is in place, but it trusts the server's listing to say which device is the owner. A server that labels its own device as "owner" to the joiner can still run the split-group attack. It can also add a ghost to the owner's real group, so the device counts on the two screens match. The pairwise safety numbers then match while the server reads both directions.

What is better than before: every device that can read the chat is now listed on each screen, so the copy is literally true and an attentive user can catch the attack. But "they match" no longer implies "nobody else is reading", which is what users will take from it.

The owner-only commit rule, F2-1 (4), also lets any member freeze the room for everyone (F2-8, medium).

### Status of F2-1 to F2-6

| Finding | Status | Proof |
|---|---|---|
| F2-1 (1) Welcome signer = listed owner | **Landed, but can be bypassed** (see F2-7) | `tree-keys.integration.test.ts:211`. The signer comes from `keyCheck().seen[0]`. In ts-mls 1.6.4, `joinGroup`'s first `validateCredential` call is the GroupInfo signer (`clientState.js:578`), and the GroupInfo signature is then verified with that same key (`:581`). A test pins this. |
| F2-1 (2)+(3) unlisted leaves shown and counted | **Closed** | `client.ts` `memberView` takes the union of leaves and listing rows. Unlisted leaves get `unlisted`, `inGroup` and `keyChanged`, and a safety number can be computed for them. Test `:231`. Web and app show `UNLISTED_NOTE` and `readersLine`. |
| F2-1 (4) only the owner may commit | **Landed, but creates a new problem** (F2-8) | `mls.ts` `receive`: the callback records `senderLeafIndex`, and a commit is accepted only if the committer's leaf in the tree before the commit is the listed owner. Test `:246`. |
| F2-2 sticky flag | **Closed** | Flags are `{key, seq, at}`. They clear when the refused row later applies, when the device's leaf is removed, or on `markVerified` against an agreeing key. A flag on this device itself never blocks. Tests `:259`, `:278`. |
| F2-3 progress lost on listing failure | **Closed** | The loop breaks, saves what it applied, records flags, then throws. Test `:291`. |
| F2-4 non-UUID ids | **Closed** | Stored state loads with `strictIds`, `packageMismatch` requires a UUID, and a malformed credential gives a loud `member_key_mismatch` (`format`). Test `:311`. |
| F2-5 copy | **Partial** | The app wording is fine. The web sentence is literally true but needs the count and every-device instruction (F2-7). `known-limitations.md` 15 is accurate except that it doesn't mention F2-7. |
| F2-6 app notices | **Closed** | `room/[id].tsx`: `keyStop` notice; `room.keyMismatch`, `room.unlisted` and `room.keyChanged` rows, each with its own label; pending members are included when mismatched. `room.test.tsx`. |

### New findings

#### F2-7 (high, residual of F-2): the joiner learns who the owner is from the server, so a relabelled "owner" passes the signer check and pairwise numbers match while the server reads both directions

- Where:
  - `client.ts` `applyRows`, the Welcome branch: `ownerRow()` is the listing row with `role === 'owner'`.
  - `acceptCommitter`, which uses the same row.
- Scenario. Owner Alice, joiner Bob, in a non-business room that auto-admits.
  1. To Bob only, the server lists its own device X with `role: 'owner'` and X's real key. It lists Alice's real device as a `member` with key A.
  2. It builds a fake group {X, Alice's copied key-package leaf, B} and signs the Welcome as X. Every check passes:
     - the signer is the listed "owner";
     - the "owner" has a leaf with the listed key;
     - every leaf agrees with the listing.
  3. In Alice's real group, the server lists a pending device Y, and Alice's app auto-admits it.
  4. Each side now sees three devices. Both phones show "3 devices can read this chat". Alice and Bob compare their pairwise numbers, SN(A, B), and they match.
  5. The server reads Alice's messages through Y and Bob's messages through X. With F-3 it gives X and Y believable nicknames (`nicknames[row.sender_device]`).
  6. Only a user who also verifies the extra, unverified device on their own screen catches it.
- Precondition: Alice's device has uploaded at least one key package (it has joined any room before). Without that, step 2 has no Alice leaf: Bob's number with Alice fails or the counts differ, and the attack is visible.
- Fix: pin the owner without trusting the server.
  1. When the owner's app builds an invite link, put the owner's device id and a hash of its signing key in the URL fragment, next to the token (the fragment never reaches the server).
  2. `redeemInvite` stores that pin in `PendingJoin`.
  3. The Welcome branch requires the signer to be the pinned device with the pinned key, whatever the listing says.
  4. `acceptCommitter` uses the pinned owner as well; store it in `RoomLocal` at join time.

  With these in place the joiner is always in the owner's real group. Any ghost (Y) is then in the same tree for both people, so both see it and both counts include it.
- Until the fix lands, use this web and app copy:
  - Verify sheet: "Compare these numbers in person or on a call. If they match on both screens, your messages reach {name}’s real device. Everyone who can read this chat is in the member list: check that both screens show the same devices, and verify each one you don’t recognise."
  - App scan result: "The numbers match. The key this chat holds for {name} is really theirs. Check the member list for devices you don’t recognise."
- Tests to add:
  - a Welcome signed by a device the server lists as "owner" that is not the pinned owner is refused;
  - after the fix, the scenario above (X listed as owner, Alice demoted to member) is refused at join.

#### F2-8 (medium, new in 677ea2c): any member can freeze the room for everyone with one commit or proposal

- Where: `client.ts` `applyRows`, the receive catch: `if (e instanceof mls.KeyMismatchError) { refuse(seq, e); stopped = true; break; }`.
  - A `committer` refusal stops the room, and `lastSeq` stays before the row.
  - `mls.ts` `receive`: a by-reference proposal (no commit callback, so `committerLeaf` stays undefined) is also refused as `committer`.
- Scenario. Any member, a guest included, uses a modified client to post one valid commit; test `:246` does exactly this with `mls.rotate`. A proposal works too.
  - Every other member refuses it, including the owner (whose `acceptCommitter` also says no).
  - Every later sync stops at that row again, so nobody ever reaches the owner's next commit or any later message. That includes the owner's removal of the culprit.
  - There is no recovery short of the server deleting the row.
  - Before 677ea2c the same commit was simply applied, so this is a new lever for members. For the server it is nothing new.
- Fix:
  - Treat `committer` refusals, and proposals, as skip-and-record: advance `lastSeq`, continue, and flag the device ("tried to change the group").
  - The honest group stays at the epoch everyone else is in, so skipping is safe. The owner's next commit for that epoch applies normally.
  - Keep stop-on-refusal only for `key` and `format` refusals of the owner's own commits.
  - Test: after a rogue member's commit, Carol still receives the owner's later message and the owner's removal of the rogue member.

#### F2-9 (low): one seq per page for refusals; a refused Welcome can hide a genuine one behind a page boundary

- `refusedSeq` is a single value per page, so every flag set in a page records the last refused row's seq. Applying that row later then clears flags from earlier refused rows in the same page too. Fix: keep a seq per id.
- A refused Welcome holds `lastSeq`, and `applyRows` throws when the page didn't join. If the server puts at least `SYNC_PAGE_SIZE` rows between a fake Welcome and the genuine one, the genuine Welcome is never reached. This is denial of service only, and the server could withhold rows anyway.

### Answers to the lead's questions

- **Can the clearable flag or `keyHistory` hide a real substitution?** No.
  - A flag clears only when the refused row applies against an agreeing listing. At that point the substituted key is in the tree and in the listing, so the pairwise number still differs from the peer's, and a previously verified member shows "Key changed".
  - `keyHistory` appears only when the tree key and the listing agree, and it doesn't change the number.
  - `markVerified` clears a flag only on a user action, after the agreement checks.
  - The server can erase the *record* of an attempt, but not the detection.
- **Can `acceptCommitter` be bypassed?**
  - Through an external commit: no. `receive` accepts `mls_private_message` only; external commits are PublicMessage, so they are skipped as undecryptable. An undefined `senderLeafIndex` is refused.
  - Through the Welcome path: no in itself, because a Welcome carries no commit and its signer must be the listed owner.
  - Through the listing: **yes**. The server can relabel which device is the owner (F2-7).
- **Does the owner-only rule break legitimate flows?** No legitimate flow commits as a non-owner. Only the owner's app calls `addMembers` and `removeDevice`; `mls.rotate` is adapter-only and the client never calls it. A room whose owner device is revoked or gone can no longer admit or commit, which is the same as before. The rule's problem is availability (F2-8).
- **Is the stronger web sentence true?**
  - Literally, yes. Every leaf in this device's tree is now in the member list, including unlisted ones, and "reach {name}'s real device" holds for the compared pair.
  - F-3 does not make it false: the comparison binds device id and key, and which person a label shows comes out in the in-person comparison.
  - It is misleading under F2-7: counts can match while each side carries one plausible extra device. Use the wording above until the owner is pinned.

### Checked and correct (677ea2c)

- `joinRoomWithSigner`: the signer is recorded before the format and listing checks run, and a `format` failure wins over a `key` failure.
- `{ ...joined, clientConfig }` now uses `strictClientConfig` when a directory is given.
- `memberView`:
  - a flag on this device is ignored;
  - a flagged device with no leaf counts as `keyMismatch`;
  - an unlisted leaf with conflicting keys under one id counts as `keyMismatch`.
- `treeKeyToVerify` no longer fails because of this device's own row.
- The `readers` count includes this device on both screens, so the two counts are comparable.
- `applyRows`:
  - the Welcome branch keeps nothing from a refused Welcome, and a genuine Welcome later in the same page still applies;
  - commit removals feed `goneLeaves`, which clears flags;
  - flags are written only when they change.
- App: `keyStop` is set on `member_key_mismatch` in both `refreshOnce` and `pullOnce`, and cleared on a successful sync. Web: a mismatch still loads the room and the members.

---

## Third pass (3fde5dc)

Reviewer: security-reviewer. Date: 2026-11-01. Read-only review of `677ea2c..3fde5dc`; no tests or builds run (author reports core 377, web 149, mobile 453 green).

### Verdict

**For rooms joined with a pinned link, the confidentiality side of F-2 is closed: no open critical, and no open high confidentiality hole.** The joiner now trusts the owner from the link, not from the server's listing, so a relabelled "owner" (F2-7) is refused at the Welcome and at every commit. Rooms joined with old unpinned links keep the F2-7 exposure, but they say so in a persistent notice and use more cautious copy.

**There is one new high, a regression in this commit: F2-10.** Quick rooms let any member create an invite. `createInvite` pins the device that creates the link, so a link made by a member pins that member, not the owner.
- The joiner refuses the owner's genuine Welcome and can never join, behind a false "key doesn't match" alarm.
- An already-joined member who redeems such a link starts skipping every owner commit without telling them.
- A malicious member gets to be the newcomer's "owner".

Fix F2-10 before this ships. Then F-2 can be called closed.

### Status

| Finding | Status | Proof / note |
|---|---|---|
| F2-7 owner pinned in the link | **Closed for pinned links; known residual for unpinned links** | `invite.ts`; `client.ts` `isOwner` (pin first; listing only when no pin) is used for both the Welcome signer and `acceptCommitter`; `tree-keys` tests. Unpinned rooms: `ownerPinned=false`, `UNPINNED_NOTICE`, cautious copy. |
| F2-8 member can freeze the room | **Closed** | A `committer` refusal skips the row, advances `lastSeq` and records `changedGroup`; only key/format refusals of the owner's own commits stop the room. |
| F2-9 per-row records; refused Welcome | **Closed** | Records are per device and per row. A refused Welcome no longer holds `lastSeq`, and sync keeps rejecting until a genuine Welcome applies. |

### The lead's questions

**(a) The unchecked first decrypt in `receive`.**
- Nothing from pass 1 is kept for commits and proposals. ts-mls 1.6.4 is copy-on-write: `processPrivateMessage` builds `{ ...state, secretTree: result.tree }`, and `consumeRatchet` builds a `newTree`. Pass 1 does not change `state`, so pass 2 starts from the same secrets.
- Pass 1's `consumed` buffers are left unzeroed, which is correct: they still belong to the live `state`. When pass 2 runs, it zeroes the same generation's buffers, as before.
- Path secrets decrypted in pass 1 exist only in memory and are dropped.
- Application messages return straight from pass 1, which is right: no credential is involved.
- Errors from pass 1 lead to a skip ("undecryptable"), not a stop. That matches how any failed row was already handled.
- On desync: honest clients never commit unless they are the owner, so skipping drops only rogue changes. Two edge cases, both low:
  - A rogue member's commit that old clients (live web before F-2) applied but upgraded clients skip splits the two groups of clients. Only a malicious member can trigger this.
  - A member who upgrades with a rogue commit still unprocessed, in a room whose owner applied it before upgrading, falls silently behind.

  Neither is a confidentiality issue. Pinned links, which only new builds produce, make both disappear over time.
- Cost: commits are decrypted twice. Acceptable.

**(b) Downgrade.**
- The server cannot see, strip or change the pin. Only `p_token` reaches RPCs (`peekInvite`, `redeemInvite`, `createInvite`), and nothing in the diff logs or sends the link or fragment.
- Someone who controls the channel the link travels through can strip the pin, or swap in their own pin and token, whatever the parser does. Lenient parsing therefore gives them nothing new.
- The cost of lenient parsing is accidental downgrades. A link cut short by a messenger silently becomes unpinned. The only guard is the room's persistent notice, which appears *after* joining.
  - Fix (low): match the core and the web. A fragment with a `.` after the token that doesn't parse as a v1 pin should be `invite_invalid` ("This invite link is damaged; ask for it again"), not a token-only join. Accepting old *bare-token* links is fine.
  - Also: set a sunset date for unpinned links and record it in `known-limitations.md`.
- The pin is never overwritten once set: right for a correct pin, but it also locks in a wrong one (F2-10).

**(c) The owner's device changes (reinstall or new device).** It fails closed.
- A reinstall loses the room's MLS state (keystore entries are device-only and excluded from backup), so the new device cannot commit to the old group at all.
- A pinned joiner refuses any Welcome or commit from the new device (`signer` / `committer`).
- No legitimate flow is broken beyond the room already being orphaned.
- The explanation is poor. A pending joiner sees "This member’s key doesn’t match the chat", which reads like an attack.
  - Fix (low): for a `signer` refusal in a pinned room, say "The person who invited you isn’t the one letting you in. Ask them for a new invite."

**(d) `apps/mobile/security/links.ts` `parseOnePeekLink` (low).**
- The invite branch (`:37`, `:65`) still requires a bare token, so it rejects every pinned link.
- No app code calls `parseOnePeekLink` or `isInviteLink`. They are exported from `security/index.ts` and referenced only in tests and in `security/README.md`, which still describes them as the join-screen parser (`:68`, `:270`). The real paths, `lib/format` `inviteTokenFrom` and `lib/links` `classify`, accept the pin.
- Today this is dead code that misleads. The risk is a future caller wiring it in: pinned links would break, or someone would "fix" it by dropping the pin.
- Fix: accept `INVITE_FRAGMENT_RE` and return `{ token, pin }`, or delete the invite branch and update the README.

**(e) Pin and token in request bodies, SQL, logs.**
- Only the token goes to the server, in `p_token`, and SQL stores only its SHA-256 (`006:318-320`).
- The pin is never in a request body, a URL path, a query string or SQL. It is stored sealed in the keystore at `room:<id>:ownerPin`.
- Nothing added in this commit logs anything.
- The web removes the fragment from the address bar and history before use.

**(f) Copy.**
- Pinned rooms: "If they match, the key this chat holds for {name} is really theirs." True.
- Unpinned rooms: the longer sentence with "check that both screens show the same devices, and verify each one you don’t recognise." True.
- `UNPINNED_NOTICE` is accurate.
- `known-limitations.md`'s "a new invite fixes it" works for an already-joined member: `chat_redeem_invite` is `on conflict do nothing` and returns the room, so the pin gets stored. But it is wrong when the new link was made by a member (F2-10).
- `ownerPinned` is `r.role === 'owner' || stored pin`. `role` comes from the server's `chat_my_rooms`, so a lying server can hide the unpinned notice from a joiner. That is display only; the checks use the stored pin.
  - Fix (low): base `ownerPinned` only on the stored pin. For owners of rooms created before this build, write their own pin into storage on first load.

### New findings

#### F2-10 (high, regression in 3fde5dc): quick-room invites made by a member pin that member, so the joiner can never join, a re-redeeming member goes silently dark, and a malicious member becomes the newcomer's "owner"

- Where:
  - `client.ts` `createInvite` pins `ensureDevice()`, the device that creates the link.
  - `supabase/migrations/006_secret_chat.sql:311-314` lets any member of a `quick` room create invites, and both apps offer it: `apps/mobile/components/room/RoomMenu.tsx:111`, `app/chat/r/[id]/page.tsx:403` (`isOwner || room.kind === 'quick'`).
- Honest scenario. Member Bob invites Dana to a quick room.
  1. Dana's pin is Bob's device.
  2. Alice's app auto-admits Dana and sends a Welcome signed by Alice. Dana refuses it (`signer`), `lastSeq` moves past it, and her sync rejects with `member_key_mismatch` from then on. Dana never gets in.
  3. If an already-joined member with no pin redeems Bob's link, `redeemInvite` stores Bob as owner. From then on that member records every owner commit as `changedGroup` and skips it. With F2-8, that happens *without* an error: the room goes silent for them.
- Malicious scenario. Member M makes the link.
  1. M creates a commit adding Dana and a Welcome signed by M. Dana accepts it, since M is her pin.
  2. Everyone else skips M's commit, so Dana sits in a branch only M can read.
  3. Dana's tree still holds the other members' real leaves. Once Alice has admitted Dana's package, Dana's and Alice's pairwise numbers match, and the device counts are equal.
  4. With an honest server, Dana simply never sees anyone but M. With the server's help (F-3 relabelling), M can impersonate other members to her.
- Fix:
  - `createInvite` embeds the *room's* stored owner pin, not the creating device:
    - the owner embeds its own pin;
    - a member joined with a pin passes that pin on;
    - a member without a pin creates an unpinned link, and the UI says "this link can’t vouch for the owner".
  - Optionally, refuse a `pin.deviceId` that isn't the listed owner at redeem time and show an error, which catches mistakes without trusting the server for security.
  - Tests:
    - a quick-room member's invite carries the owner's pin, and the joiner gets in;
    - a link pinning a non-owner never makes an already-joined member skip owner commits.

#### F2-11 (low): silent desync when the stored pin is wrong

`changedGroup` skipping is right for rogue members, but a wrong pin (F2-10, or a future bug) turns *every* owner commit into a silent skip. Fix: if the device recorded as `changedGroup` is the listed owner and a pin is stored, surface it ("Your copy of this chat no longer recognises its owner") rather than skipping silently.

### Checked and correct (3fde5dc)

- `invite.ts`:
  - `.` is not in the base64url alphabet, so old bare-token links parse exactly as before;
  - the pin is version-tagged (`1`), 48 bytes, with the UUID rebuilt and re-checked;
  - a malformed pin gives `invite_invalid` in the core and on the web;
  - `encodePin` validates its input.
- `isOwner`:
  - with a pin, the listing is ignored;
  - the key is compared by SHA-256 of the leaf key, and the device id must match too.
- The Welcome branch requires every owner leaf in the joined tree to carry the signer's key.
- `createRoom` stores the owner's own pin.
- `refusedWelcomePending` keeps sync rejecting on empty pages until the device has joined.
- External commits are still impossible: `receive` takes only `mls_private_message`, and a missing sender is refused as `committer`.
- The token is only ever sent as `p_token`.

---

## Fourth pass (27dd094)

Reviewer: security-reviewer. Date: 2026-11-01. Read-only review of `3fde5dc..27dd094`; no tests or builds run (author reports core 382, web 150, mobile 460 green).

### Verdict

**F-2 is closed, with no open high or critical.**
- F2-10 is fixed for honest members: invites now carry the room owner's pin, never the pin of the member who made the link.
- One medium remains (F2-12). A *malicious* quick-room member can still write their own pin into a link by hand. A newcomer who joins through that link then sits in a branch only that member can read. This needs the inviter to be the attacker. It reveals nothing the member couldn't already read, and the server can only add impersonation through the F-3 residual. It is a gap in protecting the newcomer, not an F-2 confidentiality hole. Two cheap fixes are below.
- The other open items are low.

### Status of the third-pass findings

| Finding | Status | Note |
|---|---|---|
| F2-10 member-made invite pinned the member | **Closed (honest case)** | `createInvite` takes the room's pin via `storedOwnerPin`: the owner's own, or the one a pinned member joined with. A member without a pin makes a token-only link and is told so (`INVITE_UNPINNED_NOTE`, `ownerPinned: false`). Tests in `tree-keys` and `room-menu.test.tsx`. |
| F2-11 silent skip under a wrong pin | **Closed (partly)** | A skipped owner commit sets `changedGroup` on the owner's row, which shows `OWNER_UNRECOGNISED_NOTICE` on web and app. Only commits at this device's current epoch reach the committer check; a branched member never sees the owner's later commits as anything but undecryptable (see F2-12). |
| (b) lenient parsing | **Closed** | `inviteTokenFrom`, `INVITE_RE` and `parseOnePeekLink` treat a `.` followed by anything but a v1 pin as no link. A trailing full stop is still read as punctuation. Tests in `links.test.ts`. |
| (c) owner device changed | **Closed** | A refused Welcome in a pinned room now gives `invite_owner_mismatch` with the inviter message. Both UIs list it in `KEY_SYNC_CODES`, so it stays fail-closed and persistent. |
| (d) `parseOnePeekLink` | **Closed** | It accepts the pinned form and returns `pin`; the README is updated. |
| `ownerPinned` from the server's role | **Closed** | `ownerPinned` now comes only from the stored pin (`storedOwnerPin`). |
| Sunset of token-only links | **Proposed** | 2027-02-01, in `known-limitations.md`. Track it as a dated task; nothing in the code enforces it yet. |

### The lead's questions

**Leaf-0 back-fill (`storedOwnerPin`).** The back-fill writes this device's own pin only when all three hold: no pin entry is stored; the server says `role === 'owner'`; and this device's own leaf is leaf 0 of its stored state.
- **Can a non-owner satisfy it?** Only in a group that was already forged before these checks existed. ts-mls `createGroup` puts the creator at leaf 0, and an add fills the leftmost blank leaf. A server or member could have built a group where creator X is later removed, leaving a gap at leaf 0, and the victim is then added into that gap. If the server also says "owner", the victim pins *themselves*.
  - That hurts the attacker: from then on the victim refuses the attacker's Welcomes and commits.
  - The attacker gains only one thing: the "unpinned" notice disappears on a room that was already compromised.
  - Low.
- **Does any legitimate flow move the owner off leaf 0?** No.
  - Leaves never move.
  - The owner cannot be removed: `commitRemovals` excludes this device, the Members screen offers no Remove on yourself, the SQL `chat_send` refuses a non-owner's removal of anyone not already recorded, and commits from non-owners are skipped.
  - Only old clients from before F-2, which applied any member's commit, could have accepted a rogue removal of the owner, and a later add could then land someone at leaf 0. Contrived; low.
- **The reverse lever (low).**
  - A server that tells a legacy owner they are only a "member" stops the back-fill. That owner's invites then stay token-only, and the owner sees "because you joined with an older link", which is wrong for someone who created the room.
  - Fix: back-fill on leaf 0 alone (the server's role adds nothing a forged group couldn't also fake), or show the owner a dedicated message.

**Can a member-made pinned invite be abused now? Yes, by a malicious member. This is F2-12 below.**

**The `invite_owner_mismatch` split.**
- It is still fail-closed (in `KEY_SYNC_CODES`; sync keeps rejecting until a genuine Welcome applies), and it is chosen only in a pinned room when a refused Welcome was refused because of its *signer*.
- Its wording, "The person who invited you isn’t the one letting you in. Ask them for a new invite.", reads as a routine mix-up. In a pinned room this error now means one of: the owner's device changed, the server forged a Welcome, or a member branched the room. The server could also use it to nudge users towards a fresh link from someone it prefers.
- Suggested wording: "We couldn’t confirm this chat: the device letting you in isn’t the owner your invite named. Don’t trust this chat. Check with the person who invited you, and ask the owner for a new invite."

### New findings

#### F2-12 (medium, what remains of F2-10): a malicious quick-room member can write their own pin into an invite and keep a newcomer in a branch only that member reads

- Where:
  - The pin is just text in the link. `createInvite` now embeds the owner's pin, but a modified client can put any pin there.
  - `006_secret_chat.sql:311-314`: quick-room members may create invite tokens.
  - `:415`: `chat_send` lets any member post `welcome` and `commit` rows; only removals are restricted to the owner.
- Scenario: member M sends Dana `#<token>.1<M's pin>`.
  1. Dana redeems the link. M then creates a commit adding Dana's package and a Welcome signed by M. An honest server delivers it.
  2. Dana accepts it, since M is her pin. Everyone else skips M's commit as a non-owner change.
  3. The owner's auto-admitted Welcome then reaches a Dana who has already joined, so she ignores it. The owner's later commits never decrypt on her side and are silently skipped as old-epoch or undecryptable, so `OWNER_UNRECOGNISED_NOTICE` never fires.
  4. Dana's tree holds the other members' real leaves, so her pairwise numbers and device count match theirs.
  5. Dana's messages reach only M, and she never sees anyone else's.
- Impact: M learns nothing they couldn't already read as a member. With the server's help (F-3 relabelling), M can make their messages appear to come from other members.
- Fix, either or both:
  1. **At Welcome time, the joiner compares the pin with the listing.** By then the joiner can read the listing. If `pin.deviceId` is not the listed owner, refuse with `invite_owner_mismatch`, or at least flag the room. An honest server then exposes a malicious member, and only server-plus-member collusion gets past it (the F-3 class). This does not weaken the pin: the pin still has to match the Welcome's signer.
  2. **Server, as defence in depth: `chat_send` accepts `welcome` rows and adding commits (`p_activate`) only from the owner device.** An honest server then never delivers M's Welcome.
  - Test: a quick-room link pinning a non-owner member is refused or flagged at join, even though that member signs the Welcome.

#### F2-13 (low): wording for legacy owners and for `invite_owner_mismatch`

Both are covered above.
- `INVITE_UNPINNED_NOTE` tells an owner whose back-fill didn't happen "you joined with an older link", which is wrong for them.
- The `invite_owner_mismatch` wording is too mild for what it now means.

### Checked and correct (27dd094)

- `createInvite`:
  - it never pins the device that makes the link;
  - an unpinned member's link is token-only and labelled;
  - `ownerPinned` is returned to both UIs.
- `storedOwnerPin`:
  - a stored `{pin: null}` (joined with an unpinned link) is never back-filled;
  - the back-fill writes only this device's own key.
- `welcomeRefusal`: `invite_owner_mismatch` is returned only when the room has a pin and a refused Welcome's reason was `signer`; everything else is still `member_key_mismatch`. Both are raised on empty pages too.
- The parsers in core, web, `lib/format`, `lib/links` and `security/links` now agree.
- The token is still the only thing sent to the server.
