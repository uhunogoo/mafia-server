# 07: Day 2+ BALAGAN + first-word rule

**What to build:** From Day 2 onward, the BALAGAN phase runs between `DAY_SPEECHES` and `DAY_DEFENSE`. The first speaker on Day 2+ must nominate an elimination candidate during their speech; the server rejects speeches that end without a nomination from the first speaker. The first-word right shifts clockwise each day.

**Blocked by:** 03.

**Status:** ready-for-agent

- [ ] Day 2+ phase sequence is `ANNOUNCEMENT → SPEECHES → BALAGAN → DEFENSE → VOTING`.
- [ ] Day 1 still skips BALAGAN (per ADR 0005).
- [ ] The first speaker on Day 2+ must nominate an elimination candidate during their speech.
- [ ] Server rejects a speech that ends without a nomination from the first speaker on Day 2+.
- [ ] First-word right shifts clockwise each day.
- [ ] Test: Day 2 first speech without a nomination is rejected; Day 1 first speech without a nomination is accepted; Day 3 first speaker is the seat after Day 2's first speaker.