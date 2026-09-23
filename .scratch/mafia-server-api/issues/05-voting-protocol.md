# 05 — Voting protocol (host-mediated)

Type: grilling
Status: open
Blocked by: (none)

## Question

Який точний формат повідомлення від ведучого для запису vote-counts, і як сервер обробляє tie / revote / auto-pardon?

З гриля 2: voting = host-mediated. Ведучий оголошує «хто за N», рахує, передає серверу. Утримались → голосують за останнього кандидата в черзі.

Потрібно:

1. **Формат payload** `submitVoteCounts`:
   ```typescript
   {
     targetId: string,          // кандидат, для якого зараз рахуємо
     forVotes: number,          // піднятих рук
     againstVotes?: number,     // чи рахуємо проти?
     abstains?: number,
   }
   ```
   Чи одним масивом:
   ```typescript
   { counts: [{ targetId, forVotes }], abstains: number }
   ```

2. **Структура `state.vote` (зараз порожня `VoteState`)**:
   ```typescript
   class VoteState extends Schema {
     @type([VoteCount]) candidates = new ArraySchema<VoteCount>();
     @type("number") abstains: number = 0;
     @type("string") phase: "primary" | "revote" = "primary";
   }
   class VoteCount extends Schema {
     @type("string") candidateId: string;
     @type("number") forVotes: number;
   }
   ```

3. **Логіка переходу з primary → revote**: коли в `primary` два+ кандидатів з однаковим `forVotes` (найвищим), сервер переходить у `DAY_REVOTE` з тими самими кандидатами; інакше — одразу елімінація.

4. **Auto-pardon**: якщо в `revote` знову tie — `phase = DAY_AUTO_PARDON` (або просто ніч), ніхто не вибуває.

5. **Обробка помилок**: що робити, якщо ведучий прислав невалідні дані (наприклад, `forVotes > aliveCount`)?

6. **Як сервер оголошує результат**: окремим `message("voteResult", { eliminatedId | null })` чи оновленням `state.players[i].isAlive = false`?

7. **Edge cases**: всі утримались (abstain = всі живі) → auto-pardon? один кандидат (vote unanimous) → одразу елімінація?

Відповідь — це фінальна схема `VoteState`, payload handler'ів, і блок-схема логіки переходів.

## Out of scope

- UI голосування для гравців (вони не голосують, ведучий записує)
- Таймер на голосування (нема — host-driven)