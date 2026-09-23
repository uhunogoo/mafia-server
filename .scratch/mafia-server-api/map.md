# Map: mafia-server-api

> Працюючий сервер онлайн-гри «Мафія» з повним набором правил і пінг-системою.

## Destination

Працюючий Colyseus-сервер, що веде гру «Мафія» з:

- Усі правила з канонічного регламенту реалізовані (ролі, денний/нічний цикл, голосування, умови перемоги)
- Host-driven модель: ведучий — це `Player` з `isHost=true`, без ролі та права голосу; він записує дії і запускає глобальні фази
- Пінг-система: новачки використовують визначені чіпи як жести, видимість керується контекстом (ніч vs день, приналежність до ролі)
- Сервер автоматизує там, де це знімає тертя: порядок промов, таймери час-обмежених фаз, перевірка перемоги
- Увесь стан — у пам'яті процесу (без persistence для MVP)

## Notes

- **Стек**: Colyseus 0.17, TypeScript 5, Node 20.9+, mocha + `@colyseus/testing`
- **Код ідентифікаторами та схемами — англійською**; документація, коментарі, повідомлення UI — українською
- **Пінги ефемерні**: відображаються в поточному `state` активної фази, очищаються при переході фази, **ніколи** не записуються в довгостроковий лог
- **Role-logs**: кожна активна роль (mafia, don, sheriff, doctor) має власний лог дій, видимий їй + ведучому; ведучий бачить усі логи одночасно
- **Перехід фаз**: глобальний перехід (startNight, beginSpeeches, тощо) — host-triggered; інтро-фазний рух — стейт-керований (наприклад, таймер промови сам перемикає на наступного промовця)
- **Скелет вже існує**: `mafia-server` (Colyseus room, базовий auth, schema-заглушки). Мапа веде до наповнення цього скелета.

## Decisions so far

- [02-role-assignment-tables](issues/02-role-assignment-tables.md): Davidoff + Slavic. 8/9/10 = 1DON+2MAFIA+1SHER+1DOC+(3-5)CIV; 11/12 = 1DON+3MAFIA+1SHER+1DOC+(5-6)CIV. Disconnect → НЕ перерозподіляти; seed RNG (CSPRNG + mulberry32) для аудиту; <8→too_small, >12→too_full — `research/02-role-assignment-tables.md`
- [04-ping-visibility-matrix](issues/04-ping-visibility-matrix.md): 19 чіпів × 4 контексти в `PING_RULES`, `canSend`/`canSee` специфікації, active-question=strict, timeout=17.5с, 8 ambiguities відкриті — `research/04-ping-visibility-matrix.md`
- [08-win-condition-detection](issues/08-win-condition-detection.md): `applyWinCondition()` після кожної зміни `isAlive`; порядок `blacks===0→red` перед `blacks≥reds→black`; mid-day stop через нічний resolve; `roleVisible=true` + `state.winner` у GAME_OVER; host виключається з підрахунку — `research/08-win-condition-detection.md`
- [10-schema-privacy](issues/10-schema-privacy.md): `@visibility("owner")` не існує — реальний механізм `@view(1)` + `client.view.add(player, 1)`. `OWNER_VIEW_TAG=1` для `role`/`team`. GAME_OVER = runtime flip через view.add для всіх клієнтів. Сервер читає `player.role` напряму (тільки encoder фільтрує). УВАГА: version skew `package.json@^4.0.0` vs `node_modules@5.0.33` — треба вирішити — `research/10-schema-privacy.md`

### З гриля 1 (призначення / форма автоматизації)

- **Deliverable**: працюючий сервер з усіма правилами та пінгом
- **Host model**: ведучий — `Player` з `isHost=true`, не грає, не отримує роль, не голосує
- **Філософія автоматизації**: стейт-керована, mix auto/host-input. Сервер: порядок промов + таймери фаз + перевірка перемоги. Ведучий: номінації, голоси (counts), нічні дії, прогресія нічних вікон.

### З гриля 2 (правила нічної/денної частин)

- **Role assignment**: сервер випадково з preset-таблиці за кількістю гравців (наприклад, 10 → 1 don + 2 mafia + 1 sheriff + 1 doctor + 5 civilian)
- **Voting**: host-mediated. Ведучий оголошує «хто за N», рахує підняті руки, передає серверу. «Утримались» зараховуються до останнього кандидата в черзі. Tie → revote між лідерами; tie вдруге → auto-pardon.
- **Night flow**: host-driven. Сервер відкриває вікна дій, ведучий каже «прокидається мафія» → чекає вводу → каже «спить» → перемикає на дон/шериф/лікар. Жодних time-limits на нічних фазах.
- **Persistence**: чисто в пам'яті. Без БД, без Redis, без снепшотів.

### З гриля 3 (секрети, номінації, фази)

- **Check delivery**: кожна роль бачить свій лог; ведучий бачить усі логи. Mafia-лог спільний для мафії+дона, окремі логи для шерифа та лікаря.
- **First speaker Day 1**: гравець із seat #1. З кожним наступним днем — зсув на +1 seat (round-robin).
- **Nominations**: лише під час своєї промови. Інтерфейс «номінувати X» доступний тільки коли `currentSpeaker == sender`.
- **Phase advance**: глобальний перехід (start night/day/balagan/speeches/defense/last word) — host-triggered. Усередині фаз — стейт-керовано.

## Not yet specified

- Точна таксономія фаз і граф переходів (ticket 01)
- Структура per-role логів і що в них потрапляє (ticket 03)
- Протокол передачі vote-counts від хоста: формат повідомлення, tie/revote/auto-pardon логіка (ticket 05)
- Структура черги промов і порядку захисту (ticket 06)
- Night action state machine: послідовність вікон, обмеження (лікар — не та ж ціль два рані), test night (ticket 07)
- Anti-spam модель для пінгів (ticket 09) — unblocked після 04
- Чорновик схеми стану (prototype, ticket 11) — blocked by 01, 03, 05, 06, 07
- Політика reconnection під час ночі (ticket 12)
- Перелік test cases на кожне правило (ticket 13) — blocked by 01-12
- Початковий глосарій у `CONTEXT.md` (ticket 14) — blocked by 03, 11

## Open ambiguities (для grilling у наступних сесіях)

_З ticket 04 (ping visibility matrix) — 8 пунктів:_

1. Чи civilian може слати «так/ні» в ніч? (зараз: ні)
2. «Хочу слово» — аудиторія: тільки host чи всі живі?
3. «Я мирний» — обмежити роллю CIVILIAN чи ні?
4. «1 active question» — strict чи м'якше?
5. Host бачить «answer» пінги чи ні?
6. Таймаут: 15, 17.5 чи 20 секунд?
7. «Так/ні» в ніч vs як відповідь — той самий чіп чи різні?
8. `DAY_REVOTE` теж вимикає пінги?

## Out of scope

_(поки порожньо)_