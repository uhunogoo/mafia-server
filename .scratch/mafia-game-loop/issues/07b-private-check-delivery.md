# 07b: Private check delivery

**What to build:** Replace the Don and Sheriff check stubs from ticket 01 with private per-session delivery of the check result. The Don receives `donCheckResult{targetId, isSheriff}`; the Sheriff receives `sheriffCheckResult{targetId, team}` where the Don always reports as BLACK to the Sheriff. The public state must not leak that a check occurred.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Don's check resolves privately to the Don's session: `donCheckResult{targetId, isSheriff: boolean}`.
- [ ] Sheriff's check resolves privately to the Sheriff's session: `sheriffCheckResult{targetId, team: "RED" | "BLACK"}`.
- [ ] The Don always reports as BLACK to the Sheriff.
- [ ] Public state does not contain the fact that a check occurred (no `lastCheckedId`, no check history on the player).
- [ ] No other client can read another client's check result.
- [ ] Test: Don and Sheriff each receive their own result on their session; no other session receives either result; the target player is not notified of being checked.