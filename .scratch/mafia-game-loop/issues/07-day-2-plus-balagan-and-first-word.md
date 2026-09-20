# 07: Day 2+ BALAGAN + first-word rule

**What to build:** From Day 2 onward, the BALAGAN phase runs between `DAY_SPEECHES` and `DAY_DEFENSE`. The first speaker on Day 2+ must nominate an elimination candidate during their speech; the server rejects speeches that end without a nomination from the first speaker. The first-word right shifts clockwise each day.

**Blocked by:** 03.

**Status:** ready-for-human

- [x] Day 2+ phase sequence is `ANNOUNCEMENT → SPEECHES → BALAGAN → DEFENSE → VOTING`.
- [x] Day 1 still skips BALAGAN (per ADR 0005).
- [x] The first speaker on Day 2+ must nominate an elimination candidate during their speech.
- [x] Server rejects a speech that ends without a nomination from the first speaker on Day 2+.
- [x] First-word right shifts clockwise each day.
- [x] Test: Day 2 first speech without a nomination is rejected; Day 1 first speech without a nomination is accepted; Day 3 first speaker is the seat after Day 2's first speaker.

## Answer

Implemented in `src/game/Engine.ts`, surfaced through `src/rooms/MafiaRoom.ts`, with unit + Colyseus integration coverage. No schema changes were required — `GamePhase.DAY_BALAGAN` and `PhaseTimerMode.BALAGAN` already existed (ticket 04 created the timer mode; this ticket wires the entry/exit).

### Engine wiring (`src/game/Engine.ts`)

Two private fields anchor the new behaviour:

- `firstSpeakerId: string` — the sessionId of the *previous* day's first speaker; survives across days. Read by the next `computeSpeakingOrder` to anchor rotation, and by `nominate` to detect whether the actor is the day's first speaker.
- `firstSpeakerNominated: boolean` — per-day flag flipped by `nominate` when the actor is `firstSpeakerId`. Reset to `false` at the start of every `startSpeeches` so the new day's first speaker must nominate afresh.

New / changed methods:

- `computeSpeakingOrder()` — on `dayCount >= 2`, finds the alive non-host player with the smallest `seatIndex > prevSeat` (clockwise rotation from `firstSpeakerId`'s seat). Falls back to the lowest seat when no alive player satisfies the wrap predicate, so the order stays well-defined even after deaths or a recent kick.
- `startSpeeches()` — records the new first speaker (`firstSpeakerId = speakingOrder[0]`) and resets `firstSpeakerNominated`. The class doc comment notes that `firstSpeakerId` is intentionally retained across days while `firstSpeakerNominated` is reset each day.
- `nextSpeaker()` — when the day's first speech ends on Day 2+ (`dayCount >= 2`, `currentSpeakerIndex === 0`, `!firstSpeakerNominated`), throws `EngineError(WRONG_PHASE, …)` and refuses to advance. Day 1 has no such gate. When the *last* speech ends, `nextSpeaker` routes to `enterDayBalagan()` on Day 2+ or `enterDayDefense()` on Day 1.
- `nominate(actor, target)` — flips `firstSpeakerNominated` when `actor === firstSpeakerId`. The phase guard already accepts both `DAY_SPEECHES` and `DAY_BALAGAN`, so the rule can be cured by a late nomination during BALAGAN (verified in tests).
- `enterDayBalagan()` (new, private) — sets `phase = DAY_BALAGAN`, arms the 90s `BALAGAN` timer (`60s` reminder baked in by `PhaseTimer`), and logs `PHASE_ADVANCE` with `event: "balagan_started"`.
- `onTimerExpired()` / `skipPhase()` — the previously no-op `BALAGAN` cases now both call `enterDayDefense()`.
- `_setFirstSpeakerIdForTest(sessionId)` — test-only seam used by the rotation-wrap engine test to set `firstSpeakerId` without driving 11 days.

The `Player` schema, the per-day reset path, and the public engine read accessors (`getSpeakingOrder`, `getCurrentSpeaker`, `getDefenseOrder`, `getPhaseTimer`) are unchanged — the new state lives entirely inside the engine.

### Room wiring (`src/rooms/MafiaRoom.ts`)

No code changes were needed. The existing `nextSpeaker`, `nominate`, and `skipPhase` handlers already call into the engine; with the engine updated, they now:

- Reject a Day 2+ first-speaker `nextSpeaker` that ends without a nomination — `EngineError(WRONG_PHASE)` surfaces via `engineErrorMessage` as the Ukrainian `Зараз не та фаза для цієї дії` sent privately to the host.
- Auto-advance to `DAY_BALAGAN` after the last speech on Day 2+, and to `DAY_DEFENSE` after a `skipPhase` from BALAGAN.

### First-word semantics

- Only the first speaker is gated (`currentSpeakerIndex === 0`); later speakers can end their speech without nominating.
- The rule applies only on Day 2+ (`dayCount >= 2`); Day 1 still permits nomination-less speeches.
- The check is on `nextSpeaker`, not on `nominate` — `nominate` accepts new nominations any time during `DAY_SPEECHES` or `DAY_BALAGAN`, so a first speaker who realises mid-day that they forgot to nominate can still do so during BALAGAN.
- Self-nominations satisfy the rule (the actor-id comparison is just `=== firstSpeakerId`, no special-casing).
- Nominations from non-first-speaker players do **not** count toward the flag — the check compares `actor === firstSpeakerId` strictly.

### Tests added

`test/engine.test.ts` — new `describe("Engine — Day 2+ BALAGAN + first-word rule (ticket 07)")` block with 17 tests, plus 2 `driveDay1` / `driveNight2` / `driveDay2` helpers:

- Rotation (4): Day 1 first speaker = lowest seat; Day 2 = seat +1; Day 3 = seat +2; wrap from highest seat to lowest via the test seam.
- First-word rule (7): Day 1 acceptance; Day 2 rejection; self-nomination acceptance; third-party nomination acceptance; flag reset per day; non-first-speaker nominations don't trip the gate; only the first speaker is gated.
- Phase sequence (6): Day 2 last `nextSpeaker` → `DAY_BALAGAN`; BALAGAN timer expiry → `DAY_DEFENSE`; host `skipPhase` from BALAGAN → `DAY_DEFENSE`; Day 1 still skips BALAGAN; nominate allowed during `DAY_BALAGAN`; full Day 2 cycle ends in `NIGHT`.

`test/mafia-room.test.ts` — new `Ticket 07` subsection with 7 Colyseus integration tests, all going through the room's message layer:

- Day 1 first speech without nomination is accepted (`nextSpeaker` drives to `DAY_DEFENSE`, no nominations auto-added).
- Day 2 first speaker without a nomination is rejected through the room — host receives one `error` message with the Ukrainian `Зараз не та фаза для цієї дії`; phase stays at `DAY_SPEECHES`; the current speaker cursor is unchanged.
- Day 2 first speaker nominates → `nextSpeaker` advances to `DAY_BALAGAN` with the 90s `BALAGAN` timer armed and unpaused.
- Host `skipPhase` during `DAY_BALAGAN` advances the room to `DAY_DEFENSE`.
- Day 3 first speaker is the seat immediately clockwise from Day 2's first speaker (driven through full Day 2 cycle + Night 3 with save).
- The first-word flag resets at the start of Day 3 — Day 2's fulfilment does not bleed across days.
- `nominate` is accepted during `DAY_BALAGAN` from a non-first-speaker player (a "second candidate" late nomination).

### Deferred (intentionally)

- **07b — private check delivery** — the original ticket 07b scope (a separate card for sending check results privately to the requesting player) remains out of scope here; it is still tracked as `.scratch/mafia-game-loop/issues/07b-private-check-delivery.md` and ready to pick up.
- **2-way auto-pardon / revote / host arbitration** — owned by ticket 08. The first-word rule and BALAGAN insertion do not interact with the voting tie-break path, so ticket 08 can land independently.
- **Victory check + final role reveal** — owned by ticket 09.

### Verification

- `npx tsc -p tsconfig.build.json --noEmit` — clean.
- `npm test` — **207 passing**, 0 failing (was 183 before ticket 07; +24 new tests: 17 engine + 7 mafia-room integration).
