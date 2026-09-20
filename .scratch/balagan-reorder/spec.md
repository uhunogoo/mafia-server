# Spec: BALAGAN reorder — single behavior change (mafia-server)

- **Date:** 2026-09-20
- **Branch (grounded on):** `step-0-foundation`
- **Status:** approved spec — ready for `to-tickets` / implementation
- **One change:** on Day 2+, `DAY_BALAGAN` moves before `DAY_SPEECHES`. Nothing else.

## Scope guard

No module extraction (PhaseOrchestrator / DayCycle — separate track), no enum moves,
no renames of the room→engine interface, no timer duration changes, no night logic,
no voting mechanics, no client work. Closed topics: nominations during BALAGAN,
alternative phase orders, action naming.

## Settled decisions

Frozen (from the commissioning brief — context, not questions):

1. **Day 2+ sequence:** `ANNOUNCEMENT → BALAGAN → SPEECHES → DEFENSE → VOTING`.
   **Day 1 unchanged:** `ANNOUNCEMENT → SPEECHES → DEFENSE → VOTING`, no BALAGAN
   (ADR 0005's Day-1 exclusion stands; its rationale is position-independent).
2. **BALAGAN semantics:** pure free discussion — no turns, no nominations, no
   mechanics. Duration and reminders unchanged (90s, reminder at 60s —
   `src/game/types.ts:26`).
3. **Nominations:** valid during `DAY_SPEECHES` only, on all days. The current
   `nominate` acceptance of `DAY_BALAGAN` closes (it was speculative
   future-proofing; rules.md §3 adds candidates during speeches only).
4. **First-word rule verbatim:** Day 2+, the first speaker of `DAY_SPEECHES` must
   personally nominate by the end of their speech. Rotation anchor: seat clockwise
   from the previous day's first speaker. The gate in `nextSpeaker` moves unchanged.
5. **Interface frozen:** no renames. `startSpeeches` stays `startSpeeches` (on
   Day 2+ it enters BALAGAN; docstrings state this). `MafiaRoom → Engine` message
   set unchanged — docstring updates only.

Resolved in the grilling session (2026-09-20):

6. **Q1 — late roster freeze.** The Day 2+ speaking order freezes when speeches
   begin (in the new `enterDaySpeeches`, after BALAGAN), not when the host opens
   the day. `computeSpeakingOrder` filters `isAlive` at that moment, so deaths
   during BALAGAN (kick, declare-dead) leave the roster, and the first-word duty
   falls to the first alive seat clockwise from the anchor. This preserves the
   invariant "roster frozen when speeches begin" and does not widen the existing
   first-speaker-kicked-mid-speech soft-lock window.
7. **Q1 addendum — anchor exactness.** `firstSpeakerId` is recorded at the
   `enterDaySpeeches` freeze (post-BALAGAN), so the next day's rotation anchor is
   the **actual** first speaker of today — including the case where the player at
   the anchor seat died during BALAGAN and the first alive seat after the anchor
   opened the day. The rule "seat clockwise from the previous day's first speaker"
   stays exact under late freeze. (`computeSpeakingOrder` already anchors on the
   seatIndex, which is held for the game's lifetime even after death or kick —
   `Engine.ts:1477-1480`.)
8. **Q2 — internal shape.** `startSpeeches` keeps the single public guard
   (`requirePhase(DAY_ANNOUNCEMENT)`) and becomes a `dayCount` dispatcher:
   Day 2+ → `enterDayBalagan()`, Day 1 → `enterDaySpeeches()`. The new private
   `enterDaySpeeches` carries the current `startSpeeches` body and takes **no
   phase guard** — private, two known callers, consistent with the unguarded
   `enterDayDefense` / `enterDayBalagan`.
9. **Q3 — this spec lives at `.scratch/balagan-reorder/spec.md`** (this file).
10. **Q4 — docs sweep boundary.** spec.md:226's ADR range extends to 0007; the
    position-neutral user stories at spec.md:13 and :32 are left untouched.
11. **Day 1 byte-identical claim (assertion, not assumption).** Day 1 has no
    BALAGAN, so `startSpeeches` → `enterDaySpeeches` directly and the roster
    freezes at the same wall-clock moment as today. Day 1 behavior is unchanged
    line-for-line; the Day 1 test diff must be empty except shared walk helpers.

## Grounding references

- `rules.md` §3 — debate is open argument; candidates are added during speeches.
  The reorder deviates from §3's stated order (recorded in ADR 0007); the
  mechanics-free BALAGAN aligns with it.
- `docs/adr/0005-no-balagan-on-day-1.md` — Day-1 exclusion, kept.
- `.scratch/mafia-game-loop/spec.md` — contains the stale order (:128, :162).
- Facts verified on `step-0-foundation`: `DAY_ANNOUNCEMENT` has no timer — the
  host advances via `startSpeeches` (`Engine.ts:676`, `MafiaRoom.ts:151`);
  `kick` and `declareDead` work in any active phase (`Engine.ts:2016`, `:1930`);
  `getSpeakingOrder()` has no live consumers (tests only); the room layer maps
  `WRONG_PHASE` to the Ukrainian client error string.

---

## 1. Exact change list

All line anchors are current-branch (`step-0-foundation`) and indicative.

### `src/game/Engine.ts`

**a. `startSpeeches` (:883-909) — becomes the day dispatcher.**

Before: `requirePhase(DAY_ANNOUNCEMENT)` + the full body (freeze roster, record
anchor, reset flag, set phase, arm `SPEECH_TURN`, log `speeches_started`).

After:

```ts
startSpeeches(): void {
  this.requirePhase(GamePhase.DAY_ANNOUNCEMENT);
  if (this.state.dayCount >= 2) {
    this.enterDayBalagan();
  } else {
    this.enterDaySpeeches();
  }
}
```

Docstring: opens the day after the announcement. Day 1 → speeches directly.
Day 2+ → BALAGAN first (ADR 0007); speeches begin when BALAGAN ends (timer
expiry or host skip), and the roster freezes at that point — not here.

**b. NEW private `enterDaySpeeches` (placed beside `enterDayBalagan`, ~:1548).**

Exactly the current `startSpeeches` body (:886-908), unchanged:

```ts
private enterDaySpeeches(): void {
  this.speakingOrder = this.computeSpeakingOrder();
  this.firstSpeakerId = this.speakingOrder[0] ?? "";
  this.firstSpeakerNominated = false;
  this.currentSpeakerIndex = this.speakingOrder.length === 0 ? -1 : 0;
  this.state.phase = GamePhase.DAY_SPEECHES;
  this.state.currentSpeakerId = this.getCurrentSpeaker();
  this.state.currentDefenseId = "";
  if (this.speakingOrder.length > 0) {
    this.startTimer("SPEECH_TURN");
  } else {
    this.clearTimer();
  }
  this.logEntry({ actorSessionId: "", type: ActionType.PHASE_ADVANCE,
    payload: { event: "speeches_started", speakerCount: this.speakingOrder.length } });
}
```

No phase guard (decision 8). Docstring: entered from `DAY_ANNOUNCEMENT` (Day 1,
via `startSpeeches`) or `DAY_BALAGAN` (Day 2+, via `onTimerExpired`/`skipPhase`).
This is the roster freeze point (decision 6): `computeSpeakingOrder` runs here,
post-BALAGAN on Day 2+, so BALAGAN deaths are excluded and the rotation anchor
recorded here is the actual first speaker of the day (decision 7).

**c. `nextSpeaker` (:924-955) — end-of-speeches branch loses the day split.**

Before (:940-951): index advance; when done → `clearTimer()`, then
`dayCount >= 2 ? enterDayBalagan() : enterDayDefense()`.

After: when done → `clearTimer(); this.enterDayDefense();` — on all days.

The first-word gate (:929-938) is **code-unchanged** (decision 4). Docstring
updates only: "auto-transition to DAY_DEFENSE on all days", and the first-word
paragraph re-aimed — the speech round cannot end (the advance to DAY_DEFENSE is
blocked) until the first speaker fulfils the nomination requirement.

**d. `enterDayBalagan` (:1548-1567) — docstring only, body unchanged.**

New docstring: entered from `DAY_ANNOUNCEMENT` via `startSpeeches` (Day 2+ only —
Day 1 skips BALAGAN per ADR 0005). Arms the 90s BALAGAN timer; expiry
auto-transitions to `DAY_SPEECHES` (see `onTimerExpired`), and the host can
`skipPhase` to open speeches early. `nominate` is **not** valid during BALAGAN
(ADR 0007 — the phase guard accepts `DAY_SPEECHES` only).

**e. `onTimerExpired` (:1713-1736) — BALAGAN case retargets.**

Before (:1723-1728): `case "BALAGAN": … this.enterDayDefense();`
After: `this.enterDaySpeeches();` — comment and the docstring bullet (:1709)
updated ("BALAGAN → enter DAY_SPEECHES (Day 2+ only — Day 1 never arms BALAGAN)").

**f. `skipPhase` (:1787-1816) — BALAGAN case retargets.**

Before (:1810-1814): `case "BALAGAN": … this.enterDayDefense();`
After: `this.enterDaySpeeches();` — comment updated (skipping the debate opens
speeches).

**g. `nominate` (:831-841) — guard drops `DAY_BALAGAN`.**

Before: compound `phase !== DAY_SPEECHES && phase !== DAY_BALAGAN` check; error
message "nominate requires phase DAY_SPEECHES or DAY_BALAGAN, currently …".

After: `this.state.phase !== GamePhase.DAY_SPEECHES` alone; error message
"nominate requires phase DAY_SPEECHES, currently ${this.state.phase}". Docstring
(:822-825): valid during `DAY_SPEECHES` only, on all days; nominations during
`DAY_BALAGAN` are rejected (ADR 0007). The first-word credit clause
(:859-861) is unchanged.

**h. `enterDayDefense` (:1522-1527) — docstring only.**

Entered when the speech round ends, on every day (Day 2+ no longer reaches
defense from BALAGAN expiry/skip — those routes now open speeches). Code unchanged.

**i. Docstring sweep (order/freeze references), code unchanged:**

- :66 and :103-105 — class-header day-sequence and slice-7 comments: Day 2+
  opens with BALAGAN between the announcement and speeches.
- :190-194 (`speakingOrder` field) — recomputed each day when speeches begin
  (`enterDaySpeeches`, post-BALAGAN on Day 2+); players who die during speeches
  stay in the list; players who die during BALAGAN are excluded because the
  roster is computed after it.
- :221-227 (`firstSpeakerId`) — updated by `enterDaySpeeches`; anchor is the
  actual first speaker of the day (decision 7).
- :229-235 (`firstSpeakerNominated`) — reset by `enterDaySpeeches`.
- :371 (`getSpeakingOrder`) — frozen when speeches begin; returns `[]` during
  Day 2+ BALAGAN, before the freeze (test-only consumers).

### `src/rooms/MafiaRoom.ts`

**j. `startSpeeches` handler (:151-153) — docstring only.** On Day 2+ the host's
press opens BALAGAN (ADR 0007); on Day 1 it starts speeches directly. Message
name and routing unchanged (decision 5).

### Log entries

No new event kinds. On Day 2+ the host-only action log now records
`balagan_started` before `speeches_started` (previously the reverse). Note in
passing: no test asserts the relative order of this pair today.

---

## 2. Test plan

### `test/engine.test.ts` — changed

| Anchor | Current | Becomes |
|---|---|---|
| :2620 | describe title "Day 2+ phase sequence (BALAGAN between speeches and defense)" | "…(BALAGAN precedes speeches)" |
| :2621 | "Day 2 final nextSpeaker auto-transitions to DAY_BALAGAN (not DAY_DEFENSE)" | "Day 2 startSpeeches enters DAY_BALAGAN (not DAY_SPEECHES)": after `driveDay1`+`driveNight2`+`startSpeeches()` → phase `DAY_BALAGAN`, timer armed (mode `BALAGAN`, 90 000 ms), and `getSpeakingOrder()` is `[]` (pre-freeze) |
| :2639 | "BALAGAN timer expiry auto-transitions to DAY_DEFENSE" | expiry (fake clock, t=91s) → `DAY_SPEECHES`, roster frozen at that moment (`getSpeakingOrder()[0] === "p1"`, `getCurrentSpeaker() === "p1"`, `SPEECH_TURN` armed) |
| :2666 | "host skipPhase during BALAGAN advances to DAY_DEFENSE" | skip → `DAY_SPEECHES`, `SPEECH_TURN` armed |
| :2685 | Day 1 skips BALAGAN, final nextSpeaker → DAY_DEFENSE | **unchanged, byte-for-byte** — this is the Day 1 regression assertion (decision 11) |
| :2706 | "nominate is still allowed during DAY_BALAGAN (existing phase guard)" | inverted: "nominate is rejected during DAY_BALAGAN" — in BALAGAN, `nominate` throws `WRONG_PHASE` (message names `DAY_SPEECHES` only), `nominations` unchanged, phase unchanged |
| :2721 | full Day 2 cycle walk (speeches → BALAGAN → …) | reordered walk: `startSpeeches` → BALAGAN → `skipPhase` → `DAY_SPEECHES` → first speaker nominates → drive speakers (last `nextSpeaker` → `DAY_DEFENSE`) → defenses → voting → `resolveVoting` → NIGHT, dayCount 2; title "(BALAGAN → SPEECHES → DEFENSE → VOTING → NIGHT)" |
| :2440-2454 | `driveDay2` helper | new shape: `startSpeeches()` (→ BALAGAN) → `skipPhase("host")` (→ SPEECHES) → `nominate("p1","p6")` → drive speakers → defenses → `resolveVoting()` |
| :2395-2421 | `driveDay1` helper | **unchanged** (Day 1 byte-identical) |
| :1390-1399 | revote-reset test (ticket 08 describe), Day 2 walk | `startSpeeches` → `skipPhase` → nominates → drive speakers → `DAY_DEFENSE` directly (drop the mid-walk BALAGAN assertions) |
| :3196-3201 | victory two-day test, Day 2 segment | `startSpeeches` → BALAGAN assert moves before `skipPhase` → self-nomination → speakers → defense |
| :2471, :2488, :2511 | rotation tests | insert the BALAGAN hop (`skipPhase`) between each Day 2+ `startSpeeches` and the first-speaker assertions; **expected values unchanged** — anchor semantics are untouched (decision 7) |
| :631-800 | Day 1 describe block | **no edits — acceptance bar: empty diff** |

### `test/engine.test.ts` — new

- **N1 — kick during BALAGAN leaves the roster (late freeze).** After
  `driveDay1` + `driveNight2` (anchor = p0, Day 2 opener would be p1):
  `startSpeeches()` → BALAGAN → assert `getSpeakingOrder()` is `[]` →
  - *opener-death variant:* `kick("host","p1")` → `skipPhase` →
    `getSpeakingOrder()[0] === "p2"`, `getCurrentSpeaker() === "p2"`, roster
    excludes p1; first-word duty binds to p2 — `nextSpeaker()` without p2's
    nomination throws `WRONG_PHASE`; after `nominate("p2","p6")` it advances.
  - *anchor-death variant:* `kick("host","p0")` → `skipPhase` → opener is still
    p1 (rotation anchors on p0's seatIndex, held after death — `Engine.ts:1477`);
    drive the day; on Day 3 the rotation anchors on p1 (Day 2's actual opener).
- **N2 — declareDead during BALAGAN leaves the roster.** Using the existing
  engine `declareDead` test helper (as at :3224) mid-BALAGAN, then expiry/skip →
  `enterDaySpeeches` computes the order without the declared-dead player.

### `test/mafia-room.test.ts` — changed

| Anchor | Current | Becomes |
|---|---|---|
| :1587 | "Day 2 first speaker without a nomination is rejected … WRONG_PHASE" | insert the BALAGAN hop between `startSpeeches` and the assertions: `startSpeeches` → `skipPhase` → `DAY_SPEECHES` → first speaker guests[1] → `nextSpeaker` without nomination → Ukrainian WRONG_PHASE string, phase stays `DAY_SPEECHES` |
| :1626 | "…nextSpeaker advances to DAY_BALAGAN with the 90s timer armed" | repurposed: `startSpeeches` → `DAY_BALAGAN` + timer (mode, 90 000 ms, not paused) → `skipPhase` → speeches → guests[1] nominates → last `nextSpeaker` → `DAY_DEFENSE` |
| :1661 | "host can skipPhase during DAY_BALAGAN and the room advances into DAY_DEFENSE" | skip → `DAY_SPEECHES` (+ `SPEECH_TURN` armed) |
| :1689 | Day 3 rotation test | Day 2 segment reordered: BALAGAN hop before the nomination and speech drive |
| :1824-1868 | "nominate during DAY_BALAGAN is accepted (… cured before defense)" | **replaced** — its premise dies (BALAGAN now precedes speeches; the first-word failure happens after it). New: "nominate during DAY_BALAGAN is rejected": drive to BALAGAN, guests[3] sends `nominate` → sender receives the Ukrainian WRONG_PHASE error, `nominations` stays length 1, phase stays `DAY_BALAGAN` |
| :2331-2342 | victory two-day walk, Day 2 segment | BALAGAN hop reorder as above |

### `test/mafia-room.test.ts` — new

- **R1 — declareDead during BALAGAN (room layer).** Drive to Day 2 BALAGAN →
  simulate a guest drop (ticket-05 drop helper, `mafia-room.test.ts:645`) →
  assert the BALAGAN timer is paused → host `declareDead` → `skipPhase` →
  `DAY_SPEECHES` with the roster excluding the declared-dead player and the
  first-word duty on the actual opener.

---

## 3. Docs

### ADR 0007 (new file: `docs/adr/0007-balagan-precedes-speeches-on-day-2.md`)

```markdown
# ADR 0007: BALAGAN precedes SPEECHES on Day 2+ (second deviation from rules.md)

- Status: Accepted
- Date: 2026-09-20

## Context

rules.md §3 orders the day as Announcement → Speeches → Debate → Defense →
Voting. ADR 0005 recorded the first deviation (Day 1 omits BALAGAN) and, in
listing the Day 2+ sequence, placed BALAGAN between speeches and defense. In
live play the table's first reaction belongs before the structured round:
players want to discuss the night's announcement before committing to speeches
and the first-word nomination duty.

## Decision

On Day 2+, BALAGAN runs immediately after DAY_ANNOUNCEMENT and before
DAY_SPEECHES:

- `DAY_ANNOUNCEMENT`
- `DAY_BALAGAN`
- `DAY_SPEECHES`
- `DAY_DEFENSE`
- `DAY_VOTING`

Day 1 is unchanged — no BALAGAN (ADR 0005 stands). BALAGAN remains a
mechanics-free open discussion: no ordered turns, no nominations; the only valid
nomination phase is DAY_SPEECHES, on all days. Durations and reminders are
unchanged (90s, reminder at 60s).

The host's start-speeches control opens BALAGAN on Day 2+ (the message name is
unchanged). The Day 2+ speaking roster freezes when speeches begin — after
BALAGAN — not when the host opens the day: players who die during BALAGAN (kick,
declare-dead) are excluded from the roster, and the first-word duty falls to the
first alive seat clockwise from the anchor. The rotation anchor is the actual
first speaker of the day.

## Rationale

- Reacting to the night before committing to positions matches the social flow
  of the table.
- BALAGAN carries no mechanics, so its position is the only degree of freedom;
  moving it costs nothing mechanically.
- Freezing the roster after BALAGAN keeps deaths out of the speech roster and
  the first-word duty on a living player; "seat clockwise from the previous
  day's first speaker" stays exact because the anchor is recorded at the freeze.

## Consequences

- Amends ADR 0005's stated Day 2+ sequence; its Day-1 exclusion is untouched.
- `startSpeeches` (room message unchanged) dispatches by `dayCount`: Day 2+
  enters BALAGAN; an internal step enters speeches from BALAGAN expiry/skip.
- `nominate` closes its DAY_BALAGAN acceptance — valid in DAY_SPEECHES only
  (the acceptance was speculative future-proofing).
- `getSpeakingOrder()` returns an empty list during Day 2+ BALAGAN (roster not
  frozen yet); its only consumers are tests.
- Second recorded deviation from rules.md §3's order (after ADR 0005); the
  mechanics-free BALAGAN itself still aligns with §3.

## Alternatives considered

- **Keep BALAGAN after speeches (rules.md order)** — rejected: the table reacts
  to the night before speeches in practice.
- **Allow nominations during BALAGAN** — rejected: closes a speculative path;
  rules.md §3 adds candidates during speeches only.
- **Freeze the roster when the host opens the day** — rejected: a death during
  BALAGAN would leave a dead player in the roster and could pin the first-word
  duty on a player who can never nominate.
```

### ADR 0005 — status note appended (body not rewritten)

Status line becomes:

```markdown
- Status: Accepted (amended by ADR 0007 — Day 2+ position only; the Day-1 exclusion stands)
```

Appended at the end of the file:

```markdown
## Amendment (2026-09-20)

ADR 0007 moves `DAY_BALAGAN` before `DAY_SPEECHES` on Day 2+ and closes
nominations during BALAGAN. The decision recorded here — Day 1 has no BALAGAN —
is unaffected. The Day 2+ sequence listed above is superseded by ADR 0007.
```

### `CONTEXT.md` — reordered Phases section (full replacement text)

```markdown
## Phases

The game is a cycle. `LOBBY` precedes the cycle; `GAME_OVER` terminates it.

- **LOBBY** — players join, host configures.
- **NIGHT** — silent actions in fixed order: Mafia → Don → Sheriff → Doctor. Ends when all living role-bearers have acted or the night window closes.
- **DAY_ANNOUNCEMENT** — host announces who died (or no one).
- **DAY_BALAGAN** — open debate (1–2 min). Present only from Day 2 onward (see ADR 0005); on Day 2+ it runs after the announcement and before speeches (see ADR 0007).
- **DAY_SPEECHES** — clockwise speeches (1 min each). Day ≥2: first speaker must nominate.
- **DAY_DEFENSE** — each nominated candidate defends (30 sec).
- **DAY_VOTING** — simultaneous vote for candidates (no abstention; default vote = last speaker if no input).
- **GAME_OVER** — terminal; final roles revealed.
```

### `.scratch/mafia-game-loop/spec.md` — order fixes

- **:128** → `` `GamePhase` day-phase order is fixed. Day 2+: `DAY_ANNOUNCEMENT → DAY_BALAGAN → DAY_SPEECHES → DAY_DEFENSE → DAY_VOTING`; Day 1 omits `DAY_BALAGAN`. ADR 0005, ADR 0007. ``
- **:162** → `` Day 1's sequence is `DAY_ANNOUNCEMENT → DAY_SPEECHES → DAY_DEFENSE → DAY_VOTING`. Day 2+ runs `DAY_ANNOUNCEMENT → DAY_BALAGAN → DAY_SPEECHES → DAY_DEFENSE → DAY_VOTING` — BALAGAN precedes speeches (ADR 0007). ``
- **:226** — extend the locked-decisions sentence with "BALAGAN before speeches
  on Day 2+" and the ADR range to "through `docs/adr/0007`" (decision 10).
- **:13 and :32** — untouched (position-neutral user stories).
- Full-text sweep for any other stale order references; none other known.

### `.scratch/mafia-game-loop/issues/07-day-2-plus-balagan-and-first-word.md` — revision note appended

```markdown
---

## Revision 2026-09-20 — BALAGAN moved before speeches (ADR 0007)

The Day 2+ sequence is now `ANNOUNCEMENT → BALAGAN → SPEECHES → DEFENSE →
VOTING`; the work recorded above placed BALAGAN between speeches and defense.
The first-word rule, the rotation anchor, and the Day-1 exclusion are unchanged.
The speculative `nominate`-during-BALAGAN acceptance was closed (nominations are
valid in `DAY_SPEECHES` only). Tests were re-pointed per
`.scratch/balagan-reorder/spec.md`. This note appends; the completed work above
is not rewritten.
```

---

## 4. Edge-case sweep (every path branching on DAY_BALAGAN or the order)

| Path | Verdict | Why |
|---|---|---|
| `nominate` phase guard | **changed** | drops `DAY_BALAGAN`; DAY_SPEECHES only on all days (frozen decision 3) |
| `startSpeeches` | **changed** | day-branch dispatcher; Day 2+ opens BALAGAN |
| `enterDaySpeeches` | **new** | old `startSpeeches` body; the roster freeze point (late, post-BALAGAN) |
| `nextSpeaker` end branch | **changed** | no day split; speeches → DEFENSE on all days |
| `nextSpeaker` first-word gate | **unchanged** (code) | binds end-of-first-speech exactly as before; only docstring BALAGAN references change |
| `onTimerExpired` BALAGAN case | **changed** | expiry → `enterDaySpeeches` |
| `skipPhase` BALAGAN case | **changed** | skip → `enterDaySpeeches` |
| `enterDayBalagan` | body **unchanged** | same phase/timer/log; only entry caller and docstring change (now entered from `startSpeeches`, not `nextSpeaker`) |
| `enterDayDefense` | **unchanged** (code) | docstring only — entered from speeches end on all days |
| `computeSpeakingOrder` | code **unchanged**, timing **changed** | runs at `enterDaySpeeches` (post-BALAGAN on Day 2+) — filters BALAGAN deaths; anchor semantics identical |
| `firstSpeakerId` / `firstSpeakerNominated` | **moved** | recorded/reset at the freeze; observable semantics unchanged — anchor = actual first speaker (decisions 6-7) |
| `resolveVoting` last-speaker default | **unchanged** | roster is frozen before voting in both orders; `speakingOrder[length-1]` exists either way |
| `ping` | **unchanged** | guard rejects only LOBBY/GAME_OVER (NIGHT has the mafia-only rule); any `DAY_*` phase passes — position-independent |
| `getCurrentSpeaker` / `getCurrentDefense` | **unchanged** | phase-gated accessors; return `""` outside their phase, including during BALAGAN, in both orders |
| `getSpeakingOrder` | **changed** (documented) | `[]` during Day 2+ BALAGAN (pre-freeze); test-only consumers |
| `pausePhase` / `resumePhase` / `extendPhase` | **unchanged** | operate on the timer mode, not the phase position |
| disconnect pause + `declareDead` | **unchanged** | any-phase semantics; a mid-BALAGAN drop pauses the BALAGAN timer; declareDead resumes — now with roster consequences handled by the late freeze |
| `kick` / victory funnel | **unchanged** | any-phase; `handlePlayerDied` → victory check can end the game mid-BALAGAN exactly as it can mid-speeches today |
| `resetDayState` | **unchanged** | deliberately preserves `firstSpeakerId` across days (anchor carry) |
| `enums.ts:8` comment | **unchanged** | position-neutral ("free debate 1-2 min; skipped on Day 1") |
| `MafiaRoom` handlers | **unchanged** (code) | docstring only (frozen decision 5); Ukrainian WRONG_PHASE client message reused by the nominate-during-BALAGAN rejection |
| Action-log sequence | **changed** (noted) | Day 2+ now logs `balagan_started` before `speeches_started`; host-only log, no test asserts the pair's order |

---

## 5. Acceptance criteria

1. `npx tsc -p tsconfig.build.json --noEmit` clean; full `npm test` green
   (baseline 217 passing; count shifts by the replaced/added tests).
2. **Day 1 diff is empty**: the engine Day 1 describe (:631-800), the Day 1 room
   tests, `driveDay1`, and the :2685 test are untouched; any edit reaching them
   is a defect (decision 11).
3. New behavior asserted: BALAGAN entry at `startSpeeches` (Day 2+), expiry and
   skip → `DAY_SPEECHES`, nominate-during-BALAGAN rejected at both layers,
   death-during-BALAGAN leaves the roster (kick + declareDead), anchor = actual
   first speaker across days, `getSpeakingOrder() === []` during BALAGAN.
4. Grep sweep: no "between speeches and defense" or old-order references remain
   in `src/`, `test/`, `CONTEXT.md`, or `.scratch/mafia-game-loop/spec.md` —
   except ADR 0005's body and issue 07's original body, which are intentionally
   preserved as history.
5. ADR 0007, the ADR 0005 status note, the CONTEXT.md reorder, the spec.md
   fixes, and the issue-07 revision note land in the same change set as the code.
