# 05: Disconnect pause + declareDead

**What to build:** When a player drops mid-phase, the phase pauses and the host is notified. The host can `declareDead` to mark the missing player dead and resume the phase. If the player returns, they stay marked dead (the 30s reconnect window has elapsed).

**Blocked by:** 04.

**Status:** ready-for-agent

- [x] A player who drops during a live phase causes the phase to pause.
- [x] The host receives a "player missing" notification with the sessionId.
- [x] Host can issue `declareDead{sessionId}` to mark the missing player dead and resume the phase.
- [x] The marked-dead player cannot perform actions if they reconnect.
- [x] `declareDead` routes through the engine's `onPlayerDied` seam so the victory check fires.
- [x] Test: drop → phase pauses and host is notified; `declareDead` → phase resumes with the player marked dead and routed through `onPlayerDied`.