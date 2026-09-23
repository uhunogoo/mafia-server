# 01 — Phase taxonomy and transitions

Type: grilling
Status: open
Blocked by: (none)

## Question

Який саме список фаз має існувати в `GamePhase` і як вони переходять одна в одну?

З регламенту маємо: ніч → оголошення вимоги → промови → дебати (BALAGAN) → захист → голосування → (revote → auto-pardon) → ніч.

А також host-triggered мікрофази всередині ночі: mafia → don → sheriff → doctor.

Потрібно:

1. **Фінальний перелік фаз** (canonical назви для enum): усунути дублікати `DAY_ANNOUNCE`/`DAY_ANNOUNCEMENT`, додати чіткі підфази для нічної дії (`NIGHT_MAFIA`, `NIGHT_DON_CHECK`, `NIGHT_SHERIFF_CHECK`, `NIGHT_DOCTOR_HEAL`)
2. **Граф переходів**: які переходи host-triggered, які state-driven (auto)
3. **Terminal phase**: чи це `ENDED`, чи окрема фаза `GAME_OVER` з полями `winningTeam`, `playerRoles` для розкриття
4. **Тестова ніч (Night 1)**: чи це окрема підфаза, чи ознака на звичайних нічних фазах (`isFirstNight: boolean` у state)
5. **Сумісність** з наявним `src/schema/enums.ts` (там уже є старі назви)

Відповідь має виглядати як:

```typescript
export enum GamePhase {
  LOBBY = "lobby",
  NIGHT_MAFIA = "night_mafia",
  NIGHT_DON_CHECK = "night_don_check",
  NIGHT_SHERIFF_CHECK = "night_sheriff_check",
  NIGHT_DOCTOR_HEAL = "night_doctor_heal",
  DAY_ANNOUNCE = "day_announce",
  DAY_BALAGAN = "day_balagan",
  DAY_SPEECHES = "day_speeches",
  DAY_DEFENSE = "day_defense",
  DAY_VOTE = "day_vote",
  DAY_REVOTE = "day_revote",
  GAME_OVER = "game_over"
}
```

з коротким переліком переходів і позначенням (host | state).

## Out of scope

- Конкретні таймери (1хв, 30с, 15-20с) — це ticket 09/07
- Структура payload для переходів — це ticket 05/07