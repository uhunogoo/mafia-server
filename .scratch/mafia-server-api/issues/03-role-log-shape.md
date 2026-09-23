# 03 — Per-role log shape and content

Type: grilling
Status: open
Blocked by: (none)

## Question

Як влаштовані per-role логи дій (`mafiaLog`, `donLog`, `sheriffLog`, `doctorLog`), що в них потрапляє, і як вони експонуються?

З гриля 3: ведучий бачить усі логи одночасно, кожна роль бачить свій.

Потрібно:

1. **Структура запису логу**: `{ night: number, ts: number, kind: string, payload: any }` чи більш типізований enum подій (`MafiaVote`, `DonCheckResult`, `SheriffCheck`, `DoctorHeal`).
2. **Хто пише в лог**: чи тільки сервер, чи може ведучий додавати нотатки?
3. **TTL логів**: чи лог — це буфер тільки поточної ночі, чи це накопичувальний список за всю гру?
4. **Mafia log**: спільний для мафії+дона чи окремий? (Зараз припускаємо спільний, бо дон бачить пінги мафії)
5. **Схема доступу**: як сервер розрізняє «цей гравець бачить цей лог» — через `@visibility("owner")` чи через ручне маскування в handler?

Відповідь — це конкретна TypeScript-схема:

```typescript
class RoleLogEntry extends Schema {
  @type("number") night: number;
  @type("number") ts: number;
  @type("string") kind: "mafia_vote" | "don_check" | ...;
  @type("string") actorId: string;     // sessionId
  @type("string") targetId: string;    // sessionId
  @type("string") payload: string;     // serialized JSON
}

class MafiaState extends Schema {
  ...
  mafiaLog = new ArraySchema<RoleLogEntry>();
  donLog = new ArraySchema<RoleLogEntry>();
  sheriffLog = new ArraySchema<RoleLogEntry>();
  doctorLog = new ArraySchema<RoleLogEntry>();
}
```

## Out of scope

- Приватність на рівні Colyseus (ticket 10)
- Що саме дона/шериф/лікар бачать як screen UI — це клієнт, не сервер