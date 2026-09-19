# ADR 0006: Configurable revote cap with host arbitration (deviation from rules.md)

- Status: Accepted
- Date: 2026-09-19

## Context

`rules.md` says: "If the revote results in another tie — no one is eliminated, the day ends, and night falls." This is interpreted as automatic auto-pardon on any tie. The user clarified this project deviates: persistent 3+ way ties do not auto-pardon; the host arbitrates.

## Decision

- After `N` consecutive revotes that end in a 3+ way tie (default `N = 3`), the server pauses the voting phase and emits a host-only decision prompt.
- The host chooses one of:
  - **Auto-pardon** — no one is eliminated, day ends, night falls.
  - **Force a candidate** — host picks one of the tied leaders; the day ends with that candidate eliminated.
  - **Kick a player** — host removes a non-tied player (e.g., a player suspected of stalling the vote); tied leaders revote again with one fewer candidate.
- `N` and the post-cap behavior are configurable per room. The default `N = 3` and default behavior "host arbitrates" match the user's intent; a future room setting can revert to pure auto-pardon without engine changes.

## Consequences

- The room settings schema gains two fields: `revoteCap: number` (default 3) and `revoteBehavior: "host-arbitrates" | "auto-pardon"` (default "host-arbitrates").
- The vote resolver becomes a small loop with a host-decision branch after `revoteCap` iterations.
- The host UI must surface a clear decision prompt: "Three-way tie after N revotes — kick, force, or pardon?" with the relevant context (the tied leaders, the full vote history).
- Tests for voting must cover: 2-way tie auto-pardon, 3-way tie revote loop, N-revote host arbitration, and the config-driven behaviors.

## Alternatives considered

- **Strict rules.md compliance** — auto-pardon on any tie. Rejected: persistent 3-way ties give the Mafia a free pass and stall the game.
- **Random tiebreaker** — server picks one of the tied leaders at random. Rejected: removes moderator authority from a defining moment; can feel arbitrary to players.
- **Hard cap with auto-pardon** — no host step. Rejected: removes the moderator's ability to spot and act on deliberate stalling.