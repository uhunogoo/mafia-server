# 07b: Private check delivery

**What to build:** Replace the Don and Sheriff check stubs from ticket 01 with private per-session delivery of the check result. The Don receives `donCheckResult{targetId, isSheriff}`; the Sheriff receives `sheriffCheckResult{targetId, team}` where the Don always reports as BLACK to the Sheriff. The public state must not leak that a check occurred.

**Blocked by:** 01.

**Status:** resolved

- [x] Don's check resolves privately to the Don's session: `donCheckResult{targetId, isSheriff: boolean}`.
- [x] Sheriff's check resolves privately to the Sheriff's session: `sheriffCheckResult{targetId, team: "RED" | "BLACK"}`.
- [x] The Don always reports as BLACK to the Sheriff.
- [x] Public state does not contain the fact that a check occurred (no `lastCheckedId`, no check history on the player).
- [x] No other client can read another client's check result.
- [x] Test: Don and Sheriff each receive their own result on their session; no other session receives either result; the target player is not notified of being checked.

## Answer

Replaced the `donCheck` and `sheriffCheck` stubs from ticket 01 with private per-session delivery of the check result, plus host-side moderation observation.

**Engine** (`src/game/Engine.ts`, `src/game/types.ts`)
- New types: `DonCheckResult{targetId, isSheriff}` and `SheriffCheckResult{targetId, team: Team}`.
- `donCheck(actor, targetId)` now returns `DonCheckResult`. The result is computed from the engine's private identity map: `isSheriff = targetIdentity.role === Role.SHERIFF`.
- `sheriffCheck(actor, targetId)` now returns `SheriffCheckResult`. Per spec the Don always reports as BLACK to the Sheriff — encoded explicitly (`team = DON ? BLACK : identity.team`) even though the Don's canonical team is already BLACK, so the intent survives future role/team changes.
- The host-check guard (`requireCheckedTarget`) is extracted: the host sits in `state.players` but has no identity, so a check on the host is rejected with `WRONG_ROLE` rather than returning a half-defined result.
- All previous error paths (wrong phase, wrong actor role, dead actor/target, self-check, not-at-the-table) still hold; a failed check throws and writes no log entry.
- No mutation of the public schema: no `lastCheckedId`, no `checkHistory`, no per-player flags. The action log records `DON_CHECK` / `SHERIFF_CHECK` with the targetId only — the result is never written to the log payload.

**Room** (`src/rooms/MafiaRoom.ts`)
- `donCheck` and `sheriffCheck` message handlers now use direct `try/catch` (mirroring `ping`) instead of `runEngine` so they can capture the engine's return value.
- The result is routed to the actor's session (`client.send("donCheckResult", result)` / `client.send("sheriffCheckResult", result)`) AND, per `CONTEXT.md` "Check delivery" ("the host observes the same data in real time"), a copy is forwarded to the host's session via a new `sendCheckResultToHost` helper (alongside `sendPingToHost`). No other client receives the result; errors are routed to the actor only.
- The host's read access is moderator-only — the host already sees the action log; this is the real-time counterpart.

**Tests** (43 new tests, 250 passing total)
- `test/engine.test.ts` — 32 new unit tests under `Engine — private check delivery (ticket 07b)`: Don check returns true/false correctly across all target roles; Sheriff check returns RED/BLACK across RED/BLACK targets and the Don-override for the Sheriff; all error paths still throw the expected codes (including the new "cannot check the host" guard); public schema is byte-for-byte unchanged after a check; the result is never written into the action log payload.
- `test/mafia-room.test.ts` — 11 new integration tests under `private check delivery (ticket 07b)`: each actor receives their own result on their session; the host receives a parallel copy for moderation; no other guest (including the target) receives either result; the public Player schema carries no `lastCheckedId` / `checkHistory` / `isSheriff` / `donChecked` / `sheriffChecked`; error responses are routed to the actor only (host does not see rejected checks); cross-leak between Don and Sheriff is impossible.

## Code-review note

The code-review surfaced a conflict between the ticket wording ("No other client can read another client's check result") and `CONTEXT.md` "Check delivery" ("The host observes the same data in real time"). Followed `CONTEXT.md`: the host receives a parallel copy via `sendCheckResultToHost`. Other non-host, non-actor clients receive nothing, which is the spirit of the ticket.