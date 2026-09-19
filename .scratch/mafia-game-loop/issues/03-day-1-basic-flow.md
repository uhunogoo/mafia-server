# 03: Day-1 basic flow

**What to build:** A full Day 1 cycle from announcement through voting. Speeches proceed clockwise, nominated candidates get a defense window, and voting picks a single winner (no abstention; default vote = last speaker). Day 1 skips BALAGAN (per ADR 0005). The first-word rule (first speaker must nominate) is enforced starting Day 2 — that's ticket 07.

**Blocked by:** 01.

**Status:** ready-for-human

- [x] `DAY_ANNOUNCEMENT` shows who died last night (or "no one died").
- [x] `DAY_SPEECHES` proceeds clockwise from the first speaker.
- [ ] `DAY_DEFENSE` gives each nominated candidate a 30-second window. *(timer — deferred to ticket 04)*
- [x] `DAY_VOTING` accepts votes for any nominated candidate; no abstention.
- [x] Default vote (no input by the deadline) is the last speaker.
- [x] Single-winner voting: the candidate with the most votes is eliminated.
- [x] Day 1 phase sequence is `ANNOUNCEMENT → SPEECHES → DEFENSE → VOTING` (no BALAGAN).
- [x] After voting, the loser is marked dead and the engine transitions to the next NIGHT.
- [x] The eliminated player's death is routed through the engine's `onPlayerDied` seam (so victory check can fire from a follow-up ticket).
- [x] Test: a full Day 1 cycle ends with the correct player eliminated and the engine in NIGHT phase.

## Answer

Implemented in `src/game/Engine.ts`, surfaced through `src/rooms/MafiaRoom.ts`, with unit + Colyseus integration coverage. ResolveNight now drives `NIGHT → DAY_ANNOUNCEMENT` and bumps `dayCount`; a full Day 1 cycle plays out as `ANNOUNCEMENT → SPEECHES → DEFENSE → VOTING → NIGHT` (BALAGAN omitted per ADR 0005).

### Public surface (Engine)

- `setOnPlayerDied(cb)` — single observer seam for vote-eliminations and mafia kills; victory check is wired by ticket 09.
- `nominate(actor, target)` — phase-gated to `DAY_SPEECHES | DAY_BALAGAN`; rejects dead actor/target and duplicate nominations.
- `startSpeeches()` / `nextSpeaker()` — clockwise order by `seatIndex`, dead players skipped; last call auto-transitions to `DAY_DEFENSE`.
- `nextDefense()` — advances the defense cursor; empty defense list still enters `DAY_VOTING` on the first call.
- `vote(actor, target)` — phase-gated to `DAY_VOTING`; rejects dead actors and non-nominated targets; last write wins.
- `resolveVoting()` — applies default vote (last speaker) for non-voters, single-winner with deterministic first-nominated tie-break, marks the winner dead, fires `onPlayerDied("VOTE_ELIMINATION")`, transitions to `NIGHT` (`dayCount` unchanged until the next `resolveNight`).
- Day-1 read accessors: `getCurrentSpeaker`, `getCurrentDefense`, `getSpeakingOrder`, `getDefenseOrder`, `getVote(voterId)`.

### Schema additions (`src/rooms/schema/MafiaState.ts`)

- `currentSpeakerId: string = ""`
- `currentDefenseId: string = ""`

### Room wiring (`src/rooms/MafiaRoom.ts`)

New host message handlers: `startSpeeches`, `nextSpeaker`, `nextDefense`, `nominate`, `vote`, `resolveVoting`. Each is host-only (matches the night-action pattern from ticket 02). The old `vote` stub is gone. `onCreate` subscribes a no-op `onPlayerDied` callback so the seam is observable from day one; ticket 09 will replace it with the victory check.

### Default-vote semantics

Per ADR 0003 ("no abstention"), `resolveVoting` treats non-voters as auto-cast for the last speaker (highest seatIndex among alive players at the end of `DAY_SPEECHES`). If there are zero explicit nominations, `eliminatedId` stays `""` and the seam does **not** fire — no spurious death.

### Player.votes persistence

Written during `resolveVoting` and preserved through the post-resolution NIGHT so the client can render the outcome. Cleared on the next `DAY_ANNOUNCEMENT` via `resetDayState({ preserveTallies: false })` so the next day starts with a clean slate.

### Tie-break

Deterministic "first in nomination order" on tied vote counts. This is a deliberate deviation from ADR 0003's two-way auto-pardon; ticket 08 owns the full revote / auto-pardon / host-arbitration story (ADR 0003 / ADR 0006). Documented as part of ticket 08's scope.

### Deferred (intentionally)

- **30-second defense window** — pure timer logic, owned by ticket 04 (phase timers + host overrides). The state machine itself is implemented.
- **Day 2+ BALAGAN insertion** — `nextSpeaker` unconditionally moves to `DAY_DEFENSE` on Day 1 (ADR 0005). The Day 2+ branch belongs to ticket 07.
- **First-word rule (Day 2+)** — ticket 07.
- **Revote loop / 2-way auto-pardon / host arbitration** — ticket 08.
- **Victory check + final role reveal** — ticket 09, consuming this seam.

### Tests added

`test/engine.test.ts`:

- `Engine — resolveNight → day cycle entry` (3): dayCount bump, transitions, lastHealed preserved.
- `Engine — Day 1 phase sequence` (4): clockwise speeches, auto-transition on last speaker, dead skip, phase guards.
- `Engine — nominations` (7): schema writes, append order, duplicate / dead-actor / dead-target rejection, BALAGAN/SPEECHES gate, late-phase rejection.
- `Engine — DAY_DEFENSE flow` (4): defense order = nominations in speaking order, advance + auto-transition to VOTING, phase guard, empty-defense first-call transition.
- `Engine — voting` (6): write/re-vote, non-nominated target rejected, dead voter / dead target rejected, phase guard.
- `Engine — resolveVoting` (8): single-winner elimination, default vote → last speaker, `dayCount` unchanged post-resolve, `onPlayerDied(VOTE_ELIMINATION)`, no-op when no nominations, `Player.votes` schema persistence, buffer cleared, phase guard.

`test/mafia-room.test.ts` (Ticket 03 subsection, 6 tests):

- Full Day 1 cycle: votes resolve to the correct eliminated player and engine ends in NIGHT.
- Default-vote integration: client omits votes → server auto-casts to last speaker.
- Non-host cannot run `startSpeeches / nextSpeaker / nextDefense / resolveVoting`.
- `resolveNight` writes `phase = DAY_ANNOUNCEMENT` to the public schema.
- Nominate rejected when phase is not `DAY_SPEECHES` (e.g. NIGHT).
- Vote rejected for a non-nominated candidate through the room.

### Verification

- `npx tsc -p tsconfig.build.json --noEmit` — clean.
- `npm test` — 93 passing, 0 failing (51 engine + 27 mafia-room integration + 15 shared infra).
