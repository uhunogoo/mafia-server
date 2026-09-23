# 08 — Win condition detection algorithm

Type: research
Status: resolved
Blocked by: (none)

## Answer

Алгоритм `checkWinCondition()` валідується як канонічний (відповідає Wikipedia, оригінальному сетингу Давидова 1999, KQED, BoardGameGeek). Повний матеріал у `research/08-win-condition-detection.md`.

**Ключові рішення:**

- `applyWinCondition()` викликається **після кожної зміни `isAlive`** (після `submitNightResult` і після `submitVoteCounts` з non-auto-pardon результатом). Mafia-win перевірка фактично спрацьовує лише вночі, бо інших точок смерті нема.
- Порядок перевірки: `blacks === 0 → "red"` **перед** `blacks >= reds → "black"`. Це вирішує edge-case одночасної загибелі останнього мафіозі й цивільного на користь Town.
- Mid-day stop: mafia може досягти парності тільки вночі через kill, тому `phase = GAME_OVER` ставиться **після нічного resolve**, перед `DAY_ANNOUNCE`. Ведучий не встигає почати промови.
- GAME_OVER відкриває всі ролі (`roleVisible = true` — нове поле в Player, додати в ticket 11) і виставляє `state.winner`.
- Tie-deaths (mafia вбила двох) — сервер у циклі `isAlive = false` для кожного, потім **один раз** `applyWinCondition`. Перевірка після всіх смертей, щоб не зупинити передчасно.
- Auto-pardon — `applyWinCondition` не викликається (isAlive не змінюється).
- Host **виключається з підрахунку** (нема role/team).

**12 edge cases опрацьовано** (all-dead, doctor self-heal, tie-deaths, last-mafia+last-civilian, empty night, single-player, test night, last-night heal cancel тощо).

**Рекомендація до ticket 11 (prototype)**: додати `state.winner: "red" | "black" | null` і `Player.roleVisible: boolean`.

Context pointer: `research/08-win-condition-detection.md`.

## Question

Як сервер рахує умови перемоги і коли автоматично завершує гру?

З регламенту:
- **Цивільні перемогають**: усі чорні (mafia + don) вибули
- **Мафія перемагає**: кількість живих чорних ≥ кількості живих червоних. Гра зупиняється **негайно**, навіть якщо зараз день.

Потрібно:

1. **Алгоритм `checkWinCondition()`**:
   ```typescript
   function checkWinCondition(state: MafiaState): "red" | "black" | null {
     const alive = [...state.players.values()].filter(p => p.isAlive);
     const blacks = alive.filter(p => p.team === Team.BLACK).length;
     const reds = alive.filter(p => p.team === Team.RED).length;
     if (blacks === 0) return "red";
     if (blacks >= reds) return "black";
     return null;
   }
   ```

2. **Коли викликати**:
   - Після кожної зміни `isAlive` (смерть уночі, елімінація вдень)
   - Чи достатньо одного разу після нічного resolve + одного разу після денного vote resolve?

3. **Якщо перемога вночі** (mafia ≥ civilians): сервер одразу виставляє `phase = GAME_OVER`, не чекаючи `DAY_ANNOUNCE`?

4. **GAME_OVER**: чи сервер відкриває всі ролі (`state.players[i].roleVisible = true`), чи просто завершує?

5. **Tie в deaths (mafia вбила двох, один був шериф)**: як сервер оновлює `isAlive = false`? У `submitNightResult({ deadIds: [...] })` ведучий перераховує.

6. **Edge case**: лікар вбив самого себе (`heal self, but mafia targets self`) — стандартно cancel; але якщо `heal self, mafia targets other` — той other помирає. Сервер знає?

## Out of scope

- Post-game UI (лог, статистика) — клієнт
- Рейтинги, профілі — out of scope за persisted state