# 04 — Ping visibility matrix

Type: research
Status: resolved
Blocked by: (none)

## Answer

Вичерпна матриця 19 чіпів × 4 контексти зібрана. Повний документ з `PING_RULES` (TypeScript-константа), `canSend()` / `canSee()` псевдокодом і специфікацією active-question/timeout/dead-handling збережено в `research/04-ping-visibility-matrix.md`.

**Ключові рішення, що вже зафіксовані в матриці:**

- 19 чіпів розділені на 5 категорій (5 нічних, 4 реакції на промову, 6 денних загальних, 4 відповіді)
- Контексти: `night_mafia`, `day_speech`, `day_general`, `answer`
- `PING_DISABLED_PHASES` = `DAY_VOTE`, `DAY_REVOTE`, `DAY_DEFENSE`, `NIGHT_DON_CHECK`, `NIGHT_SHERIFF_CHECK`, `NIGHT_DOCTOR_HEAL` (цивільні не пінгують у нічних підфазах)
- `PingInstance` schema з `expiresAt = sentAt + 17.5s` (середина діапазону 15-20с)
- Active-question: strict семантика — combined ≤ 1 (asker АБО addressee)
- При смерті гравця сервер негайно інвалідує всі його активні пінги
- Phase transition → invalidation решти `activePings`
- Host бачить усе (per map.md); dead non-host не бачить нічого

**8 двозначностей відкрито** (потребують уточнення):

1. Чи civilian може слати «так/ні» в ніч (зараз: ні)
2. «Хочу слово» — аудиторія: тільки host чи всі живі
3. «Я мирний» — обмежити роллю CIVILIAN чи ні
4. Strict vs м'якша семантика «1 active question»
5. Host бачить «answer» пінги чи ні
6. Таймаут: 15, 17.5 чи 20 секунд
7. «Так/ні» в ніч і «так/ні» як відповідь — той самий чіп чи різні (зараз: різні)
8. Чи `DAY_REVOTE` теж вимикає пінги (зараз: так)

Context pointer: `research/04-ping-visibility-matrix.md`.

## Question

Вичерпна матриця: для кожного пінг-чіпа × контексту × глядача — хто бачить?

З регламенту користувача маємо список чіпів і контекстів. Потрібно формалізувати у вигляді lookup-таблиці, яку можна використати в коді.

Контексти (з регламенту):
- NIGHT, mafia window — тільки живі мафія (з доном)
- DAY, чужа промова — усі живі
- DAY, будь-який час — усі живі
- Відповідь на ping — обмежене коло (адресат → питач)
- Voting / last word / night для цивільних / після смерті — пінги вимкнені

Чіпи (з регламенту):
- Нічні: 🎯 «стріляємо» (target), «згодні?», «так», «ні», «чекай»
- Реакції на чужу промову: «+1», «довіряю», «не довіряю», «не сходиться»
- Денні загальні: «підозрюю» (target), «довіряю» (target), «яка думка?» (target), «голосуймо» (target), «я мирний», «хочу слово» (→ хост)
- Відповіді: «так», «ні», «сумнів», «потім»

Відповідь має містити:

1. **TypeScript-константу** типу:

   ```typescript
   const PING_RULES = {
     "mafia_target": { context: "night_mafia", viewer: ["mafia", "don", "host"], target: "any_alive" },
     "balagan_trust": { context: "day_balagan", viewer: ["any_alive", "host"], target: "any_alive" },
     ...
   } as const;
   ```

2. **Функцію `canSend(sender, chip, context)` → `boolean`** і **`canSee(viewer, chip, context, target)` → `boolean`**.
3. **Специфікація «одне активне питання на гравця»**: де це перевіряється, що зберігається (масив активних запитів у state?).
4. **Специфікація таймауту 15-20с**: що саме зникає (бейдж? увесь пінг? лог-запис?), чи записується «проігноровано» в лог.
5. **Мертві втрачають пінги**: у яку мить це перевіряється — при спробі надіслати, чи стан синхронізується за `isAlive`.

## Out of scope

- Реалізація handler'ів (це ticket 11/05)
- Клієнтський UI для відображення бейджів (це UI, не сервер)