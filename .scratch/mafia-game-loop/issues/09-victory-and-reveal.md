# 09: Victory + reveal

**What to build:** Civilian and Mafia victory detection via a single engine seam (`onPlayerDied`), transition to `GAME_OVER`, and broadcast role reveal to all players. The seam is called from every death source — night resolution, voting, kick, and `declareDead` — so victory logic lives in exactly one place. Phases do not each implement their own victory check.

**Blocked by:** 03, 06, 07, 08.

**Status:** complete

- [x] Engine exposes `onPlayerDied(player)` as the single seam for all death sources.
- [x] Night resolution (from ticket 01), voting (from ticket 03), kick (from ticket 06), and `declareDead` (from ticket 05) all call `onPlayerDied`.
- [x] Phases do not implement their own victory checks.
- [x] Civilian victory: all blacks (Mafia + Don) dead → `GAME_OVER`.
- [x] Mafia victory: living blacks ≥ living reds → `GAME_OVER` (immediate, even mid-day).
- [x] At `GAME_OVER`, every player's role is broadcast to every other player.
- [x] The engine state is locked after `GAME_OVER` (no further actions accepted).
- [x] Test: kill all mafia → `GAME_OVER` with civilian victory; reach parity → `GAME_OVER` with mafia victory mid-day; `GAME_OVER` state has all roles revealed; no actions accepted after `GAME_OVER`.