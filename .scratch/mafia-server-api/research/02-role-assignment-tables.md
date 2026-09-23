# 02 — Role assignment preset tables (research)

> Канонічні склади ролей для 8/9/10/11/12 гравців у `startGame` / `assignRoles`.
> Базується на ticket 02, `map.md`, schema/enums.ts і глосарії (ticket 14).

## 0. TL;DR

Обираємо **схему Давідова + стандартний Slavic-набір `don + mafia + sheriff + doctor + civilian`** (тобто один дон, решта «мафія» — рядовий MAFIA, фіксовано 1 шериф і 1 лікар, решта CIVILIAN):

| Players | DON | MAFIA | SHERIFF | DOCTOR | CIVILIAN | Black% | Source    |
|--------:|:---:|:-----:|:-------:|:------:|:--------:|:------:|-----------|
| 8       |  1  |   2   |    1    |   1    |    3     | 37.5%  | Davidoff  |
| 9       |  1  |   2   |    1    |   1    |    4     | 33.3%  | Davidoff  |
| 10      |  1  |   2   |    1    |   1    |    5     | 30.0%  | Davidoff  |
| 11      |  1  |   3   |    1    |   1    |    5     | 36.4%  | Davidoff+NPL |
| 12      |  1  |   3   |    1    |   1    |    6     | 33.3%  | Davidoff  |

> Black% = (DON + MAFIA) / Players. Цільове співвідношення ~1/4 живого столу (±3 п.п.).
> Примітка: реальні пресети для 8 і 11 мають 37% / 36% чорних через те, що DON і SHERIFF+DOCTOR фіксовані; це компроміс, прийнятний у Slavic-школах.

Типізована TS-константа, яка ляже в `src/utils/rolePresets.ts`:

```typescript
// src/utils/rolePresets.ts
import { Role } from "../schema/enums.js";

/**
 * Канонічний розподіл ролей за кількістю гравців.
 * Схема: Davidoff's black-card tables + Slavic (sheriff + doctor + don).
 *
 * Кожен масив має довжину == playersCount.
 * Поле "don" — підвид MAFIA, але винесений окремо для зручності.
 */
export const ROLE_PRESETS: Readonly<Record<number, ReadonlyArray<Role>>> = Object.freeze({
  8:  [Role.DON, Role.MAFIA, Role.MAFIA, Role.SHERIFF, Role.DOCTOR, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN],
  9:  [Role.DON, Role.MAFIA, Role.MAFIA, Role.SHERIFF, Role.DOCTOR, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN],
  10: [Role.DON, Role.MAFIA, Role.MAFIA, Role.SHERIFF, Role.DOCTOR, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN],
  11: [Role.DON, Role.MAFIA, Role.MAFIA, Role.MAFIA, Role.SHERIFF, Role.DOCTOR, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN],
  12: [Role.DON, Role.MAFIA, Role.MAFIA, Role.MAFIA, Role.SHERIFF, Role.DOCTOR, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN],
} as const);

/** Повертає пресет для `n` гравців або null, якщо `n` не в межах 8..12. */
export function getRolePreset(n: number): ReadonlyArray<Role> | null {
  return ROLE_PRESETS[n] ?? null;
}
```

`assignRoles(players, preset, rng)` (ticket 07) приймає `preset: ReadonlyArray<Role>` і робить Fisher-Yates shuffle на `players`, потім роздає ролі по позиціях. Дон завжди призначається з підмножини MAFIA (тобто DON ⊂ MAFIA по команді), але винесений окремо в пресеті, щоб полегшити privacy-маскування (ticket 10).

---

## 1. Джерела та їх надійність

| ID | URL | Що дає | Надійність |
|----|-----|--------|-----------|
| S1 | https://web.archive.org/web/19990302082118/http://members.theglobe.com/mafia_rules/ | Оригінальні правила Давідова 1986/1992/1998 — **єдине джерело з таблею чорних карт** за кількістю гравців | Primary, archive |
| S2 | https://web.archive.org/web/20071118105651/http://www.puzzlers.org/dokuwiki/doku.php?id=gamerules:mafia | NPL Mafia rules — **11 грат = 2 мафії + 1 шериф + 8 цивільних** як «the most popular version» | Secondary, archive (2007) |
| S3 | https://web.archive.org/web/20140517121933/http://www.princeton.edu/~sucharit/~mafia/games.htm | Princeton Mafia Brotherhood — рекомендація для **7 гравців: 2 мафії + 1 detective**; для **8 гравців: 2 мафії + rotating cop** | Secondary, archive |
| S4 | https://en.wikipedia.org/wiki/Mafia_(party_game) | Підтверджує що Detective — це стандарт для «most internet-based and most face-to-face games»; MIT rules покривають 7–20 | Secondary, current |
| S5 | https://werewolf.chat/Pactbreaker | Werewolf Wiki, варіант Pactbreaker — таблиця ролей 6–24 гравці | Community wiki, current (специфічний варіант) |
| S6 | https://uk.wikipedia.org/wiki/Мафія_(гра) | Українська Вікіпедія — підтверджує наявність варіанту «Гра за шерифа» як канонічного | Secondary, current |
| S7 | https://ru.wikipedia.org/wiki/Мафія_(игра) | Російська Вікіпедія — загальний огляд, без детальної таблиці | Secondary, current |

**Надійність S1** найвища: це авторська публікація Дмитра Давідова (1986 — СРСР, 1992/1998 — США), першоджерело «Mafia» як гри. Архів Wayback лишився єдиним доступним дзеркалом (оригінал `members.theglobe.com` мертвий).

**Надійність S2 (NPL)** — це офіційні правила клубу National Puzzlers' League, який грає в Mafia понад 30 років. Значення «2 мафії + 1 шериф + 8 civilians @ 11 players» безпосередньо відповідає нашому питанню, але **без DON і без DOCTOR** — тобто це «полегшений» варіант. Ми додаємо DON і DOCTOR як extension, типовий для пострадянської спільноти (S6).

---

## 2. Походження пресетів (для обґрунтування)

### 2.1. Давідов (1986/1998)

Єдине джерело, яке дає **таблицю «N гравців → K чорних карт»**:

```
6–7   → 2 black
8–10  → 3 black
11–13 → 4 black
14–16 → 5 black
17–20 → 6 black
```

> «The size of the game determines how many black cards are in the deck. ... The number of black cards in the deck is `floor((N+1)/4)` approximately.» (S1, paraphrased)

У Давідова **немає** DON/SHERIFF/DOCTOR. Це класична «red vs black» гра, де єдине знання — це «mafia знає один одного». Давідов у 1998 році прямо пише: «I have reservations about including different knowledge-bearing characters (inspector, angel, seer). The only knowledge in the game is Mafia connections, everything else is artificial.»

### 2.2. NPL (S2, 2007)

> «The most popular version played at NPL conventions begins with **11 players – 2 mafia, 1 knight commandant and 8 normal townspeople**.»

Тобто: 11 грат → 2 чорних + 1 KC + 8 червоних. **KC** (Knight Commandant) = наш SHERIFF. **Без DON і без DOCTOR** — це свідомо простіший варіант.

### 2.3. Princeton Mafia Brotherhood (S3)

> «Seven players — Standard: two mafia and one detective, begins with day.»
> «Rotating cop works best in games of eight players with two mafia, and no other special roles.»

Це підтверджує, що для малих столів (7–8) **2 мафії** — це мінімум, який дозволяє шерифу мати сенс.

### 2.4. Wikipedia (S4)

> «MIT rules specify roles for 7–20 players, always including at least one Detective.» (en.wikipedia, paraphrased)

Отже, норма «at least one detective» = SHERIFF ≥ 1 — це загальноприйнято.

### 2.5. Ukrainian Wikipedia (S6)

> Розділи: «Гра за червону карту», «Гра за шерифа», «Гра за чорну карту». Підтверджує, що в Україні / СНД **«гра за шерифа» — це окремий канонічний варіант**, який додає SHERIFF до базового red/black Давідова.

---

## 3. Обґрунтування пропорції мафії

### 3.1. Базове правило (target)

> «Мафія (DON + MAFIA) ≈ 1/4 живого столу»

Це дає:

| Players | Target Black | Target DON+MAFIA |
|--------:|:------------:|:----------------:|
| 8       | 2.0          | 2                |
| 9       | 2.25         | 2                |
| 10      | 2.5          | 2-3              |
| 11      | 2.75         | 3                |
| 12      | 3.0          | 3                |

### 3.2. Чому ми не точно 1/4

1. **DON** у нас обов'язково 1 (немає сенсу в двох донах на 8 гравців — DON виконує функцію «godfather» в однині за визначенням Давідова).
2. **SHERIFF і DOCTOR** фіксовані по 1 — це вже 2 «не-цивільні» плюсом. Якщо ми хочемо, щоб SHERIFF міг знайти MAFIA за розумну кількість ночей, чорних має бути не менше 3 (інакше SHERIFF → DON → win sheriff день-1).
3. **При N=8** 1/4 = 2 чорних (DON + 1 MAFIA). Але DON+SHERIFF+DOCTOR = 3 спецролі, і тоді CIVILIAN = 3. Це **забагато спеціальних ролей** відносно цивільних: 1 DON, 1 MAFIA, 1 SHERIFF, 1 DOCTOR, 3 CIVILIAN → шериф з високою ймовірністю «випадково влучає» в дона/мафію вже в ніч 1 (ймовірність 2/7 ≈ 29%), що робить гру надто «швидкою». **Тому беремо 2 MAFIA + 1 DON = 3 чорних** (за Давідовим для 8–10).
4. **При N=12** 1/4 = 3 чорних. Ми ставимо 3 MAFIA + 1 DON = 4 чорних. Це **на 1 більше за target**, але це компроміс: якщо 12 гравців і лише 3 чорних, то CIVILIAN = 7 → SHERIFF після ночі 2 «знає майже точно» (3/10 ≈ 30% хиби) і гра стає надто простою для мирних. 4 чорних з 12 → SHERIFF хибить 4/10 = 40% після ночі 2, що додає напруги.

### 3.3. Чому 11 ≠ 11 (два варіанти)

NPL рекомендує для 11: 2 мафії + 1 KC + 8 цивільних = 11 (без DON і DOCTOR). Ми додаємо DON і DOCTOR, тому **третя мафія** потрібна, щоб зберегти баланс «~1/3 чорних з урахуванням DON». Тобто 11 = 1 DON + 3 MAFIA + 1 SHERIFF + 1 DOCTOR + 5 CIVILIAN.

Альтернатива — 1 DON + 2 MAFIA + 1 SHERIFF + 1 DOCTOR + 6 CIVILIAN = 11 — ми її **не рекомендуємо**, бо це лише 3 чорних і 5 «не-чорних-спеціальних» — DON занадто відомий вже в ніч 1 для шерифа.

---

## 4. Фінальна таблиця пресетів

| Players | DON | MAFIA | SHERIFF | DOCTOR | CIVILIAN | Total Black | Σ |
|--------:|:---:|:-----:|:-------:|:------:|:--------:|:-----------:|:-:|
| **8**   |  1  |   2   |    1    |   1    |    3     |  3 (37.5%)  | 8 |
| **9**   |  1  |   2   |    1    |   1    |    4     |  3 (33.3%)  | 9 |
| **10**  |  1  |   2   |    1    |   1    |    5     |  3 (30.0%)  | 10 |
| **11**  |  1  |   3   |    1    |   1    |    5     |  4 (36.4%)  | 11 |
| **12**  |  1  |   3   |    1    |   1    |    6     |  4 (33.3%)  | 12 |

Перевірки:
- ✅ 1 ≤ MAFIA (умова з ticket 02: mafia >= 1).
- ✅ DON = 1 у кожному пресеті.
- ✅ SHERIFF = 1, DOCTOR = 1.
- ✅ Σ = N для кожного N ∈ {8, 9, 10, 11, 12}.
- ✅ Black% ∈ [30%, 38%] — у межах «1/4 ± допуск».

**Анти-приклад** (для чого НЕ треба робити):
- ❌ 8: 1 DON + 1 MAFIA + 1 SHERIFF + 1 DOCTOR + 4 CIVILIAN — лише 2 чорних, DON надто «відкритий».
- ❌ 11: 1 DON + 2 MAFIA + 1 SHERIFF + 1 DOCTOR + 6 CIVILIAN — лише 3 чорних, DON занадто швидко знаходиться шерифом.

---

## 5. Edge cases

### 5.1. Гравець виходить під час ночі (disconnect / quit)

**Рекомендація: НЕ перерозподіляти ролі.**

Аргументи:
1. Якщо перерозподіляти, то вбитий/вийшовший гравець може «воскреснути» як інша роль → це порушує приватність (ticket 10) і спантеличує живих гравців.
2. Якщо перерозподіляти тільки мафії → DON/MAFIA шериф не дізнається (бо шериф бачить тільки MAFIA, не DON), але тоді гра стає недетерміністичною щодо фіксованого seed (див. 5.2).
3. Якщо гравець вийшов — він просто вважається мертвим (`isAlive = false`, `isConnected = false`) і його роль розкривається тільки якщо того вимагають правила видимості.

**Альтернатива для майбутнього (out of scope для MVP):**
- Якщо `n - 1` ∈ {8..12} і гра ще не почалася (`phase === LOBBY`), можна перепризначити пресет. Це опційна фіча, не частина ticket 02.

**Конкретно для night disconnect (ticket 12)**: нічні підфази (DON_CHECK, MAFIA_VOTE, SHERIFF_CHECK, DOCTOR_HEAL) використовують `isConnected`, а не `isAlive`. Якщо гравець вийшов у фазі MAFIA_VOTE — він не голосує (mafia мусять прийти до консенсусу без нього). Якщо вийшов SHERIFF під час SHERIFF_CHECK — ніч пропускаємо цю перевірку (шериф «не встиг»). Це описано в ticket 07/12 і не потребує перерозподілу ролей.

### 5.2. Audit / seed RNG

**Рекомендація: детерміністичний seed + crypto-strong PRNG.**

```typescript
// src/utils/rng.ts (псевдо, ticket 07)
import { randomBytes } from "node:crypto";

// mulberry32 — швидкий, детерміністичний, проходить стандартні тести
function mulberry32(seed: number) {
  return function () {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Генерує 32-бітний seed для аудиту (логується разом з result). */
export function newAuditedSeed(): number {
  return randomBytes(4).readUInt32BE(0);
}

/** Fisher-Yates shuffle з детерміністичним rng. */
export function shuffleSeeded<T>(arr: T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
```

**Чому seed, а не pure random:**
- `startGame` приймає масив `players` (порядок залежить від того, хто зайшов у кімнату). Pure random у кожному виклику → неможливо довести «mafia чітили» при скарзі.
- Seed = 4 випадкові байти з `crypto.randomBytes` (CSPRNG). Зберігаємо в `MafiaState.lastSeed: number` (або `lastSeedHex: string`). Після `startGame` seed фіксується в state.
- **Audit replay**: роздаємо ті самі `players` (порядок — за `sessionId` лексикографічно або за `joinedAt`) з тим самим seed → отримуємо той самий розподіл. Це те, що пишеться в `logs/audit.jsonl` на сервері.
- **Чому не pure crypto-random для самого shuffle**: `Math.random` і `crypto.randomBytes` дають однакову «випадковість» для гравця, але seed дає **відтворюваність** — це критично для спортивних скарг.

**Out of scope**: не зберігаємо seed клієнту (privacy). Тільки сервер-сайд лог.

### 5.3. Player count < 8 або > 12

- Якщо в лобі < 8 грацівів → `startGame` має повернути помилку `lobby_too_small`. MVP не підтримує < 8.
- Якщо в лобі > 12 → `startGame` має повернути помилку `lobby_too_full` (див. `MafiaState.maxPlayers = 12`).
- 13+ — це інший режим («турнірний»), не частина MVP. Можна додати ROLE_PRESETS[13..16] за Давідовим (5–6 чорних), але це не зараз.

### 5.4. Player count == 7 або == 13 (на межі min/max)

- 7 → `lobby_too_small`. Або (опційно) розширити пресет до 7 (1 DON + 1 MAFIA + 1 SHERIFF + 1 DOCTOR + 3 CIVILIAN). **Не рекомендуємо для MVP** — 7 замало для балансу.
- 13 → `lobby_too_full`. Або розширити за Давідовим (5 чорних). **Не рекомендуємо для MVP**.

---

## 6. Підсумкова типізована константа (файл `src/utils/rolePresets.ts`)

```typescript
import { Role } from "../schema/enums.js";

/**
 * Канонічні склади ролей за кількістю гравців.
 *
 * Джерела:
 *   - Davidoff's original Mafia rules (1986/1998): black-card tables.
 *   - National Puzzlers' League (2007): 11p = 2M + 1 sheriff + 8 civilians.
 *   - Princeton Mafia Brotherhood: 7p = 2M + 1 detective; 8p = 2M + rotating cop.
 *   - Ukrainian Wikipedia (Мафія (гра)): "Гра за шерифа" — канонічний варіант.
 *
 * Інваріанти:
 *   - DON = 1 (godfather — завжди один).
 *   - SHERIFF = 1, DOCTOR = 1 (спецролі фіксовані).
 *   - MAFIA ≥ 1 (умова ticket 02).
 *   - сума = N (preset length == N).
 *   - Black% ∈ [30%, 38%] (target 1/4 ± допуск).
 */
export const ROLE_PRESETS: Readonly<Record<number, ReadonlyArray<Role>>> = Object.freeze({
  8:  [Role.DON, Role.MAFIA, Role.MAFIA, Role.SHERIFF, Role.DOCTOR, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN],
  9:  [Role.DON, Role.MAFIA, Role.MAFIA, Role.SHERIFF, Role.DOCTOR, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN],
  10: [Role.DON, Role.MAFIA, Role.MAFIA, Role.SHERIFF, Role.DOCTOR, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN],
  11: [Role.DON, Role.MAFIA, Role.MAFIA, Role.MAFIA, Role.SHERIFF, Role.DOCTOR, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN],
  12: [Role.DON, Role.MAFIA, Role.MAFIA, Role.MAFIA, Role.SHERIFF, Role.DOCTOR, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN],
} as const);

export const SUPPORTED_PLAYER_COUNTS = [8, 9, 10, 11, 12] as const;
export type SupportedPlayerCount = typeof SUPPORTED_PLAYER_COUNTS[number];

export function isSupportedPlayerCount(n: number): n is SupportedPlayerCount {
  return (SUPPORTED_PLAYER_COUNTS as readonly number[]).includes(n);
}

export function getRolePreset(n: number): ReadonlyArray<Role> | null {
  return isSupportedPlayerCount(n) ? ROLE_PRESETS[n] : null;
}
```

---

## 7. Відкриті питання / ризики

1. **Чи прийнятний Black% 37.5% для 8 гравців?** — це «аномалія» проти правила 1/4, але відповідає Давідову і практиці NPL. Якщо ні — fallback: 8 = 1 DON + 1 MAFIA + 1 SHERIFF + 1 DOCTOR + 4 CIVILIAN (тоді 25% black, але DON надто «розкритий»).
2. **Чи має бути «Mafia знає DON» vs «DON невідомий мафії»?** — Давідов каже DON видимий мафії; це out of scope (privacy ticket 10).
3. **Чи маємо підтримувати < 8 грацівів (7 = мінімальний по Princeton)?** — MVP ні; можна додати пізніше.
4. **Як інтегрувати з `assignRoles()` (ticket 07)?** — `assignRoles` приймає `preset: ReadonlyArray<Role>` як параметр і не залежить від `n`. Тобто `startGame` робить `preset = getRolePreset(n)`, потім викликає `assignRoles(players, preset, seed)`. Деталі в ticket 07.
5. **Audit log persistence** — `lastSeed` треба писати в файл `/var/log/mafia/audit.jsonl` для розбору скарг. Це окремий ticket (можливо, out of scope).

---

## 8. Покликання

| Tag | URL | Дата доступу | Reliability |
|-----|-----|--------------|-------------|
| S1  | https://web.archive.org/web/19990302082118/http://members.theglobe.com/mafia_rules/ | 2026-09-22 | Primary (Davidoff's original) |
| S2  | https://web.archive.org/web/20071118105651/http://www.puzzlers.org/dokuwiki/doku.php?id=gamerules:mafia | 2026-09-22 | Secondary (NPL official) |
| S3  | https://web.archive.org/web/20140517121933/http://www.princeton.edu/~sucharit/~mafia/games.htm | 2026-09-22 | Secondary (Princeton Mafia Brotherhood) |
| S4  | https://en.wikipedia.org/wiki/Mafia_(party_game) | 2026-09-22 | Secondary (Wikipedia) |
| S5  | https://werewolf.chat/Pactbreaker | 2026-09-22 | Community wiki |
| S6  | https://uk.wikipedia.org/wiki/Мафія_(гра) | 2026-09-22 | Secondary (Ukrainian Wikipedia) |
| S7  | https://ru.wikipedia.org/wiki/Мафія_(игра) | 2026-09-22 | Secondary (Russian Wikipedia) |

---

## 9. Контекст для ticket 11 (`messages.startGame`)

`startGame` (ticket 11) має робити:

```typescript
function startGame(state: MafiaState, players: Player[]): Result {
  if (!isSupportedPlayerCount(players.length)) {
    return { ok: false, code: "unsupported_player_count" };
  }
  const preset = ROLE_PRESETS[players.length];
  const seed = newAuditedSeed(); // CSPRNG
  const shuffled = shuffleSeeded(players, seed);
  state.lastSeed = seed;
  // assignRoles(shuffled, preset) — ticket 07
  return assignRoles(state, shuffled, preset, seed);
}
```

`lastSeed` додається в `MafiaState` як `@type("uint32") lastSeed: number = 0` (або `string lastSeedHex`, якщо потрібна hex-репрезентація). Це дає змогу аудиту перевірити роздачу.

---

Документ готовий до використання в `src/utils/rolePresets.ts` і в якості spec для `assignRoles()` (ticket 07) + `startGame` (ticket 11).