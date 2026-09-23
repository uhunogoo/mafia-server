# 10 — Privacy model for player.role in Colyseus schema

Type: research
Status: resolved
Blocked by: (none)

## Answer

**Ключове відкриття**: `@visibility("owner")` **не існує** в `@colyseus/schema` 4.x/5.x. Реальний механізм — `@view(tag)` + `client.view.add(player, tag)`. Повний матеріал у `research/10-schema-privacy.md`.

**Ухвалені рішення:**

- **Основний механізм**: `@type("string") @view(1)` на `Player.role` і `Player.team`. Константа `OWNER_VIEW_TAG = 1` експортується з `PlayerState.ts`. На призначенні ролі сервер викликає `ownerClient.view.add(player, 1)`.
- **GAME_OVER reveal** — runtime flip через `client.view.add(player, 1)` для кожного клієнта. **Без schema swap**, без рестарту клієнта.
- **Додатковий механізм**: `client.send("yourRole", { role })` одразу після призначення — щоб UI показав роль до першого state patch (косметика).
- **Сервер завжди читає `player.role` напряму** — `@view` обмежує тільки байти в encoder, а не JS instance.
- **`onAuth` НЕ повертає role** — не підходить (ролі призначаються після join, залежать від кількості гравців і хоста).

**Edge case (reconnection)**: `client.view` трансплантується зі старого клієнта на новий у `allowReconnection` (збігається з `sessionId`), тож owner-патерн працює. Якщо колись зробимо seat swap — доведеться перевидати tag.

**УВАГА — version skew**: `package.json` каже `@colyseus/schema@^4.0.0` (lockfile 4.0.31), але `node_modules/@colyseus/schema/package.json` = **5.0.33**. Семантика `@view` однакова в обох, тож код працює, але **перед додаванням нових полів треба вирішити**: оновити `package.json` до `^5.0.0` і перегенерувати lockfile, або зробити `npm install` для вирівнювання на 4.0.31.

**Tag convention**: біт `1` зарезервовано для OWNER_VIEW. Якщо додаватимуться інші фільтри (mafia-chat, sheriff-target), їх треба виділити в окремі біти і задокументувати в коментарі.

Context pointer: `research/10-schema-privacy.md`.

## Question

Як сховати `player.role` (і пов'язані поля типу `team`, `isSheriff`, `lastDoctorHealTargetId`) від інших гравців, залишаючи їх доступними серверній логіці?

З регламенту: «Secret until the end. After death or elimination, a player's role is not revealed until the entire game is over».

Потрібно дослідити Colyseus 0.17 API:

1. **`@visibility("owner")`** декоратор — чи є такий у `@colyseus/schema` 4.0? Якщо так — як використовувати?

2. **Альтернатива через маскування**: `client.send("private", { role: ... })` напряму, не через state.

3. **Pattern: serverOnly state**: `state` доступний гравцям, але `serverState` (окрема мапа) — ні. Чи це вбудовано, чи треба робити вручну?

4. **`onAuth` повертає дані**, які гравець бачить локально (але вони не в state, тому інші не бачать). Це вже використовується в `Auth.onAuth` для повернення `name`. Чи можемо повертати `role`?

5. **Які саме поля приватні**:
   - `player.role` (CIVILIAN/SHERIFF/DOCTOR/MAFIA/DON)
   - `player.team` (RED/BLACK)
   - `player.lastDoctorHealTargetId` (для лікаря)
   - `player.deathNight` (коли вбито)

6. **Server-only fields** для внутрішньої логіки:
   - `state.players[i].role` — сервер читає в обробниках `submitSheriffCheck`, `submitDonCheck`
   - сервер пише в `state.roleLogs[...].actorId` — це вже не приватне (ідентифікатори видимі всім)

Відповідь має містити:

- Конкретний синтаксис Colyseus 0.17 для приватності
- Приклад коду `Player` schema з приватними полями
- Рекомендація: `@visibility("owner")` vs маскування vs `client.send` для кожного поля
- Посилання на документацію Colyseus

## Out of scope

- Поведінка самого клієнта (UI маскування)
- Post-game розкриття ролей (`roleVisible = true` для всіх у `GAME_OVER` — це ticket 08/11)