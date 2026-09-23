# 13 — Test case enumeration per rule

Type: research
Status: open
Blocked by: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12

## Question

Скласти повний перелік test cases, який покриває кожне правило регламенту + кожен edge case з ticket 01-12.

Потрібно:

1. **Per-rule test matrix**:
   - Кожне правило з регламенту — мінімум 1 happy path + 1 edge case
   - Приклад: «Doctor cannot heal same target twice» → 1 тест (target A в N1, target A в N2 → reject), 1 тест (target A в N1, target B в N2 → ok), 1 тест (target self в N1, target self в N2 → reject), 1 тест (target self в N1, target A в N2 → ok)

2. **Per-phase coverage**:
   - WAITING → startGame (з 8/9/10/11/12 гравцями)
   - NIGHT_MAFIA (test night, normal night, vote tie, vote single)
   - NIGHT_DON_CHECK (yes, no)
   - NIGHT_SHERIFF_CHECK (red, black, don як black)
   - NIGHT_DOCTOR_HEAL (different, same, self twice)
   - DAY_ANNOUNCE
   - DAY_BALAGAN
   - DAY_SPEECHES (timer expires, speaker disconnects)
   - DAY_DEFENSE (timer expires, multiple candidates)
   - DAY_VOTE (unanimous, tie, auto-pardon)
   - DAY_REVOTE (between 2, tie again → game continues to night)
   - GAME_OVER (mafia wins mid-day, civilians win mid-day)

3. **Per-ping coverage**:
   - Кожен чіп × кожен контекст (з ticket 04)
   - Таймаут 15-20с
   - «1 active question per player»
   - Dead player spam → reject

4. **Reconnection coverage** (ticket 12):
   - Mafia disconnect mid-night
   - Don disconnect mid-night
   - Reconnect within 30с
   - Reconnect after 30с → kicked out

5. **Всього орієнтовно 60-100 test cases**.

Відповідь — це файл `test/cases.md` (або `test/rules.test.ts` зі специфікаціями).

## Out of scope

- Реалізація самих тестів (наступний крок після затвердження списку)
- E2E тести з клієнтом (зараз сервер тільки)