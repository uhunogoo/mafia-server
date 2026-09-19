# ADR 0001: Host-confirmed mafia victim (no player-submitted mafia vote)

- Status: Accepted
- Date: 2026-09-19

## Context

`rules.md` describes the mafia night as: "Mafia wakes up and points to their victim" while actions are "performed silently, by touch or gestures", and the host is the moderator who confirms each action. Translating this to an online room raised the question of how the mafia finalizes a victim in the absence of a shared physical gesture channel.

Two natural translations exist:

1. **Player-submitted vote** — each mafia member submits a `mafiaVote{targetId}` from their client; the server tallies and resolves on majority. This is how almost every existing online mafia game works.
2. **Host-confirmed victim** — mafia members coordinate through pings (the predefined gesture equivalents that are already part of the project's design). The host observes the conversation and submits a single `mafiaKill{targetId}` on behalf of the group.

## Decision

Use option (2): the mafia's victim is a host-submitted server action. There is no player-side mafia vote message.

## Consequences

- The server exposes `mafiaKill{targetId}` as a host-only message; non-host clients cannot submit it.
- Mafia coordination during NIGHT happens through the existing ping channel. Pings at night are visible only to mafia members and the host.
- The host must be present and attentive during the mafia window of every night. If the host is idle, the mafia cannot kill.
- An action log records every mafia night window so the host can review timing after the fact.
- It becomes impossible for a mafia player to cheat by sending a vote that contradicts the host's read of the room — the host is the canonical source of truth.

## Alternatives considered

- **Player-submitted majority vote** — easier on the host, but the host becomes a passive observer and the server becomes the moderator-in-the-middle. This drifts away from the offline feel that `rules.md` describes and weakens the moderator's authority on fouls.
- **Don-only victim** — only the Don picks; other mafia object via pings. Rejected because the 9-player setup has only 1 Don + 1 Mafia; if the Don dies first, the game loses its victim-selection authority.