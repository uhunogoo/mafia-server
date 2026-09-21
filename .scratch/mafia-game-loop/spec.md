# Mafia Game Loop

Status: ready-for-agent

## Problem Statement

The `mafia-server` repo currently implements only the lobby: players can join a room, the host can set `maxPlayers`, and seats are assigned. There is no actual game loop — no role assignment, no night actions, no day phases, no voting, no victory check. A room can be filled but a game cannot be played.

## Solution

Build the complete Mafia game loop in a pure engine module (`src/game/Engine.ts`) that operates on the public `MafiaState` schema and on server-side maps for secrets (roles, action log, last-healed tracking). The Colyseus `MafiaRoom` becomes a thin transport layer: it routes client messages to engine methods and pushes engine state through the schema. The first deliverable is a vertical slice that runs one full Night 2 — mafia victim selection, Don/Sheriff checks stubbed, Doctor heal, and resolution to `state.died`. The remaining phases (day cycle, voting, victory, host overrides, full integration with timers and disconnect handling) are follow-up tickets on the same feature.

## User Stories

### Lobby and game start

1. As a player, I want to join a Mafia room, so that I can play with others.
2. As a player, I want to be assigned a seat when I join, so that my position in the speech order is fixed.
3. As a host, I want to be automatically the moderator when I create the room, so that I don't have to claim the role.
4. As a host, I want to configure `maxPlayers` (6–12), so that I can size the table.
5. As a host, I want to press `startGame` once the lobby is full, so that the game begins.
6. As a host, I want roles assigned to all seats atomically at game start, so that no one peeks mid-assignment.

### Role assignment

7. As the system, I want to assign roles according to a fixed distribution per player count (9, 10, 11), so that each game has a balanced setup.
8. As a player, I want to receive my role in a private message at the start of Night 1, so that no other player sees it.
9. As a player, I want my role to NOT appear in the public schema, so that the secrecy rule is enforced by the server.
10. As a player, I want all roles revealed to everyone at `GAME_OVER`, so that I can learn who played what.

### Night 1 (introduction night)

11. As the system, I want Night 1 to walk through all four role wakes (Mafia → Don → Sheriff → Doctor) for introductions only, so that players get acquainted.
12. As a player, I want no night actions to be collected on Night 1, so that the rule "no kills on the test night" is enforced.
13. As a player, I want Day 1 to skip the BALAGAN (debate) phase, so that we don't waste time discussing an empty night.

### Night actions (Night 2+)

14. As a mafia member, I want to see my fellow mafia members at night, so that I can coordinate.
15. As a mafia member, I want to send pings to other mafia during the night, so that I can signal without text chat.
16. As a mafia member, I want my pings to be invisible to non-mafia during the night, so that I keep my alliance secret.
17. As a host, I want to submit the mafia's victim on their behalf during the night, so that I act as the offline moderator would.
18. As a host, I want a 60-second mafia window with reminders at 30s and 50s, so that I have gentle pressure to keep the night moving.
19. As a host, I want the night to pause indefinitely if I don't submit a victim by the deadline, so that the game never silently skips a kill.
20. As the Don, I want to wake after the mafia and check one player for "is Sheriff", so that I can identify the threat.
21. As the Sheriff, I want to wake after the Don and check one player's color (RED/BLACK), so that I can identify mafia.
22. As the Sheriff, I want the Don to always appear BLACK to me, so that the rule is enforced.
23. As the Doctor, I want to wake last and pick one player to heal, so that I can save the mafia's victim.
24. As the Doctor, I want the server to reject a heal that targets the same player (including myself) as last night, so that I don't break the rule.
25. As the Doctor, I want the server to tell me why my heal was rejected, so that I can pick again.
26. As a checker (Don/Sheriff), I want my check result delivered immediately, so that the night doesn't stall on slow checks.
27. As the system, I want to resolve the night when all required actions are submitted: if the heal matches the mafia victim, the victim survives; otherwise the victim dies.

### Day phase

28. As a player, I want to see who died during the night (or "no one died"), so that I can react.
29. As a player, I want to give a 1-minute speech in clockwise order, so that I can share analysis.
30. As the first speaker on Day 2+, I want to be required to nominate a candidate, so that the day has a target.
31. As a player, I want to add new candidates during my speech, so that the nomination list grows.
32. As a player, I want a 1–2 minute open debate (BALAGAN), so that I can pressure suspects. (Day 1 skips this.)
33. As a nominated candidate, I want a 30-second defense, so that I can argue my case.
34. As a player, I want to vote to eliminate one of the nominated candidates during the vote phase, so that I participate in the day decision.

### Voting mechanics

35. As a player, I want the vote to be simultaneous on a count, so that no one's vote is influenced by another's.
36. As a player, I want my vote to count even if I don't submit explicitly — auto-assigned to the last speaker — so that abstention is not free.
37. As a player, I want a revote among tied leaders if the initial vote is 3+ way tied, so that we keep narrowing down.
38. As a player, I want an auto-pardon (no elimination) if the final tie is exactly 2-way, so that we don't deadlock.
39. As a host, I want the server to pause and ask me to decide after `revoteCap` consecutive 3+ way revotes, so that I can break deadlocks.
40. As a host, I want to choose between auto-pardon, force a candidate, or kick a player when arbitrating, so that I have full moderator power.
41. As a host, I want `revoteCap` and the post-cap behavior to be configurable per room, so that we can tune the game.

### Death, fouls, and etiquette

42. As a dead player, I want to stay connected and observe public day-phase state, so that I can follow the game.
43. As a dead player, I want to be unable to send pings, votes, nominations, or any action, so that I don't break the "Dead don't speak" rule.
44. As a player, I want my role to remain secret after my death, so that the Sheriff's and Don's logic stays hidden.
45. As a host, I want to record a foul against a player, so that I can warn without ejecting.
46. As a host, I want to kick a player (e.g., for showing a role card), so that they're ejected from the game but their seat is held.

### Disconnection

47. As a player, I want the game to pause if I disconnect, so that I can reconnect and resume.
48. As a host, I want to declare a missing player dead if they don't return, so that the game can continue.

### Victory

49. As the system, I want to declare a civilian victory when all blacks (Mafia + Don) are dead, so that the game ends.
50. As the system, I want to declare a mafia victory when living blacks ≥ living reds, so that the game stops immediately.
51. As a host, I want the final role reveal at `GAME_OVER` to be automatic, so that I don't have to trigger it manually.

### Visibility and logging

52. As a host, I want the full action log (every ping, vote, action, foul, kick), so that I can review the game.
53. As a player, I want my own check results delivered to me only, so that other players don't see them.
54. As a player, I want pings addressed to me to display for ~10 seconds and then disappear, so that the screen stays clean.
55. As a player, I want pings visible to everyone during the day, so that they work as social signals.

### Phase progression

56. As a host, I want phases to advance on automatic timers, so that I don't mindlessly click "Next".
57. As a host, I want to pause, extend, or skip a phase manually, so that I can handle real-life interruptions.
58. As a player, I want the engine to enforce phase-validated actions, so that day actions are rejected at night and vice versa.

## Implementation Decisions

### Architecture

- A pure engine module `src/game/Engine.ts` owns the game state machine. It holds the canonical role map, action log, last-healed map, and any other secrets. It exposes pure functions and methods that mutate the public `MafiaState` plus its private maps.
- `src/rooms/MafiaRoom.ts` becomes a thin transport layer. Each client message is parsed, validated (host-only, role-only, phase-only), and routed to the corresponding engine method. Engine state changes are pushed to clients through the Colyseus schema sync.
- All night actions (mafia victim, Don check, Sheriff check, Doctor heal) are submitted as messages; the engine stores them in the current night's action buffer and resolves when the buffer is complete.

### Schema changes

- `Player.role` and `Player.team` are removed from the public schema. They are stored only in the engine's server-side `Map<sessionId, {role, team}>`. ADR 0004.
- `Player.lastHealedId` is removed from the public schema. Stored only in the engine's `Map<sessionId, string>` keyed by the Doctor's sessionId. ADR 0004.
- `MafiaState` gains:
  - `died: string` — the sessionId of the player who died last night (empty = nobody died).
  - `nightStep: NightStep` — the active sub-step inside `NIGHT` (Mafia / Don / Sheriff / Doctor / Resolve).
  - `revoteCap: number` — default 3, per ADR 0006.
  - `revoteBehavior: "host-arbitrates" | "auto-pardon"` — default `"host-arbitrates"`.
- `MafiaState.chat` is removed. There is no chat in this design; everything goes through pings, votes, and the action log.
- `MafiaState.dayCount` increments after each completed day.

### Enums

- `GamePhase` day-phase order is fixed. Day 2+: `DAY_ANNOUNCEMENT → DAY_BALAGAN → DAY_SPEECHES → DAY_DEFENSE → DAY_VOTING`; Day 1 omits `DAY_BALAGAN`. ADR 0005, ADR 0007.
- A new `NightStep` enum tracks the active sub-step inside `NIGHT`.

### Role distribution

- 9 players: 1 Don, 1 Mafia, 1 Sheriff, 1 Doctor, 5 Civilians.
- 10 players: 1 Don, 2 Mafia, 1 Sheriff, 1 Doctor, 5 Civilians.
- 11 players: 1 Don, 2 Mafia, 1 Sheriff, 1 Doctor, 6 Civilians.

### Mafia coordination

- The mafia's chosen victim is a host-only server action (`mafiaKill{targetId}`). ADR 0001. There is no player-submitted mafia vote message. Mafia coordination during the night uses pings.
- The mafia window is 60 seconds with reminders at 30s and 50s. If the host has not submitted a victim by the deadline, the phase pauses indefinitely; there is no "skip" option.

### Doctor restriction

- The server hard-rejects a `doctorHeal` whose targetId equals the Doctor's `lastHealedTarget`. The Doctor must pick again. The "same player" rule includes the Doctor's own sessionId. ADR 0003.

### Voting

- No abstention. If a player does not submit a vote by the vote window deadline, the server assigns their vote to the last speaker. ADR 0003.
- After `revoteCap` consecutive 3+ way revotes (default 3, configurable), the server pauses and asks the host to decide. ADR 0006.

### Visibility

- The action log is host-only. Players see only pings that involve them (sent by them or addressed to them). Pings render for ~10s and disappear from the client view. ADR 0002.
- Check results are private to the checker.
- The mafia's chosen victim is not broadcast to players; only `state.died` becomes non-empty at `DAY_ANNOUNCEMENT`.

### Phase progression

- Server timers drive phase advancement. The host can override: `pause`, `resume`, `skipPhase`, `extendPhase{seconds}`.
- On Night 1 the engine walks through `MAFIA → DON → SHERIFF → DOCTOR → RESOLVE` without collecting any actions, then transitions to `DAY_ANNOUNCEMENT` with `dayCount = 1`.
- From Night 2 onward, the engine collects actions in order: `MAFIA → DON → SHERIFF → DOCTOR → RESOLVE`, and resolves the night when all four are submitted.
- Day 1's sequence is `DAY_ANNOUNCEMENT → DAY_SPEECHES → DAY_DEFENSE → DAY_VOTING`. Day 2+ runs `DAY_ANNOUNCEMENT → DAY_BALAGAN → DAY_SPEECHES → DAY_DEFENSE → DAY_VOTING` — BALAGAN precedes speeches (ADR 0007).

### Disconnection

- A player who drops mid-game causes the current phase to pause. The host has a `declareDead{sessionId}` action that breaks the pause and marks the player dead. ADR (follow-up).

### Death and the golden rules

- Dead players can observe public day-phase state but cannot send anything.
- `Player.role` and `Player.team` are never in the public schema; the server never reveals a dead player's role.
- All actions are phase-validated and role-validated by the engine.

## Testing Decisions

### Seam: integration through the room

- Tests use `@colyseus/testing`'s `createRoom` + `connectTo` (matches `test/mafia-room.test.ts`). The room's `engine` field is exposed for test inspection.
- Test setup helper: a `setupRoom(playerCount)` function that creates the room, connects a host plus the configured number of guests, and returns `{ room, clients, engine }`.

### Seam: unit tests for the engine

- Pure functions in `Engine` (`assignRoles`, `resolveNight`, `tallyVotes`, `checkVictory`) are tested in isolation without a Colyseus room.
- The Doctor restriction, vote tie loop, and victory detection are tested as pure functions.

### Coverage

Tests must cover at least:

- **Slice 1 (Night 2 vertical slice):**
  - Doctor saves the mafia victim → `state.died === ""`.
  - Doctor does not save the mafia victim (or skips) → `state.died === victimId`.
  - Doctor is rejected when healing the same player as last night.
  - Public state never contains `Player.role` or `Player.team` (golden rule #2).
  - Engine rejects a `doctorHeal` submitted during the wrong phase (golden rule #4).
- **Follow-up slices (tickets 02+):**
  - All golden rules from `rules.md`:
    1. Dead players cannot send actions.
    2. No role exposure in public state.
    3. Role not revealed in public state after death.
    4. Day actions rejected during the night, and vice versa.
  - Full night resolution, full day cycle.
  - Voting: 2-way auto-pardon, 3-way revote loop, host arbitration after `revoteCap`.
  - Victory conditions: civilian (all blacks dead) and mafia (blacks ≥ reds).
  - Disconnect pause + `declareDead` resume.
  - Host-only action log (player client never receives it).
  - Kick behavior.

### Prior art

- `test/mafia-room.test.ts` — existing integration test pattern. The slice's tests extend it.

## Out of Scope

- Persistent action-log storage (in-memory only).
- Spectator / replay UI (the host-only action log is the canonical record; replay is a separate feature).
- Reconnect persistence across server restart.
- Anti-cheat (e.g., detecting role-card sharing via camera).
- Bot players.
- Internationalization of UI strings.
- Implementation of phase timers, disconnect handling, day phases, voting, and victory conditions in this slice — these are follow-up tickets.

## Further Notes

- The vertical slice is the first deliverable. It implements only Night 2: mafia victim selection (host-confirmed), Don/Sheriff checks (stubs that record but don't resolve), Doctor heal (with restriction), and resolution to `state.died`. Day phases, voting, victory detection, phase timers, and disconnect handling are follow-up tickets on the same feature.
- This spec was synthesized from a five-round grilling session that locked in: non-playing host with manual controls, role distribution per player count, no-chat ping-based coordination, host-confirmed mafia victim, host-only action log, immediate check delivery, 60s mafia window with host reminders, Day 1 without BALAGAN, BALAGAN before speeches on Day 2+, no-abstain voting with last-speaker default, configurable revote cap with host arbitration, role privacy until `GAME_OVER`, and disconnect-pause-with-host-resume. See `docs/adr/0001` through `docs/adr/0007` for the binding decisions.
- The seaming for tests: integration via the existing `colyseus.createRoom` API plus engine-level unit tests. No new test framework or test seam is introduced.