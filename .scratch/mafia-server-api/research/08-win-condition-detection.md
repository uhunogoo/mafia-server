# 08 — Win condition detection algorithm (research findings)

## Summary

Запропонований `checkWinCondition()` — канонічний, відповідає міжнародним правилам «Мафії» (СНД- та англомовним сетингам) і стандартним формулюванням у Wikipedia/BoardGameGeek. Рекомендуємо викликати його **після кожної зміни `isAlive`** (а не тільки на межах фаз), але **перевірку «mafia ≥ civilians» — лише після нічного resolve**, бо це єдина точка, де чорні можуть зменшити червоних за межі фази. Мафія перемагає **негайно**, не чекаючи `DAY_ANNOUNCE`. GAME_OVER відкриває всі ролі (`roleVisible = true`). Edge-cases: tie-deaths розв'язуються після застосування всіх смертей; doctor self-heal — стандартне правило «однаковий target = kill canceled»; одночасне знищення останнього мафіозі й останнього цивільного — технічно Town win (mafia=0 ⇒ town умова виконана); повне вимирання — програма чорних за умовою `blacks >= reds`.

## Evidence (from local repo + Wikipedia)

- **Ticket**: `.scratch/mafia-server-api/issues/08-win-condition-detection.md` (read-only)
- **Map**: `.scratch/mafia-server-api/map.md` (read-only) — Decisions-so-far: «ведучий — Player без ролі», «voting = host-mediated», «сервер: перевірка перемоги».
- **Related tickets** (read-only):
  - `issues/07-night-action-state-machine.md` — `submitNightResult({ deadIds })` від ведучого; `NightActionState.resolvedTargetId`.
  - `issues/05-voting-protocol.md` — `submitVoteCounts` ігнорує elimination у revote-tie (auto-pardon).
  - `issues/11-state-schema-prototype.md` — `Player.isAlive`, `Player.team`, `Team.BLACK`, `Team.RED`.
- **Authoritative external sources**:
  - https://en.wikipedia.org/wiki/Mafia_(party_game) — Gameplay §: «Mafia wins if they equal or outnumber the Town. The game ends immediately, even if it is currently Day»; «Town wins when all Mafia members are eliminated».
  - https://web.archive.org/web/19990302082118/http://members.theglobe.com/mafia_rules/ — оригінальний сетинг Дмитра Давидова (парність = перемога мафії).
  - https://www.kqed.org/pop/10178/how-to-play-mafia-an-in-depth-guide-to-the-perfect-holiday-game — David Aloi (KQED), парність як стандартна умова.

## 1. Validated algorithm

Запропонований код коректний. Канонічна версія (вирівняна з регламентом і Wikipedia):

```typescript
function checkWinCondition(state: MafiaState): "red" | "black" | null {
  const alive = [...state.players.values()].filter(p => p.isAlive);
  // Host has no role/team — exclude from count (map.md: ведучий без role).
  const blacks = alive.filter(p => p.team === Team.BLACK).length;
  const reds   = alive.filter(p => p.team === Team.RED).length;
  if (blacks === 0) return "red";   // Town wins: всі чорні вибули
  if (blacks >= reds) return "black"; // Mafia wins: парність або перевага
  return null;
}
```

**Розширена версія з game-over-side-effect** (без mutation у pure-функції):

```typescript
function applyWinCondition(state: MafiaState): boolean {
  const winner = checkWinCondition(state);
  if (winner === null) return false;
  state.phase = GamePhase.GAME_OVER;
  // GAME_OVER reveals всі ролі (див. §4)
  for (const p of state.players.values()) {
    p.roleVisible = true;
  }
  state.winner = winner; // "red" | "black" — нове поле
  return true;
}
```

## 2. When to call it

**Рекомендація: викликати `applyWinCondition()` після кожної зміни `isAlive`** — і вночі, і вдень. Причини:

- **Нічна resolve** (після `submitNightResult` з host): це **головна** точка перевірки. Mafia може вбити цивільного й одразу досягти парності. Саме тут регламент вимагає негайного завершення «навіть якщо зараз день» — фактично гра зупиняється **на межі `DAY_ANNOUNCE`**, не чекаючи фази промов.
- **Денна елімінація** (після `submitVoteCounts` із результатом, відмінним від auto-pardon): якщо вибув останній `Team.BLACK` гравець — Town виграє негайно, не чекаючи ночі. Тут парність неможлива (вона лише на боці мафії), але Town win спрацьовує.
- **Mafia member killed by another mafia member** (теоретично, якщо don промис-сам): теж Town win.

**Альтернатива «тільки на межах фаз» — відхилена**, бо:
1. Промови вночі не вбивають — перевірка зайва, але й не шкідлива.
2. Вночі є лише один «межовий» момент — після всіх 4 вікон (`NIGHT_DOCTOR_HEAL → DAY_ANNOUNCE`).
3. Дешевше викликати щоразу, ніж підтримувати інваріант «isAlive змінилось тільки тут».

**Де НЕ викликати:**
- Під час `NIGHT_*` вікон — isAlive ще не змінено.
- Під час `DAY_SPEECH`, `DAY_DEFENSE`, `DAY_LAST_WORD` — це sub-phase'и, смертей нема.
- Під час `DAY_REVOTE` / `DAY_AUTO_PARDON` — isAlive не змінюється (auto-pardon = ніхто не вибув).

## 3. Mid-day stop semantics

З регламенту: «Гра зупиняється **негайно**, навіть якщо зараз день».

**Інтерпретація для поточного flow**: mafia може досягти парності тільки вночі (через kill). Тому в цій грі «негайно» реалізується як `phase = GAME_OVER` **після нічного resolve**, перед тим як `DAY_ANNOUNCE` оголосить жертв. Ведучий не встигає почати промови.

Якщо в майбутньому додадуть механіку, що вбиває вдень (наприклад, «жертва ведучого»), треба буде викликати `applyWinCondition` і там.

## 4. GAME_OVER — role reveal

**Так, всі ролі відкриваються (`roleVisible = true`).** Це канонічна практика (Wikipedia: «All players' roles are revealed when the game ends»). У Colyseus schema це вимагає зміни `@visibility` або `filter` (див. ticket 10). Рекомендуємо окреме поле `state.players[i].roleVisible: boolean` (зараз у схемі ticket 11 його нема — треба додати в прототип ticket 11).

Окрім ролей, опціонально відкриваються:
- `team` (якщо ще був прихований) — зазвичай команда = похідна від ролі.
- Логи — усі role-logs (`mafiaLog / donLog / sheriffLog / doctorLog`) стають повністю видимі всім.

## 5. Edge cases

| # | Сценарій | Рекомендовано | Обґрунтування |
|---|----------|----------------|---------------|
| 1 | **All dead** (усі померли в одну ніч) | `blacks >= reds` → mafia перемагає. Якщо `blacks === 0 && reds === 0` → town (`return "red"` задовольняє перший if). | Town win має пріоритет. |
| 2 | **Doctor self-heal**, mafia targets self | `if (mafiaTarget === healTarget) kill = none`. | Канон. Лікар лишається живий, ніхто не вмирає. |
| 3 | **Doctor self-heal**, mafia targets other | Other помирає. Лікар живий, ціль — ні. | Стандарт. `deadIds = [mafiaTarget]`. |
| 4 | **Tie deaths** (mafia вбила двох, один був шериф) | `submitNightResult({ deadIds: [a, b] })` — ведучий перераховує всіх, хто помер (ticket 07). Сервер у циклі виставляє `isAlive = false`, потім **один раз** викликає `applyWinCondition`. | Перевірка після всіх смертей, щоб не зупинити передчасно. |
| 5 | **Last mafia + last civilian die together** | Town перемагає. Бо `blacks === 0` перевіряється першим. | Канон: mafia win вимагає хоча б 1 живого мафіозі. |
| 6 | **Mafia wins mid-day** (якщо колись додадуть механіку) | `applyWinCondition` одразу після смерті: `phase = GAME_OVER`. | Відповідає регламенту «негайно». |
| 7 | **Auto-pardon** (revote tie → нічого не вибуває) | Перевірка перемоги не запускається (isAlive не змінюється). | Оптимізація. |
| 8 | **Host disconnect during night** (ticket 12) | `submitNightResult` не надходить → гра «зависає» на нічній фазі. | Out of scope ticket 12. |
| 9 | **Empty night** (mafia не вибрала ціль) | `deadIds = []` → `applyWinCondition` повертає `null`. | Безпечно. |
| 10 | **Single player left** | Якщо шериф — `team === RED`, `blacks === 0` → Town. Якщо мафіозі → `blacks >= reds` → Mafia. | Узгоджується з обома умовами. |
| 11 | **Test night (nightCount === 1)** — мафія не вбиває (ticket 07) | `deadIds = []` → перевірка повертає `null`. | Test night не може завершити гру. |
| 12 | **Last-night tie kill + doctor heal cancel** | `deadIds = []` (heal скасовує kill) → перевірка негайно → `null`. | Стандарт. |

## 6. Додаткові рекомендації до ticket 11 (prototype)

- Додати `state.winner: "red" | "black" | null` — щоб UI знав переможця.
- Додати `Player.roleVisible: boolean` — для GAME_OVER.
- Поле `Team.BLACK`/`Team.RED` уже є у ticket 11 — нічого не змінюємо.
- `applyWinCondition` має бути pure-функцією або методом з чіткими side-effects (тільки `phase`, `winner`, `roleVisible`).

## 7. Source URLs

- English Wikipedia — Mafia (party game): https://en.wikipedia.org/wiki/Mafia_(party_game)
- Original Mafia ruleset (1999 archive): https://web.archive.org/web/19990302082118/http://members.theglobe.com/mafia_rules/
- KQED in-depth guide (David Aloi, 2013): https://www.kqed.org/pop/10178/how-to-play-mafia-an-in-depth-guide-to-the-perfect-holiday-game
- Werewolf / BoardGameGeek (international ruleset): https://boardgamegeek.com/game/925