# 02 — Role assignment preset tables

Type: research
Status: resolved
Blocked by: (none)

## Answer

Дослідження канонічних пресетів завершене на 7 джерелах (Davidoff 1986/1998, NPL 2007, Princeton Mafia, Wikipedia, Werewolf Wiki Pactbreaker, uk.wikipedia, ru.wikipedia). Повний матеріал у `research/02-role-assignment-tables.md`.

**Обрана схема** (Davidoff + Slavic `don + mafia + sheriff + doctor`):

| Players | DON | MAFIA | SHERIFF | DOCTOR | CIVILIAN | Black% |
|--------:|:---:|:-----:|:-------:|:------:|:--------:|:------:|
| 8       |  1  |   2   |    1    |   1    |    3     | 37.5%  |
| 9       |  1  |   2   |    1    |   1    |    4     | 33.3%  |
| 10      |  1  |   2   |    1    |   1    |    5     | 30.0%  |
| 11      |  1  |   3   |    1    |   1    |    5     | 36.4%  |
| 12      |  1  |   3   |    1    |   1    |    6     | 33.3%  |

**Інваріанти**: DON = 1, SHERIFF = 1, DOCTOR = 1, MAFIA ≥ 1, Σ = N, Black% ∈ [30%, 38%].

**Ухвалені рішення:**

- **Disconnect під час ночі** → НЕ перерозподіляти ролі (порушує privacy, ламає seed-аудит). Нічні підфази використовують `isConnected`, не `isAlive`. Якщо mafia втратила гравця — голосують решта; якщо SHERIFF — ніч пропускаємо його перевірку.
- **Audit/seed RNG**: CSPRNG (`crypto.randomBytes(4)`) → 32-бітний seed → `mulberry32` для Fisher-Yates. Зберігати `state.lastSeed: number` і писати в `logs/audit.jsonl` (server-side only).
- **< 8 гравців**: `startGame` повертає `lobby_too_small`. **> 12**: `lobby_too_full`.
- Файл `src/utils/rolePresets.ts` з `ROLE_PRESETS`, `getRolePreset()`, `isSupportedPlayerCount()`, `SUPPORTED_PLAYER_COUNTS = [8,9,10,11,12]`.

**Відкрите питання для користувача** (ризик #1): чи прийнятний Black% 37.5% для 8 гравців як «компроміс»? Альтернатива — 8 = 1+1+1+1+4 (25% black), але DON надто швидко розкривається шерифом.

Context pointer: `research/02-role-assignment-tables.md`.

## Question

Які канонічні склади ролей для 8, 9, 10, 11, 12 гравців використовувати в `startGame`?

З регламенту ми знаємо: оптимально 8-10 гравців, є don, mafia (>=1), sheriff (1), doctor (1), решта — цивільні.

Потрібно дослідити поширені пресети з офлайн-спільноти та обрати один варіант для кожної кількості гравців.

Відповідь має містити:

1. **Таблицю пресетів** для 8/9/10/11/12 у форматі:
   ```
   8:  [don, mafia, mafia, sheriff, doctor, civilian, civilian, civilian]
   9:  [...]
   ...
   ```
2. **Обґрунження** пропорції мафії (зазвичай 1/4 живого столу, або фіксовано 2-3)
3. **Edge case**: що робити, якщо гравець вийшов під час ночі — чи треба перерозподіляти ролі, чи залишити як є (рекомендація)
4. **Сидінг випадковості**: чи зберігати seed для аудиту, чи pure random
5. **Файл**: `src/utils/rolePresets.ts` з типізованою константою

Ці пресети використовуються в `messages.startGame` (ticket 11) і в `assignRoles()` (ticket 07).

## Out of scope

- Логіка шифрування ролей для відправки клієнту (privacy — ticket 10)
- Баланс і мета-гра (це питання геймдизайну, не сервера)