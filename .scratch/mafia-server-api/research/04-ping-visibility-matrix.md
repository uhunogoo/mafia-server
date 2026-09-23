# 04 — Ping visibility matrix (research)

> Дослідження вичерпної матриці: chip × context × viewer × target.
> Базується на ticket 04, map.md і глосарії (ticket 14).

## 1. Канонічні типи

```typescript
// Усі ролі, які існують у грі
type Role = "CIVILIAN" | "SHERIFF" | "DOCTOR" | "MAFIA" | "DON";

// Контексти пінгу
type PingContext =
  | "night_mafia"      // NIGHT_MAFIA підфаза
  | "day_speech"       // під час чужої промови (DAY_SPEECHES)
  | "day_general"      // будь-який час дня (BALAGAN/ANNOUNCE/DEFENSE-pre)
  | "answer";          // відповідь на активне питання

// Фази, де пінги ВИМКНЕНІ повністю
type PingDisabledPhase =
  | "DAY_VOTE"
  | "DAY_REVOTE"
  | "DAY_DEFENSE"        // last word
  | "NIGHT_DON_CHECK"
  | "NIGHT_SHERIFF_CHECK"
  | "NIGHT_DOCTOR_HEAL"; // цивільні не пінгують у нічних підфазах
```

## 2. PING_RULES (lookup-таблиця)

```typescript
export const PING_RULES = {
  // ───────── Нічні (night_mafia) ─────────
  mafia_shoot: {
    label: "🎯 стріляємо",
    context: "night_mafia",
    senderRoles: ["MAFIA", "DON"],
    senderAlive: true,
    target: { required: true, kind: "alive_player", excludesSender: true },
    viewerRoles: ["MAFIA", "DON"],
    hostSees: true,
    expectsAnswer: false,
    isQuestion: false,
  },
  mafia_agree_q: {
    label: "згодні?",
    context: "night_mafia",
    senderRoles: ["MAFIA", "DON"],
    senderAlive: true,
    target: { required: false, kind: "any_mafia" }, // addressed до всіх мафії
    viewerRoles: ["MAFIA", "DON"],
    hostSees: true,
    expectsAnswer: true,
    isQuestion: true,
  },
  mafia_yes: {
    label: "так",
    context: "night_mafia",
    senderRoles: ["MAFIA", "DON"],
    senderAlive: true,
    target: { required: false, kind: "none" },
    viewerRoles: ["MAFIA", "DON"],
    hostSees: true,
    expectsAnswer: false,
    isQuestion: false,
  },
  mafia_no: {
    label: "ні",
    context: "night_mafia",
    senderRoles: ["MAFIA", "DON"],
    senderAlive: true,
    target: { required: false, kind: "none" },
    viewerRoles: ["MAFIA", "DON"],
    hostSees: true,
    expectsAnswer: false,
    isQuestion: false,
  },
  mafia_wait: {
    label: "чекай",
    context: "night_mafia",
    senderRoles: ["MAFIA", "DON"],
    senderAlive: true,
    target: { required: false, kind: "any_mafia" },
    viewerRoles: ["MAFIA", "DON"],
    hostSees: true,
    expectsAnswer: false,
    isQuestion: false,
  },

  // ───────── Реакції на чужу промову (day_speech) ─────────
  react_plus_one: {
    label: "+1",
    context: "day_speech",
    senderRoles: ["CIVILIAN", "SHERIFF", "DOCTOR", "MAFIA", "DON"],
    senderAlive: true,
    target: { required: true, kind: "current_speaker", excludesSender: true },
    viewerRoles: ["CIVILIAN", "SHERIFF", "DOCTOR", "MAFIA", "DON"],
    viewerAlive: true,
    hostSees: true,
    expectsAnswer: false,
    isQuestion: false,
  },
  react_trust: {
    label: "довіряю",
    context: "day_speech",
    senderRoles: ["CIVILIAN", "SHERIFF", "DOCTOR", "MAFIA", "DON"],
    senderAlive: true,
    target: { required: true, kind: "current_speaker", excludesSender: true },
    viewerRoles: ["CIVILIAN", "SHERIFF", "DOCTOR", "MAFIA", "DON"],
    viewerAlive: true,
    hostSees: true,
    expectsAnswer: false,
    isQuestion: false,
  },
  react_distrust: {
    label: "не довіряю",
    context: "day_speech",
    senderRoles: ["CIVILIAN", "SHERIFF", "DOCTOR", "MAFIA", "DON"],
    senderAlive: true,
    target: { required: true, kind: "current_speaker", excludesSender: true },
    viewerRoles: ["CIVILIAN", "SHERIFF", "DOCTOR", "MAFIA", "DON"],
    viewerAlive: true,
    hostSees: true,
    expectsAnswer: false,
    isQuestion: false,
  },
  react_doesnt_add_up: {
    label: "не сходиться",
    context: "day_speech",
    senderRoles: ["CIVILIAN", "SHERIFF", "DOCTOR", "MAFIA", "DON"],
    senderAlive: true,
    target: { required: true, kind: "current_speaker", excludesSender: true },
    viewerRoles: ["CIVILIAN", "SHERIFF", "DOCTOR", "MAFIA", "DON"],
    viewerAlive: true,
    hostSees: true,
    expectsAnswer: false,
    isQuestion: false,
  },

  // ───────── Денні загальні (day_general) ─────────
  day_suspect: {
    label: "підозрюю",
    context: "day_general",
    senderRoles: ["CIVILIAN", "SHERIFF", "DOCTOR", "MAFIA", "DON"],
    senderAlive: true,
    target: { required: true, kind: "alive_player", excludesSender: true },
    viewerRoles: ["CIVILIAN", "SHERIFF", "DOCTOR", "MAFIA", "DON"],
    viewerAlive: true,
    hostSees: true,
    expectsAnswer: false,
    isQuestion: false,
  },
  day_trust: {
    label: "довіряю",
    context: "day_general",
    senderRoles: ["CIVILIAN", "SHERIFF", "DOCTOR", "MAFIA", "DON"],
    senderAlive: true,
    target: { required: true, kind: "alive_player", excludesSender: true },
    viewerRoles: ["CIVILIAN", "SHERIFF", "DOCTOR", "MAFIA", "DON"],
    viewerAlive: true,
    hostSees: true,
    expectsAnswer: false,
    isQuestion: false,
  },
  day_opinion: {
    label: "яка думка?",
    context: "day_general",
    senderRoles: ["CIVILIAN", "SHERIFF", "DOCTOR", "MAFIA", "DON"],
    senderAlive: true,
    target: { required: true, kind: "alive_player", excludesSender: true },
    viewerRoles: ["CIVILIAN", "SHERIFF", "DOCTOR", "MAFIA", "DON"],
    viewerAlive: true,
    hostSees: true,
    expectsAnswer: true,
    isQuestion: true,
  },
  day_vote_now: {
    label: "голосуймо",
    context: "day_general",
    senderRoles: ["CIVILIAN", "SHERIFF", "DOCTOR", "MAFIA", "DON"],
    senderAlive: true,
    target: { required: true, kind: "alive_player", excludesSender: true },
    viewerRoles: ["CIVILIAN", "SHERIFF", "DOCTOR", "MAFIA", "DON"],
    viewerAlive: true,
    hostSees: true,
    expectsAnswer: false,
    isQuestion: false,
  },
  day_i_am_civilian: {
    label: "я мирний",
    context: "day_general",
    senderRoles: ["CIVILIAN"],                  // див. Ambiguity #4
    senderAlive: true,
    target: { required: false, kind: "none" },
    viewerRoles: ["CIVILIAN", "SHERIFF", "DOCTOR", "MAFIA", "DON"],
    viewerAlive: true,
    hostSees: true,
    expectsAnswer: false,
    isQuestion: false,
  },
  day_want_speech: {
    label: "хочу слово",
    context: "day_general",
    senderRoles: ["CIVILIAN", "SHERIFF", "DOCTOR", "MAFIA", "DON"],
    senderAlive: true,
    target: { required: true, kind: "host" },
    viewerRoles: [],                            // див. Ambiguity #2
    hostSees: true,
    expectsAnswer: false,
    isQuestion: false,
  },

  // ───────── Відповіді (answer) ─────────
  answer_yes: {
    label: "так",
    context: "answer",
    senderRoles: ["CIVILIAN", "SHERIFF", "DOCTOR", "MAFIA", "DON"],
    senderAlive: true,
    target: { required: true, kind: "original_asker" },
    viewerRoles: [],                            // адресат і так бачить (sender)
    hostSees: true,
    expectsAnswer: false,
    isQuestion: false,
  },
  answer_no: {
    label: "ні",
    context: "answer",
    senderRoles: ["CIVILIAN", "SHERIFF", "DOCTOR", "MAFIA", "DON"],
    senderAlive: true,
    target: { required: true, kind: "original_asker" },
    viewerRoles: [],
    hostSees: true,
    expectsAnswer: false,
    isQuestion: false,
  },
  answer_doubt: {
    label: "сумнів",
    context: "answer",
    senderRoles: ["CIVILIAN", "SHERIFF", "DOCTOR", "MAFIA", "DON"],
    senderAlive: true,
    target: { required: true, kind: "original_asker" },
    viewerRoles: [],
    hostSees: true,
    expectsAnswer: false,
    isQuestion: false,
  },
  answer_later: {
    label: "потім",
    context: "answer",
    senderRoles: ["CIVILIAN", "SHERIFF", "DOCTOR", "MAFIA", "DON"],
    senderAlive: true,
    target: { required: true, kind: "original_asker" },
    viewerRoles: [],
    hostSees: true,
    expectsAnswer: false,
    isQuestion: false,
  },
} as const;

export type PingChip = keyof typeof PING_RULES;
```

## 3. МАТРИЦЯ CHIP × VIEWER

Скорочення: **M** = MAFIA, **D** = DON, **H** = HOST, **C** = CIVILIAN, **S** = SHERIFF, **Dr** = DOCTOR.
«✓» = бачить (з урахуванням `isAlive`); «✗» = не бачить; «—» = не стосується.

| Chip ID              | Label             | Context      | M | D | C | S | Dr | Host | Target |
|----------------------|-------------------|--------------|---|---|---|---|----|----|--------|
| mafia_shoot          | 🎯 стріляємо      | night_mafia  | ✓ | ✓ | ✗ | ✗ | ✗ | ✓    | обраний civilian |
| mafia_agree_q        | згодні?           | night_mafia  | ✓ | ✓ | ✗ | ✗ | ✗ | ✓    | — |
| mafia_yes            | так               | night_mafia  | ✓ | ✓ | ✗ | ✗ | ✗ | ✓    | — |
| mafia_no             | ні                | night_mafia  | ✓ | ✓ | ✗ | ✗ | ✗ | ✓    | — |
| mafia_wait           | чекай             | night_mafia  | ✓ | ✓ | ✗ | ✗ | ✗ | ✓    | — |
| react_plus_one       | +1                | day_speech   | ✓ | ✓ | ✓ | ✓ | ✓  | ✓    | поточний промовець |
| react_trust          | довіряю (реакція) | day_speech   | ✓ | ✓ | ✓ | ✓ | ✓  | ✓    | поточний промовець |
| react_distrust       | не довіряю        | day_speech   | ✓ | ✓ | ✓ | ✓ | ✓  | ✓    | поточний промовець |
| react_doesnt_add_up  | не сходиться      | day_speech   | ✓ | ✓ | ✓ | ✓ | ✓  | ✓    | поточний промовець |
| day_suspect          | підозрюю          | day_general  | ✓ | ✓ | ✓ | ✓ | ✓  | ✓    | обраний гравець |
| day_trust            | довіряю (день)    | day_general  | ✓ | ✓ | ✓ | ✓ | ✓  | ✓    | обраний гравець |
| day_opinion          | яка думка?        | day_general  | ✓ | ✓ | ✓ | ✓ | ✓  | ✓    | обраний гравець |
| day_vote_now         | голосуймо         | day_general  | ✓ | ✓ | ✓ | ✓ | ✓  | ✓    | обраний гравець |
| day_i_am_civilian    | я мирний          | day_general  | ✓ | ✓ | ✓ | ✓ | ✓  | ✓    | — |
| day_want_speech      | хочу слово        | day_general  | ✗ | ✗ | ✗ | ✗ | ✗ | ✓    | host |
| answer_yes           | так (відповідь)   | answer       | ✗* | ✗* | ✗* | ✗* | ✗* | ✓ | оригінальний asker |
| answer_no            | ні (відповідь)    | answer       | ✗* | ✗* | ✗* | ✗* | ✗* | ✓ | оригінальний asker |
| answer_doubt         | сумнів            | answer       | ✗* | ✗* | ✗* | ✗* | ✗* | ✓ | оригінальний asker |
| answer_later         | потім             | answer       | ✗* | ✗* | ✗* | ✗* | ✗* | ✓ | оригінальний asker |

\* «answer» контекст — обмежене коло: бачить тільки оригінальний asker (який target) + sender (адресат) + host. Інші гравці НЕ бачать.

## 4. Контексти × активна фаза (gate)

```typescript
const PING_ENABLED_PHASES: Record<PingContext, GamePhase[]> = {
  night_mafia:  ["NIGHT_MAFIA"],
  day_speech:   ["DAY_SPEECHES"],
  day_general:  ["DAY_BALAGAN", "DAY_SPEECHES"], // BALAGAN + під час промов (фоном)
  answer:       ["NIGHT_MAFIA", "DAY_BALAGAN", "DAY_SPEECHES"],
};

const PING_DISABLED_PHASES: GamePhase[] = [
  "DAY_VOTE",
  "DAY_REVOTE",
  "DAY_DEFENSE",            // last word
  "NIGHT_DON_CHECK",
  "NIGHT_SHERIFF_CHECK",
  "NIGHT_DOCTOR_HEAL",      // цивільні не пінгують у нічних підфазах
];
```

Правило: `currentPhase ∈ PING_DISABLED_PHASES` ⇒ `canSend = false` для всіх чіпів.

## 5. canSend(sender, chip, context)

```typescript
function canSend(
  sender: Player,
  chip: PingChip,
  context: PingContext,
  state: MafiaState,
  nowMs: number
): { ok: boolean; reason?: string } {
  const rule = PING_RULES[chip];

  // 1) Phase gate
  if (PING_DISABLED_PHASES.includes(state.phase)) {
    return { ok: false, reason: "pings_disabled_in_phase" };
  }
  if (!PING_ENABLED_PHASES[rule.context].includes(state.phase)) {
    return { ok: false, reason: "chip_not_allowed_in_phase" };
  }

  // 2) Sender alive (dead silence)
  if (!sender.isAlive) {
    return { ok: false, reason: "dead_sender" };
  }
  if (sender.isHost) {
    return { ok: false, reason: "host_cannot_ping" };
  }

  // 3) Sender role
  if (!rule.senderRoles.includes(sender.role)) {
    return { ok: false, reason: "role_not_allowed" };
  }

  // 4) Active question limit (one per player)
  const myActive = state.activePings.filter(
    p =>
      (p.askerId === sender.sessionId || p.addresseeId === sender.sessionId) &&
      p.resolved === false &&
      p.expiresAt > nowMs
  );
  if (myActive.length > 0) {
    return { ok: false, reason: "one_active_question_per_player" };
  }

  // 5) Target validation
  if (rule.target.required) {
    const targetId = currentTargetFromContext(sender, rule.target.kind, state);
    if (!targetId) {
      return { ok: false, reason: "target_required" };
    }
    if (rule.target.excludesSender && targetId === sender.sessionId) {
      return { ok: false, reason: "target_cannot_be_sender" };
    }
    const target = state.players.get(targetId);
    if (!target || !target.isAlive) {
      return { ok: false, reason: "target_dead_or_missing" };
    }
    // Для "answer" контексту: має бути реальний відкритий пінг від asker
    if (rule.context === "answer") {
      const askerOpen = state.activePings.find(
        p =>
          p.addresseeId === sender.sessionId &&
          p.askerId === targetId &&
          p.resolved === false
      );
      if (!askerOpen) {
        return { ok: false, reason: "no_pending_question_from_asker" };
      }
    }
  }

  return { ok: true };
}
```

## 6. canSee(viewer, chip, context, target)

```typescript
function canSee(
  viewer: Player,
  chip: PingChip,
  context: PingContext,
  ping: PingInstance,
  state: MafiaState
): boolean {
  const rule = PING_RULES[chip];

  // 1) Dead players see nothing (except host)
  if (!viewer.isAlive && !viewer.isHost) return false;

  // 2) Host завжди бачить усе
  if (viewer.isHost) {
    return true;
  }

  // 3) Sender завжди бачить свій пінг
  if (ping.senderId === viewer.sessionId) return true;

  // 4) Target завжди бачить пінг (якщо target визначений)
  if (ping.targetId && ping.targetId === viewer.sessionId) {
    return true;
  }

  // 5) Context-specific audience
  switch (rule.context) {
    case "night_mafia":
      return viewer.role === "MAFIA" || viewer.role === "DON";
    case "day_speech":
    case "day_general":
      return viewer.isAlive;
    case "answer":
      return false; // sender/target уже оброблені вище
  }
}
```

## 7. SCOPE: Active-question tracking, timeout, dead handling

### 7.1 Структура стану

```typescript
class PingInstance extends Schema {
  @type("string") id: string;             // uuid
  @type("string") chip: PingChip;
  @type("string") senderId: string;       // хто надіслав
  @type("string") askerId: string;        // хто поставив питання (=sender для всіх, крім answer)
  @type("string") addresseeId: string;   // кому призначено (=target для question)
  @type("string") targetId: string;       // обрана ціль (якщо chip має target)
  @type("number") sentAt: number;
  @type("number") expiresAt: number;      // sentAt + 15-20s
  @type("boolean") resolved: boolean;     // true = answered OR cancelled OR timed out
  @type("string") resolutionKind: "answered" | "timeout" | "cancelled" | "";
}

class MafiaState extends Schema {
  ...
  @type({ map: PingInstance }) activePings = new MapSchema<PingInstance>();
}
```

### 7.2 «Одне активне питання на гравця»

**Семантика (найобережніша інтерпретація):** гравець може бути залучений максимум в 1 активному пінзі одночасно (як asker АБО addressee, в будь-якому напрямку). Перевіряється в `canSend` крок 4.

- Якщо A запитав B, і B ще не відповів → ніхто з A чи B не може поставити нове питання.
- A може відповісти іншому питанню, тільки якщо вільний.
- Твердження «так/ні/сумнів/потім» — це відповіді (context: "answer"), вони не створюють НОВОГО активного питання; вони резолвлять існуюче.

### 7.3 Таймаут 15-20с

**Що саме зникає:** badge (UI-елемент) над гравцем і запис у `state.activePings` видаляється при `nowMs > expiresAt`.

**Що з логом:** пінги **ніколи не записуються в довгостроковий лог** (per `map.md`). Timeout НЕ додає запису в `mafiaLog` / `dayLog` / `roleLog`. Тільки badge зникає.

**Діапазон:** наразі приймаємо 17.5с (середина між 15-20). Реалізація може виставити константу `PING_TIMEOUT_MS = 17_500`.

**Резолв при таймауті:** `ping.resolved = true`, `ping.resolutionKind = "timeout"`. Адресат більше не може відповісти (його «так/ні» буде rejected як «no_pending_question_from_asker»).

### 7.4 Мертві втрачають пінги

**Перевірка:**
- **`canSend`**: якщо `sender.isAlive === false` → reject (`dead_sender`). Перевіряється щоразу при спробі.
- **`canSee`**: мертвий гравець (non-host) → не бачить жодних пінгів (UI очищається).
- **Синхронізація стану**: при смерті гравця (`Player.isAlive = false`) сервер негайно:
  1. Видаляє всі `activePings`, де цей гравець є sender/asker/addressee/target.
  2. Встановлює `resolved = true`, `resolutionKind = "cancelled"`.
- Host НЕ вмирає, тому host бачить завжди.

### 7.5 Phase cleanup

При переході фази (напр. `NIGHT_MAFIA → NIGHT_DON_CHECK`) сервер:
1. Інвалідує всі `activePings` з `resolutionKind = "cancelled"`.
2. Це стосується нічних пінгів при переході з NIGHT_MAFIA, денних при переході в DAY_VOTE / DAY_DEFENSE тощо.

## 8. Ambiguities (потребують уточнення від користувача)

1. **Чи civilian може слати «так/ні» в ніч?** Поточна інтерпретація — ні (`senderRoles` = MAFIA + DON). Уточнити, чи це правильно.

2. **«Хочу слово» — хто бачить?** Поточна інтерпретація — тільки host. Альтернатива — всі живі (знати чергу). Впливає на UX і анти-спам (ticket 09).

3. **Чи «я мирний» обмежений роллю CIVILIAN, чи може хтось (DON під прикриттям) теж?** Поточна інтерпретація — CIVILIAN only. Уточнити.

4. **«Одне активне питання» — strict чи м'якше?** Поточна інтерпретація — strict: combined ≤ 1. Альтернативи:
   - Тільки вихідних ≤ 1
   - Тільки вхідних ≤ 1

5. **Host бачить «answer» пінги?** Поточна інтерпретація — так. Альтернатива — ні (приватна розмова).

6. **Таймаут — 15 чи 20?** У регламенті діапазон. Поточна інтерпретація — 17.5с або налаштування `PING_TIMEOUT_MS`.

7. **«Так/ні» в ніч vs «Так/ні» як відповідь — це той самий чіп чи різні?** Поточна інтерпретація — РІЗНІ chip IDs (`mafia_yes` vs `answer_yes`). Підтвердити.

8. **Денні загальні під час `DAY_DEFENSE`?** Чи `last word` = тільки `DAY_DEFENSE`, чи включає `DAY_REVOTE`? Поточна інтерпретація — обидва вимкнені.

## 9. Out of scope (підтверджено)

- Handler-и (ticket 11/05).
- Клієнтський UI (badge рендер, анімація).
- Anti-spam (ticket 09) — обмеження `pingsPerPlayerPerDay` ще не визначені.

## 10. References

- Ticket 04: `04-ping-visibility-matrix.md`
- Map: `.scratch/mafia-server-api/map.md` (host-model, ephemeral pings)
- Glossary (ticket 14): `14-context-glossary.md`
- Phase taxonomy (ticket 01): `01-phase-taxonomy.md`
- Anti-spam (ticket 09): `09-ping-anti-spam.md`
- Schema privacy (ticket 10): `10-schema-privacy.md`
- State schema prototype (ticket 11): `11-state-schema-prototype.md` — тут `PING_RULES` має стати частиною `MafiaState`.