# ADR 0005: Day 1 has no BALAGAN phase (deviation from rules.md)

- Status: Accepted (amended by ADR 0007 — Day 2+ position only; the Day-1 exclusion stands)
- Date: 2026-09-19

## Context

`rules.md` describes the day phase as "Announcement → Speeches → Debate → Defense → Voting" on every day, including Day 1. The user clarified that this project deviates: Day 1 (the day immediately after the Night 1 introduction) does not include the BALAGAN (debate) step.

## Decision

Day 1's phase sequence is:

- `DAY_ANNOUNCEMENT`
- `DAY_SPEECHES`
- `DAY_DEFENSE`
- `DAY_VOTING`

Day 2 onwards uses the full sequence:

- `DAY_ANNOUNCEMENT`
- `DAY_SPEECHES`
- `DAY_BALAGAN`
- `DAY_DEFENSE`
- `DAY_VOTING`

## Rationale

- Night 1 is the test night (no kills). There is no victim to discuss on Day 1.
- Forcing an empty debate wastes 1–2 minutes of player time and adds nothing to the deduction loop.
- Players can still raise suspicions during `DAY_SPEECHES` if they want.

## Consequences

- The phase state machine has a `dayCount`-aware branch for `DAY_BALAGAN`.
- The GamePhase enum retains `DAY_BALAGAN` as a valid phase; it is simply skipped on Day 1.
- Tests for the day-phase state machine must cover both branches.

## Alternatives considered

- **Follow rules.md exactly** — always run BALAGAN. Rejected: empty debate is wasted time.
- **Replace BALAGAN with a shorter "ice-breaker" round** — adds a new phase type just for Day 1, complicates the state machine for no clear gain.

## Amendment (2026-09-20)

ADR 0007 moves `DAY_BALAGAN` before `DAY_SPEECHES` on Day 2+ and closes nominations during BALAGAN. The decision recorded here — Day 1 has no BALAGAN — is unaffected. The Day 2+ sequence listed above is superseded by ADR 0007.