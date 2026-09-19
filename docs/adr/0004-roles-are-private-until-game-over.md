# ADR 0004: Roles are private until GAME_OVER

- Status: Accepted
- Date: 2026-09-19

## Context

The current `Player` schema carries `role` and `team` as `@type("string")` fields, which means every connected client receives them on every state patch. This is a secrecy bug — every player would see every role as soon as the game starts, which violates `rules.md` "Secret until the end".

The user confirmed: roles must never reach a non-host, non-self client until GAME_OVER. The trigger for sending a player's role to that player is also flexible — host can send manually, or the game flow sends automatically at the right moment.

## Decision

- `Player.role` and `Player.team` are removed from the public schema.
- A server-side `Map<sessionId, { role, team }>` becomes the canonical store.
- The server sends a private `yourRole{role, team}` message to each session at the right game-flow moments (e.g., the start of Night 1 for personal intro, and at GAME_OVER for the public reveal).
- The host can also send `yourRole{sessionId, role, team}` manually to reveal a specific player's role to the room at any time (e.g., moderator calls out a player for inspection).

## Consequences

- Any code that read `state.players.get(id).role` to drive game logic must instead read the server-side map. The engine has a `getRole(sessionId)` accessor.
- The host UI needs an "all roles" view for moderator sanity. This view is fed by the server-side map, not the schema.
- Spectator / replay clients cannot reconstruct the game without the host's action log (see ADR 0002). This is by design.
- Revealing a role manually before GAME_OVER is logged as a moderator action; the action log makes the leak traceable.

## Alternatives considered

- **Keep roles in the schema but set them only for the player's own sessionId** — relies on Colyseus' row-level filtering which is fragile and easy to leak by accident. Rejected.
- **Use Colyseus' private schema fields** — fine in principle but requires every game-logic call site to use the right accessor. Same outcome as the server-side map with extra abstraction.
- **Roles public, only role names hidden** — keeps team secrecy but exposes the role taxonomy. Doesn't satisfy the rule.