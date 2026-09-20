# 08: Voting edge cases + room-creation settings

**What to build:** Tie-handling for voting (2-way auto-pardon, 3+ way revote loop, configurable `revoteCap` with host arbitration per ADR 0006), plus the room-creation settings that expose these knobs. After `revoteCap` consecutive 3+ way revotes the server pauses and asks the host to decide between auto-pardon, force a candidate, or kick a player.

**Blocked by:** 03.

**Status:** complete

- [x] **Remove the temporary tie-break from ticket 03** (deterministic "first in nomination order"). It was a placeholder; replace with the ADR 0003 behavior below. Update the ticket-03 tests that encoded the placeholder.
- [x] **Votes are immutable once cast.** A second `vote(actor, target)` from the same actor is rejected (rules.md: simultaneous voting). Re-vote support is explicitly out of scope. Add a test: duplicate vote submission is rejected.

- [x] Room-creation accepts `revoteCap: number` (default 3) and `revoteBehavior: "host-arbitrates" | "auto-pardon"` (default "host-arbitrates").
- [x] 2-way tie at any revote → auto-pardon, day ends, night falls.
- [x] 3+ way tie → revote among all tied leaders.
- [x] After `revoteCap` consecutive 3+ way revotes, the server pauses and asks the host to decide.
- [x] Host can choose: auto-pardon, force a candidate, or kick a player (kick routes through ticket 06's path).
- [x] When `revoteBehavior = "auto-pardon"`, any tie auto-pardons immediately with no host step.
- [x] Test: 2-way tie → auto-pardon; 3-way tie → revote; 3+ revotes with 3+ way ties → host decision prompt; `revoteBehavior = "auto-pardon"` short-circuits.
