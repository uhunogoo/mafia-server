# 08: Voting edge cases + room-creation settings

**What to build:** Tie-handling for voting (2-way auto-pardon, 3+ way revote loop, configurable `revoteCap` with host arbitration per ADR 0006), plus the room-creation settings that expose these knobs. After `revoteCap` consecutive 3+ way revotes the server pauses and asks the host to decide between auto-pardon, force a candidate, or kick a player.

**Blocked by:** 03.

**Status:** ready-for-agent

- [ ] Room-creation accepts `revoteCap: number` (default 3) and `revoteBehavior: "host-arbitrates" | "auto-pardon"` (default "host-arbitrates").
- [ ] 2-way tie at any revote → auto-pardon, day ends, night falls.
- [ ] 3+ way tie → revote among all tied leaders.
- [ ] After `revoteCap` consecutive 3+ way revotes, the server pauses and asks the host to decide.
- [ ] Host can choose: auto-pardon, force a candidate, or kick a player (kick routes through ticket 06's path).
- [ ] When `revoteBehavior = "auto-pardon"`, any tie auto-pardons immediately with no host step.
- [ ] Test: 2-way tie → auto-pardon; 3-way tie → revote; 3+ revotes with 3+ way ties → host decision prompt; `revoteBehavior = "auto-pardon"` short-circuits.