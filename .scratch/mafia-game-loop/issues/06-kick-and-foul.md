# 06: Kick + foul

**What to build:** Host moderation actions. `kick` ejects a player from the game (marks them dead and reduces them to a read-only spectator); `foul` records a warning in the host action log without affecting the player's game state. Both are moderation actions, not phase-flow — kept separate from the phase timers (ticket 04).

**Blocked by:** 03.

**Status:** ready-for-agent

- [ ] Host can issue `kick{sessionId, reason}` to mark a player dead and reduce them to a read-only spectator.
- [ ] Kicked players stay connected and observe public day-phase state but cannot send anything.
- [ ] Host can issue `foul{sessionId, reason}` to log a foul without affecting the player's game state.
- [ ] Both actions are logged in the host action log.
- [ ] The engine's `onPlayerDied` seam is called for kicks (so victory check fires).
- [ ] Test: kick → player `isAlive = false`, can read state, cannot send actions; foul → log entry only, player state unchanged.