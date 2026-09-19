# ADR 0002: Action log is host-only; pings are ephemeral

- Status: Accepted
- Date: 2026-09-19

## Context

`rules.md` secrecy rules ("Dead don't speak", "Secret until the end", "No role cards") require that mid-game information stays private to the relevant role-bearers and the moderator. Translating this to an online game raises the question of who can see what during a live game.

A natural alternative is to expose a full action log to every player — easier to debug, easier to spectate, easier to learn from. But full visibility collapses the core deduction loop: if a player can see every check result, every heal target, and every mafia vote, they can solve the game without ever deducing.

## Decision

- The server maintains a single action log. Only the host can read it.
- Players see only the pings that involve them (sent by them or addressed to them).
- Pings render to the receiving client for ~10 seconds, then disappear from the player's view. The log entry on the server is permanent.

## Consequences

- Each player client needs per-session ephemeral UI state for pings, separate from the persistent log.
- Replay/spectator features (if added later) must replay from the host-only log; they cannot use the live player view as a source of truth.
- Players cannot retroactively re-read a missed ping; the host's log is the canonical record.
- Implementing a clean separation between "log" (host-only) and "pings" (per-player ephemeral) adds one extra layer in the message layer compared to a naïve "broadcast everything" implementation.

## Alternatives considered

- **Full public log** — simplest to build; collapses the deduction loop, violates secrecy.
- **Public log, private check results** — still leaks the mafia's night structure (e.g., how long they debated, who pinged whom). Inconsistent with the secrecy rule.
- **Per-player filtered log that mirrors the host's** — players would see the same data the host sees but only their slice. Rejected because the slice is hard to define for events that involve multiple players (e.g., a mafia vote that the host reads in aggregate).