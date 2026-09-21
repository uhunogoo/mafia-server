# 02: BALAGAN precedes SPEECHES on Day 2+ (ADR 0007)

**What to build:** On Day 2+, the host's start-speeches press opens BALAGAN — the 90s free debate (reminder at 60s) — immediately after the announcement. No message renames: the same press now means "open the day's discussion." When the debate ends (timer expiry or host skip), the speech round begins, and the speaking roster freezes at that moment — anyone who died during the debate (kick, or declare-dead after a disconnect) is off the speech list, the first-word nomination duty lands on the first living seat clockwise from yesterday's first speaker, and the actual opener becomes tomorrow's rotation anchor. The last speech now advances straight to defense on every day. Nominations are valid during speeches only, on all days: nominating during BALAGAN is rejected at both the engine and room layers. Day 1 is byte-identical to today — no BALAGAN, roster freezing at the same instant. Docs land in the same change set as the code: new ADR 0007, the status note on ADR 0005, the CONTEXT.md phase reorder, the order fixes in the mafia-game-loop spec, and the revision note appended to the completed BALAGAN ticket. Full change list, test plan, doc texts, and edge sweep: `.scratch/balagan-reorder/spec.md`.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Day 2+: `startSpeeches` enters BALAGAN with the 90s timer armed; expiry and host skip both open speeches
- [ ] Day 2+ sequence walks green: ANNOUNCEMENT → BALAGAN → SPEECHES → DEFENSE → VOTING → NIGHT; the last speech advances directly to defense on all days
- [ ] `nominate` during BALAGAN is rejected at the engine and room layers; valid during speeches only, on all days
- [ ] Death during BALAGAN — kick, and declare-dead after a disconnect — leaves the roster; the first-word duty and the next day's anchor follow the actual opener; `getSpeakingOrder()` is empty during BALAGAN
- [ ] Day 1 regression: the Day 1 test diff is empty except shared walk helpers; `driveDay1` untouched
- [ ] Docs land with the code: ADR 0007 written, status note appended to ADR 0005, CONTEXT.md phases reordered, mafia-game-loop spec order references fixed (including extending the ADR range in the synthesis note), revision note appended to the completed BALAGAN ticket
- [ ] Type check clean; full suite green; a text sweep finds no stale order references outside intentionally preserved history (the ADR 0005 body and the completed ticket 07 body)
