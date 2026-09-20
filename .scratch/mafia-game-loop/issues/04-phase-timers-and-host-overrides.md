# 04: Phase timers + host overrides

**What to build:** Auto-advancing phase timers plus host override controls (pause, resume, skip, extend). The mafia window has 60 seconds with reminders at 30s and 50s; speech uses 60s, defense uses 30s, BALAGAN uses 1–2 minutes. Host overrides preempt the timer.

**Blocked by:** 03.

**Status:** ready-for-human

- [x] Each phase has a server-side timer that auto-advances when expired.
- [x] The mafia window is 60s with reminders at 30s and 50s.
- [x] `DAY_SPEECHES` uses 60s per speaker.
- [x] `DAY_DEFENSE` uses 30s per candidate.
- [x] `DAY_BALAGAN` uses 1–2 minutes (declared as 90s; entry/exit wiring belongs to ticket 07).
- [x] Host can `pause` the current phase timer.
- [x] Host can `resume` a paused phase.
- [x] Host can `skipPhase` to jump to the next phase.
- [x] Host can `extendPhase{seconds}` to add time to the current phase.
- [x] Test: a phase timer fires and advances the phase; host overrides preempt the timer (pause → no auto-advance; skip → immediate transition; extend → timer extended).

## Answer

Implemented in `src/game/PhaseTimer.ts` (pure state machine) wired through `src/game/Engine.ts` (game logic) and `src/rooms/MafiaRoom.ts` (transport layer). 133 tests pass (was 93).

### New module — `src/game/PhaseTimer.ts`

A pure data + arithmetic class. No `setTimeout` / `setInterval`; the room layer translates wall-clock intervals into `tick(now)` calls. Each mode carries a duration + an optional set of reminder marks (seconds elapsed).

- `PhaseTimerMode` — `"MAFIA_WINDOW" | "SPEECH_TURN" | "DEFENSE_TURN" | "BALAGAN"`.
- `PhaseTimerEvent` — `{ type: "REMINDER", mode, remainingSeconds } | { type: "EXPIRED", mode }`.
- `PhaseTimerSnapshot` — `{ mode, durationMs, remainingMs, paused }` — what the room exposes to clients.
- Lifecycle: `start` arms; `tick(now)` advances and returns events; `pause(now)` / `resume(now)` freeze elapsed time without losing accumulated elapsed; `extend(seconds)` adds to the remaining duration.
- Reminder `remainingSeconds` is computed at the mark (not at the tick time), so a tick which crosses several marks at once preserves the spec-correct "30s mark → 30s remaining, 50s mark → 10s remaining" semantics.
- A `consumed` flag on `PhaseTimer` prevents re-firing `EXPIRED` from subsequent stale ticks. The engine is expected to replace (per-turn) or pause (mafia window) the timer on `EXPIRED`.

### Engine wiring (`src/game/Engine.ts`)

- `Engine(state, clock?)` — the optional `clock` defaults to `Date.now` and lets tests inject a fake clock. Public method `_setClockForTest(clock)` for swapping it mid-test.
- `DEFAULT_TIMER_DURATIONS` lives in `src/game/types.ts` so the engine, room, and any future host UI share one source of truth:
  - `MAFIA_WINDOW`: 60s, reminders at [30, 50].
  - `SPEECH_TURN`: 60s.
  - `DEFENSE_TURN`: 30s.
  - `BALAGAN`: 90s (in the 1–2 minute range; declared here, used by ticket 07).
- `startTimer(mode)` / `clearTimer()` are private helpers; `phaseTimer` is the engine's single source of truth for "is a timer armed?".
- Phase entries/exits that arm or clear the timer:
  - `startGame` → arms `MAFIA_WINDOW`.
  - `mafiaKill` → clears (kill satisfied the window).
  - `resolveNight` → clears (entering `DAY_ANNOUNCEMENT`).
  - `startSpeeches` → arms `SPEECH_TURN` (no-op timer when there are no speakers).
  - `nextSpeaker` → restarts `SPEECH_TURN` for the next speaker; on the last call, clears and enters `DAY_DEFENSE` which arms `DEFENSE_TURN`.
  - `nextDefense` → restarts `DEFENSE_TURN`; on the last call, clears and enters `DAY_VOTING` (no timer).
  - `resolveVoting` → arms a fresh `MAFIA_WINDOW` for the next night.
- `getPhaseTimer()` returns the snapshot (or `null`); `tickPhaseTimer()` advances the active timer and dispatches `EXPIRED` internally. The engine never touches the network — the room routes reminders to the host.

### Expiry reactions (in `onTimerExpired`)

- `SPEECH_TURN` → call `nextSpeaker()` (cascades through the round and into `DAY_DEFENSE`).
- `DEFENSE_TURN` → call `nextDefense()` (cascades into `DAY_VOTING`).
- `MAFIA_WINDOW` → pause indefinitely per `CONTEXT.md` (the host must submit a victim or hold the pause). The timer object stays around so `resumePhase` can re-arm.
- `BALAGAN` → no-op in this ticket (Day 1 skips BALAGAN per ADR 0005); ticket 07 owns the entry/exit wiring.

### Host overrides

- All four (`pausePhase`, `resumePhase`, `skipPhase`, `extendPhase`) are gated through `requireHost` and logged as `PHASE_OVERRIDE` with `{ event, mode, [seconds] }`.
- `pausePhase` short-circuits if no timer or already paused (no double-log).
- `resumePhase` re-arms a fresh 60s `MAFIA_WINDOW` after expiry (the host gets another full nudge cycle); for other modes it picks up from the pause point.
- `skipPhase` calls `nextSpeaker` / `nextDefense` for per-turn modes; `MAFIA_WINDOW` and `BALAGAN` are no-ops (no downstream phase inside `NIGHT` step `MAFIA` / inside `BALAGAN`).
- `extendPhase{seconds}` rejects `seconds <= 0` or non-finite; the room wrapper additionally `fail`s the client.

### Room wiring (`src/rooms/MafiaRoom.ts`)

- `setInterval(..., PHASE_TIMER_TICK_MS = 250)` driver is started in `onCreate` and cleared in `onDispose`.
- `drivePhaseTimer(events?)` advances the engine (if no events were provided) and routes each `REMINDER` to the host as `timerReminder{mode, remainingSeconds}`. `EXPIRED` events are not routed — the engine already reacted.
- Four new host-only message handlers: `pausePhase`, `resumePhase`, `skipPhase`, `extendPhase{seconds}`. `extendPhase` validates `seconds > 0` before reaching the engine.
- Test seams: `_driveTimerAtForTest(deltaMs)` advances the room's clock by `deltaMs` then ticks once (avoids `setTimeout` in tests); `_tickPhaseTimerForTest()` mirrors the production interval.

### Test fixes from the code-review

- Removed unused `_driveTimerAtWithEventsForTest` seam (dead code).
- Renamed and rewrote the room-level "resolveVoting clears it" test — the previous version passed for the wrong reason (`resolveVoting` was rejected because there were no nominations, so the timer was never armed in `DAY_DEFENSE`). The new version nominates a player, drives through defense, and asserts `resolveVoting` arms a fresh `MAFIA_WINDOW`.

### Deferred (intentionally)

- **`DAY_BALAGAN` entry / exit wiring** — `startTimer("BALAGAN")` is never called from this ticket (Day 1 still skips BALAGAN per ADR 0005). The mode exists so ticket 07 can arm it with a single call.
- **First-word rule on Day 2+** — ticket 07.
- **Default-vote deadline / voting auto-timer** — not in scope of this ticket; `DAY_VOTING` is resolved manually via `resolveVoting`.
- **Host "extend Phase X by N seconds" UI affordances** — the server contract is in place; the client is ticket 11.

### Tests added

`test/engine.test.ts`:

- `PhaseTimer (pure)` (10): construction, REMINDER at configured marks, multi-mark ticks, EXPIRED consumes the timer, idempotent re-ticks, pause/resume + extend, snapshot, no-op zero-tick.
- `Engine — phase-timer lifecycle` (9): MAFIA_WINDOW arms at startGame, clears on mafiaKill and resolveNight; SPEECH_TURN arms + restarts per nextSpeaker; DEFENSE_TURN arms + restarts per nextDefense; DAY_VOTING has no timer.
- `Engine — phase-timer expiry reactions` (3): SPEECH_TURN expiry auto-advances + cascades through the round into DAY_DEFENSE; MAFIA_WINDOW expiry pauses indefinitely.
- `Engine — host phase overrides` (10): pause / resume / skip / extend semantics, host-only guards, MAFIA_WINDOW resume re-arms fresh window, skip MAFIA_WINDOW no-op, extend no-op without timer.

`test/mafia-room.test.ts` (Ticket 04 subsection, 8 tests):

- `startGame` arms the MAFIA_WINDOW in the engine (60s).
- `startSpeeches` arms SPEECH_TURN (60s); `resolveVoting` re-arms MAFIA_WINDOW (60s).
- Host can `pausePhase → resumePhase` (paused flag flips).
- Host can `extendPhase{seconds: 30}` (durationMs grows by 30s; remainingMs is at least the original duration).
- Host can `skipPhase` during DAY_SPEECHES (speech cursor advances).
- Non-host rejected for `pausePhase / resumePhase / skipPhase / extendPhase`.
- Mafia-window reminder at 30s elapsed is routed to the host as `timerReminder{mode, remainingSeconds: 30}`.
- Mafia-window reminders fire at both 30s and 50s elapsed in the same tick; each carries the spec-correct `remainingSeconds` for its mark.

### Verification

- `npx tsc -p tsconfig.build.json --noEmit` — clean.
- `npm test` — 133 passing, 0 failing.
