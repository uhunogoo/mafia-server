# 04: Phase timers + host overrides

**What to build:** Auto-advancing phase timers plus host override controls (pause, resume, skip, extend). The mafia window has 60 seconds with reminders at 30s and 50s; speech uses 60s, defense uses 30s, BALAGAN uses 1–2 minutes. Host overrides preempt the timer.

**Blocked by:** 03.

**Status:** ready-for-agent

- [ ] Each phase has a server-side timer that auto-advances when expired.
- [ ] The mafia window is 60s with reminders at 30s and 50s.
- [ ] `DAY_SPEECHES` uses 60s per speaker.
- [ ] `DAY_DEFENSE` uses 30s per candidate.
- [ ] `DAY_BALAGAN` uses 1–2 minutes.
- [ ] Host can `pause` the current phase timer.
- [ ] Host can `resume` a paused phase.
- [ ] Host can `skipPhase` to jump to the next phase.
- [ ] Host can `extendPhase{seconds}` to add time to the current phase.
- [ ] Test: a phase timer fires and advances the phase; host overrides preempt the timer (pause → no auto-advance; skip → immediate transition; extend → timer extended).