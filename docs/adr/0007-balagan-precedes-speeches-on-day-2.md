# ADR 0007: BALAGAN precedes SPEECHES on Day 2+ (second deviation from rules.md)

- Status: Accepted
- Date: 2026-09-20

## Context

`rules.md` §3 orders the day as Announcement → Speeches → Debate → Defense → Voting. ADR 0005 recorded the first deviation (Day 1 omits BALAGAN) and, in listing the Day 2+ sequence, placed BALAGAN between speeches and defense. In live play the table's first reaction belongs before the structured round: players want to discuss the night's announcement before committing to speeches and the first-word nomination duty.

## Decision

On Day 2+, BALAGAN runs immediately after `DAY_ANNOUNCEMENT` and before `DAY_SPEECHES`:

- `DAY_ANNOUNCEMENT`
- `DAY_BALAGAN`
- `DAY_SPEECHES`
- `DAY_DEFENSE`
- `DAY_VOTING`

Day 1 is unchanged — no BALAGAN (ADR 0005 stands). BALAGAN remains a mechanics-free open discussion: no ordered turns, no nominations; the only valid nomination phase is `DAY_SPEECHES`, on all days. Durations and reminders are unchanged (90s, reminder at 60s).

The host's start-speeches control opens BALAGAN on Day 2+ (the message name is unchanged). The Day 2+ speaking roster freezes when speeches begin — after BALAGAN — not when the host opens the day: players who die during BALAGAN (kick, declare-dead) are excluded from the roster, and the first-word duty falls to the first alive seat clockwise from the anchor. The rotation anchor is the actual first speaker of the day.

## Rationale

- Reacting to the night before committing to positions matches the social flow of the table.
- BALAGAN carries no mechanics, so its position is the only degree of freedom; moving it costs nothing mechanically.
- Freezing the roster after BALAGAN keeps deaths out of the speech roster and the first-word duty on a living player; "seat clockwise from the previous day's first speaker" stays exact because the anchor is recorded at the freeze.

## Consequences

- Amends ADR 0005's stated Day 2+ sequence; its Day-1 exclusion is untouched.
- `startSpeeches` (room message unchanged) dispatches by `dayCount`: Day 2+ enters BALAGAN; an internal step enters speeches from BALAGAN expiry/skip.
- `nominate` closes its `DAY_BALAGAN` acceptance — valid in `DAY_SPEECHES` only (the acceptance was speculative future-proofing).
- `getSpeakingOrder()` returns an empty list during Day 2+ BALAGAN (roster not frozen yet); its only consumers are tests.
- Second recorded deviation from `rules.md` §3's order (after ADR 0005); the mechanics-free BALAGAN itself still aligns with §3.

## Alternatives considered

- **Keep BALAGAN after speeches (rules.md order)** — rejected: the table reacts to the night before speeches in practice.
- **Allow nominations during BALAGAN** — rejected: closes a speculative path; `rules.md` §3 adds candidates during speeches only.
- **Freeze the roster when the host opens the day** — rejected: a death during BALAGAN would leave a dead player in the roster and could pin the first-word duty on a player who can never nominate.
