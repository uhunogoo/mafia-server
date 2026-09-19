# ADR 0003: No abstention; auto-pardon only on a 2-way final tie

- Status: Accepted
- Date: 2026-09-19

## Context

`rules.md` says "Vote only for candidates on the list or abstain" and "If there are multiple leaders — an immediate revote only between them" and "If the revote results in another tie — no one is eliminated." The wording is ambiguous when extended to N-player games:

- Does "abstain" mean a player can opt out of voting entirely?
- Does "another tie" include 3-way and larger ties, or only 2-way ties?

The user clarified both:

- **No abstention.** A player who doesn't cast an explicit vote is auto-assigned to the last player in the current speaking order. This is the closest online analogue of "you didn't vote, so the room pressure pushes your default toward the latest speaker".
- **Auto-pardon only on 2-way final tie.** If a 3+ way tie persists through revotes, the revote loop continues among all tied leaders. Auto-pardon kicks in only when the tie reduces to exactly 2 players.

## Decision

- The voting UI never exposes an "abstain" option.
- The server auto-casts a default vote (last speaker) for any player who has not voted by the vote window deadline.
- The vote resolver handles N-way ties by revote among the tied set, looping until either a single winner emerges or the tie is exactly 2-way (then auto-pardon).

## Consequences

- A "player sat out the vote" condition is impossible at the protocol level — every player has a vote recorded. The default vote is logged so the moderator can spot social loafing.
- The vote resolver is a small loop rather than a one-shot function. Edge case: the loop must terminate. We cap with a host-decision step after a fixed number of 3+ way tie revotes.
- Players who are alive at the start of DAY_VOTING but disconnect during voting receive the same default-vote treatment as a present-but-quiet player.

## Alternatives considered

- **True abstention** — players can opt out. Rejected because it creates a "free vote" effect that the rulebook does not sanction.
- **2-way-tie cap, random winner otherwise** — keeps the loop short but adds randomness the rulebook doesn't authorize.
- **Random tiebreaker always** — simpler but removes moderator authority from a defining moment.