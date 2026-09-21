# CONTEXT

Glossary of canonical terms for the Mafia server. Implementation details do not live here — see `docs/adr/`.

## Roles

- **Civilian** — RED team, no night action. Wins by voting out all BLACK players.
- **Sheriff** — RED team, each night checks one player's color (RED/BLACK). The Don appears BLACK to the Sheriff.
- **Doctor** — RED team, each night picks one player to save. Cannot target the same player (including self) on two consecutive nights.
- **Mafia** — BLACK team, collectively chooses one victim per night. On Night 1, mafia only familiarizes; no victim is picked.
- **Don** — BLACK team, head of the mafia. Each night checks one player to learn if they are the Sheriff.

## Teams

- **RED** — Civilian, Sheriff, Doctor.
- **BLACK** — Mafia, Don.

## Phases

The game is a cycle. `LOBBY` precedes the cycle; `GAME_OVER` terminates it.

- **LOBBY** — players join, host configures.
- **NIGHT** — silent actions in fixed order: Mafia → Don → Sheriff → Doctor. Ends when all living role-bearers have acted or the night window closes.
- **DAY_ANNOUNCEMENT** — host announces who died (or no one).
- **DAY_BALAGAN** — open debate (1–2 min). Present only from Day 2 onward (see ADR 0005); on Day 2+ it runs after the announcement and before speeches (see ADR 0007).
- **DAY_SPEECHES** — clockwise speeches (1 min each). Day ≥2: first speaker must nominate.
- **DAY_DEFENSE** — each nominated candidate defends (30 sec).
- **DAY_VOTING** — simultaneous vote for candidates (no abstention; default vote = last speaker if no input).
- **GAME_OVER** — terminal; final roles revealed.

## People

- **Player** — a connected client with a `role`, `team`, `isAlive`. Plays the game.
- **Host** — the moderator. Never gets a role. Observes the game and wields manual controls (pause / extend / skip / kick / foul). Server runs phases automatically; host only intervenes when needed.

## Signals

- **Ping** — a predefined gesture-style message a player sends to another player. Visible to everyone during DAY, mafia-only during NIGHT. Logged on the server.
- **Action** — a structured input a player submits during NIGHT (mafia vote, Don check, Sheriff check, Doctor heal). Logged on the server.

## Distribution (role counts per player count)

- **9 players** — 1 Don, 1 Mafia, 1 Sheriff, 1 Doctor, 5 Civilians.
- **10 players** — 1 Don, 2 Mafia, 1 Sheriff, 1 Doctor, 5 Civilians.
- **11 players** — 1 Don, 2 Mafia, 1 Sheriff, 1 Doctor, 6 Civilians.

## Night coordination

- **Mafia victim** — mafia members see each other and discuss via pings. There is no player-submitted mafia vote. The host observes the discussion and submits the victim on the mafia's behalf via a host-only server action.
- **Don check** — the Don picks a target; server returns "is Sheriff: yes/no" to the Don only.
- **Sheriff check** — the Sheriff picks a target; server returns "color: RED/BLACK" to the Sheriff only. The Don always reports as BLACK to the Sheriff.
- **Doctor heal** — the Doctor picks a target; server validates it against the consecutive-night restriction.

## Check delivery

- Server delivers check results to the checker immediately upon action resolution. The host observes the same data in real time.

## Night 1

- Server assigns roles at the start of Night 1.
- Each role wakes in order (Mafia → Don → Sheriff → Doctor) for introduction only. No night action is performed. The mafia does not select a victim. The Don does not check. The Sheriff does not check. The Doctor does not heal.
- Day 1 starts with the standard "no one died" announcement.

## Disconnection during a live game

- The server pauses the current phase and waits for the player to return. The host has a "declare dead" action that breaks the pause and resumes the game with the player marked dead.

## Mafia window timing

- The mafia window has a 60-second timer with host reminders at 30s and 50s. If the host has not submitted a victim by the end of the window, the server pauses and waits indefinitely.
- The mafia must always submit a victim; there is no "skip" option.

## Visibility

- The action log is host-only.
- Players see only the pings addressed to or sent by them. Pings render for ~10 seconds then disappear from the client view (both the prompt and the response).
- Check results are private to the checker (Sheriff sees only their own result; Don sees only their own result).
- The mafia's chosen victim is not broadcast to players; the dead player is announced at the start of DAY_ANNOUNCEMENT, with no role revealed.

## Voting

- Players cannot abstain. If a player does not submit a vote, the server assigns their vote to the last player in the current speaking order.
- An auto-pardon occurs only when the final vote ends in a 2-way tie.
- A 3-way (or N-way) tie triggers a revote among all tied leaders. The revote loops until either a single winner emerges or the tie reduces to exactly 2 players.
- After `N` consecutive 3+ way revotes (default `N = 3`, configurable per room), the server pauses and hands the decision to the host. The host may kick a player, force a candidate, or auto-pardon (see ADR 0006).

## Dead players

- Dead players stay connected and observe public day-phase state (speech order, nominations, vote tallies, phase transitions).
- Dead players cannot send pings, vote, nominate, or speak.

## Progression

- **Auto-timer** — server-side phase timer; phase advances when the timer expires.
- **Host override** — host can pause, extend, or skip the current phase.