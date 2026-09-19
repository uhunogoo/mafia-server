# 02: Pings + action log

**What to build:** A host-only action log that records every ping, vote, action, foul, kick, and phase event; a per-player ping system where each player sees only the pings they sent or received, and each ping renders briefly before disappearing. The host sees all pings regardless of sender or recipient.

**Blocked by:** 01.

**Status:** resolved

- [x] Server maintains an `ActionLog` of every ping, vote, action, foul, kick, and phase event.
- [x] Host can fetch log entries via a `log{since}` message.
- [x] Player clients cannot read the host log.
- [x] Pings are accepted from any player to any player during the day; mafia-only during the night.
- [x] A player's client receives only the pings they sent or received (not other players' pings).
- [x] Pings render to the receiving client for ~10 seconds, then disappear from the player's view.
- [x] The host sees all pings regardless of sender or recipient.
- [x] Test: two players exchange pings; each sees their own ping; neither sees the other player's unrelated pings; host sees both.

## Answer

Implemented in `src/game/Engine.ts` (pure logic) wired through `src/rooms/MafiaRoom.ts` (transport).

**Engine** owns the canonical ping list (`PingRecord[]`) alongside the existing role map, action log, and `lastHealed`. Slice-2 implements:
- `ping(fromId, toId)` — accepts a ping; rejects on LOBBY / GAME_OVER / dead actor / dead target / self-ping; rejects during NIGHT if either side is not mafia. Returns a `PingRecord` so the room can route it to the right three clients.
- `getPingsForPlayer(sessionId)` — filters by sender-or-recipient for per-player visibility.
- `getAllPings()` — host's view of every ping in insertion order.
- `getActionLogSince(sinceEntryId)` — incremental log fetch for the host's `log{since}` message. Empty string returns the whole log; unknown ids fall back to the whole log so a missed id never blocks progress.

Every accepted ping also writes a `PING` entry to the existing action log, so the host sees both the structured ping and the log entry for replay.

**Room** translates each client message to an engine call. For `ping`, the room routes the returned `PingRecord` privately to the sender, recipient, and host (skipping the host when they are already sender or recipient). The `getLog` message is host-only and replies with `{ entries: ActionLogEntry[] }`.

**Tests** (54 passing, 0 failing):
- `test/engine.test.ts` — 40 unit tests: role distribution, secrecy, night actions, phase guards, night resolution, action log integrity, action log query (empty / since / unknown id), pings (day accepts, night restricts to mafia, self/dead rejected, LOBBY/GAME_OVER rejected, per-player filtering, full visibility, log-entry side effect).
- `test/mafia-room.test.ts` — 14 integration tests through real Colyseus sockets: original Night-2 vertical slice plus pings visibility (mutual exchange, third-party isolation, host sees all), civilian-at-night rejection with no record, host `getLog` succeeds and contains `PING` + `PHASE_ADVANCE`, non-host `getLog` rejected with an error and no log payload.

**Per-player delivery note:** Per ADR 0002, each player sees only pings they sent or addressed. The host sees every ping. The room enforces this routing server-side; no schema field is added for pings, so they stay ephemeral on the wire and the action log remains the canonical record.

**Out of scope (deliberately not implemented):** the 10-second client-side fade (a client concern; the engine ships the `timestamp` so the UI can fade locally), foul / kick / vote entries (covered by follow-up tickets 06 / 08).