# 01: Prefactor — extract the speeches-entry step out of `startSpeeches`

**What to build:** A pure internal refactor with zero behavior change. The work `startSpeeches` does to actually begin the speech round — freeze the speaking roster, record the rotation anchor, reset the first-word flag, point at the first speaker, arm the speech-turn timer, log `speeches_started` — moves into a private engine method (unguarded, like the other private phase-entry methods), and `startSpeeches` keeps the single public phase guard and delegates to it unconditionally on every day. Phases, timers, action-log entries, and all observable behavior stay bit-for-bit identical. This ticket exists to make ticket 02 easy: after it, the Day 2+ reorder's core edit is a three-line day-branch. Detailed shape: `.scratch/balagan-reorder/spec.md` §1a–1b.

**Blocked by:** None (can start immediately).

**Status:** complete

- [x] The speeches-entry step is a private engine method; `startSpeeches` validates the announcement phase and delegates to it on all days
- [x] **Zero test files touched — all 207 existing tests pass unchanged (this is the proof the refactor is behavior-neutral)**
- [x] Docstrings on both methods state the new split without claiming any Day 2+ behavior change yet
- [x] Type check clean
