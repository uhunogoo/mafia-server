# 03: Day-1 basic flow

**What to build:** A full Day 1 cycle from announcement through voting. Speeches proceed clockwise, nominated candidates get a defense window, and voting picks a single winner (no abstention; default vote = last speaker). Day 1 skips BALAGAN (per ADR 0005). The first-word rule (first speaker must nominate) is enforced starting Day 2 — that's ticket 07.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] `DAY_ANNOUNCEMENT` shows who died last night (or "no one died").
- [ ] `DAY_SPEECHES` proceeds clockwise from the first speaker.
- [ ] `DAY_DEFENSE` gives each nominated candidate a 30-second window.
- [ ] `DAY_VOTING` accepts votes for any nominated candidate; no abstention.
- [ ] Default vote (no input by the deadline) is the last speaker.
- [ ] Single-winner voting: the candidate with the most votes is eliminated.
- [ ] Day 1 phase sequence is `ANNOUNCEMENT → SPEECHES → DEFENSE → VOTING` (no BALAGAN).
- [ ] After voting, the loser is marked dead and the engine transitions to the next NIGHT.
- [ ] The eliminated player's death is routed through the engine's `onPlayerDied` seam (so victory check can fire from a follow-up ticket).
- [ ] Test: a full Day 1 cycle ends with the correct player eliminated and the engine in NIGHT phase.