# 02: Pings + action log

**What to build:** A host-only action log that records every ping, vote, action, foul, kick, and phase event; a per-player ping system where each player sees only the pings they sent or received, and each ping renders briefly before disappearing. The host sees all pings regardless of sender or recipient.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Server maintains an `ActionLog` of every ping, vote, action, foul, kick, and phase event.
- [ ] Host can fetch log entries via a `log{since}` message.
- [ ] Player clients cannot read the host log.
- [ ] Pings are accepted from any player to any player during the day; mafia-only during the night.
- [ ] A player's client receives only the pings they sent or received (not other players' pings).
- [ ] Pings render to the receiving client for ~10 seconds, then disappear from the player's view.
- [ ] The host sees all pings regardless of sender or recipient.
- [ ] Test: two players exchange pings; each sees their own ping; neither sees the other player's unrelated pings; host sees both.