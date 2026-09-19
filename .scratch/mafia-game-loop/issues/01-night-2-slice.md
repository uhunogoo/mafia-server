# 01: Night-2 vertical slice

**What to build:** A playable Night 2 — roles are assigned from the distribution table, the host submits the mafia victim, the Doctor heals (with the consecutive-night restriction), and the night resolves to `state.died`. Don and Sheriff checks are accepted but stubbed (their results aren't yet delivered privately — that comes in ticket 07b). The public schema no longer carries `Player.role` or `Player.team`.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] Roles are assigned per the distribution table for 9, 10, and 11 players.
- [x] `Player.role` and `Player.team` are not present in the public schema; the canonical store is a server-side map.
- [x] Host submits the mafia victim via a host-only `mafiaKill{targetId}` message.
- [x] Doctor submits a heal via `doctorHeal{targetId}`.
- [x] Server hard-rejects a `doctorHeal` whose targetId equals the Doctor's last healed target; the Doctor must pick again.
- [x] Don and Sheriff check actions are accepted but stubbed (recorded, not yet resolved privately — replaced in 07b).
- [x] Night resolution: if the heal target equals the mafia victim, `state.died` is empty; otherwise `state.died` equals the victim.
- [x] Engine rejects day-phase actions while in `NIGHT`, and night actions while in any `DAY_*` phase.
- [x] Test: mafia kills X, doctor heals X → `state.died === ""`.
- [x] Test: mafia kills X, doctor does not heal → `state.died === X`.
- [x] Test: `state.players` contains no `role` or `team` field after game start.

## Answer

Implemented the Night-2 vertical slice in `src/game/Engine.ts` (pure logic) wired through `src/rooms/MafiaRoom.ts` (transport layer).

**Engine** owns the canonical role/team map (`Map<sessionId, PlayerIdentity>`), the host-only action log, the Doctor's `lastHealed` map, and the per-night action buffer. Slice-1 implements:
- `startGame()` — assigns roles from `ROLE_DISTRIBUTION` for 9/10/11 players, transitions LOBBY → NIGHT with `nightStep = MAFIA`.
- `mafiaKill(host, targetId)` — host-only; stores victim and logs the action.
- `donCheck` / `sheriffCheck` — actor must be the right role, target must be alive & different, recorded but not yet privately delivered (ticket 07b).
- `doctorHeal(actor, targetId)` — actor must be Doctor, target must be alive, hard-rejects when `targetId === lastHealed[actor]`.
- `resolveNight()` — `state.died = victim !== "" && victim !== heal ? victim : ""`, stores Doctor's heal as the next night's restriction, clears the per-night buffer.

Phase guard: every action calls `requirePhase(GamePhase.NIGHT)` so day-phase messages fail with `WRONG_PHASE`.

**Room** translates each client message to an engine call, catches `EngineError` and forwards a player-visible string to `client.send("error", …)`. After `startGame`, the room sends a private `yourRole{role, team}` to each non-host client (the host never receives one).

**Schema** (per ADR 0004): `Player` no longer carries `@type("string") role`/`team`/`lastHealedId`. The identity store lives in the engine. Verified by tests that read `(p as any).role`/`(p as any).team` and expect `undefined`.

**Tests** (34 passing, 0 failing):
- `test/engine.test.ts` — 26 unit tests: role distribution for 9/10/11; phase guards; Doctor restriction; night resolution; log integrity; player secrecy.
- `test/mafia-room.test.ts` — 8 integration tests through real Colyseus sockets: startGame, the two die/no-die flows, repeat-heal rejection, host-only mafiaKill, schema secrecy in `state.players`, LOBBY rejection, and `yourRole` delivered to each guest but not the host.

**One room-side bug found and fixed while wiring:** `inviteCreatedAt` was never initialised, so `isInviteExpired()` always returned true and even un-passworded rooms refused join. Initialised it in `onCreate`.

**Test-only helpers exposed on `Engine` (used by tests):** `_assignRoleForTest(sessionId, role)` and `_setLastHealedForTest(doctorId, targetId)`. They bypass the random shuffle and the live `resolveNight`-driven `lastHealed` update, so tests can pin a deterministic role layout without rebuilding the world.

**Out of scope for this slice (deliberately not implemented):** Night-1 → DAY_ANNOUNCEMENT auto-progression, day-phase actions (vote/nominate/defense), voting tally & revote loop, victory detection, phase timers, disconnect pause, host overrides. Each maps to a follow-up ticket in `.scratch/mafia-game-loop/issues/`.