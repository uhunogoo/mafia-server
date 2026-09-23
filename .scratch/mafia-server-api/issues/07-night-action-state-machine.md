# 07 — Night action state machine

Type: grilling
Status: open
Blocked by: (none)

## Question

Як сервер керує нічними фазами `NIGHT_MAFIA → NIGHT_DON_CHECK → NIGHT_SHERIFF_CHECK → NIGHT_DOCTOR_HEAL → DAY_ANNOUNCE`, враховуючи host-driven управління і test night?

Потрібно:

1. **Lifecycle нічного вікна** (на прикладі mafia):
   ```
   сервер.phase = NIGHT_MAFIA
     ↓
   mafia players бачать state.nightAction.open = "mafia"
     ↓
   кожен mafia member тапає ціль → state.nightAction.targets[sessionId] = candidateId
     ↓
   host: "mafia sleeping" → handler confirmNightAction → підраховує найчастішу ціль
     ↓
   state.nightAction.mafiaTargetId = ... (записується в mafiaLog)
     ↓
   сервер.phase = NIGHT_DON_CHECK
   ```

2. **State нічного вікна**:
   ```typescript
   class NightActionState extends Schema {
     @type("string") phase: "mafia" | "don_check" | "sheriff_check" | "doctor_heal" | "closed";
     @type(WeekMap) targets = new MapSchema<string>();  // sessionId → targetId
     @type("string") resolvedTargetId: string = "";
     @type("string") resolvedResult: string = "";       // для don/sheriff (yes/no, red/black)
     @type("number") nightCount: number = 0;
   }
   ```

3. **Test night (nightCount = 1)**: сервер блокує `resolvedTargetId` для мафії (нема вбивства), але don/sheriff/doctor працюють. Чи потрібен окремий `isTestNight` boolean чи достатньо `if (nightCount === 1) skip mafia resolve`?

4. **Лікар restriction** (не можна ту ж ціль 2 ночі поспіль, включно з собою):
   - Де зберігати: `state.lastDoctorHealTargetId` чи `player.doctorLastHealNight: number`?
   - Хто валідує: handler `submitDoctorHeal` перевіряє перед записом?

5. **Дон check**: сервер знає `players[targetId].isSheriff === true` (через приватне поле — ticket 10). Повертає `"yes"` якщо target — шериф, інакше `"no"`. Записує в `donLog`.

6. **Шериф check**: сервер знає `players[targetId].team === BLACK` (дон бачиться black для шерифа). Повертає `"black"` для чорних, `"red"` для червоних.

7. **Reconnect під час ночі** (ticket 12): чи вікно тримається відкритим для гравця, який дисконектнув?

8. **Як ведучий повідомляє результат мафії гравцям?** Мафія знає свою ціль (це в їх лозі). Дон/шериф/лікар знають свій результат (через свій лог). Ведучий бачить усі логи.

9. **Перехід в DAY_ANNOUNCE**: хто ініціює? Ведучий після всіх 4-х нічних вікон?

## Out of scope

- UI анімації нічних пробуджень (клієнт)
- Звукові ефекти (клієнт)