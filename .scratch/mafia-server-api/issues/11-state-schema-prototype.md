# 11 — State schema draft (prototype)

Type: prototype
Status: open
Blocked by: 01, 02, 03, 04, 05, 06, 07, 08, 10

## Question

Зібрати всі рішення з ticket 01-10 у **конкретний TypeScript-файл** `src/schema/MafiaState.ts` (та пов'язані Player/Vote/Ping/RoleLog/NightAction), який можна реально запустити в Colyseus.

Це **prototype** для реакції: щоб користувач побачив, як усе виглядає разом, і сказав «ось тут не так».

Потрібно:

1. **Переписати `src/schema/MafiaState.ts`** з повним набором полів:
   - `phase: GamePhase` (з ticket 01)
   - `players: MapSchema<Player>`
   - `nightCount: number`, `dayCount: number`
   - `nightAction: NightActionState` (з ticket 07)
   - `speechQueue: SpeechQueueState` (з ticket 06)
   - `vote: VoteState` (з ticket 05)
   - `nominations: MapSchema<number>` (candidateId → count)
   - `pings: MapSchema<PingInstance>` (з ticket 04)
   - `mafiaLog / donLog / sheriffLog / doctorLog: ArraySchema<RoleLogEntry>` (з ticket 03)
   - `isFirstNight: boolean` (або виводиться з nightCount)

2. **`Player`** з приватними полями (ticket 10):
   ```typescript
   class Player extends Schema {
     @type("string") sessionId: string;
     @type("string") name: string;
     @type("number") seatIndex: number;
     @type("boolean") isHost: boolean;
     @type("boolean") isAlive: boolean;
     @type("boolean") isConnected: boolean;
     @visibility("owner") role: Role;          // private
     @visibility("owner") team: Team;          // private
     // server-only: lastDoctorHealTargetId (через окрему мапу чи поле)
   }
   ```

3. **Helper-класи**:
   - `VoteCount`, `VoteState` (ticket 05)
   - `SpeechQueueState`, `PlayerRef` (ticket 06)
   - `NightActionState`, `WeekMap` (ticket 07)
   - `PingInstance`, `PingChip` enum, `PING_RULES` (ticket 04)
   - `RoleLogEntry` (ticket 03)

4. **Handler-stub'и в `MafiaRoom.ts`**: заготовки `messages = { startGame, startNight, submitNightAction, startSpeeches, nominate, submitVoteCounts, askOpinion, answerPing, ... }` з `console.log("TODO")` всередині, щоб структура була зрозуміла.

5. **Compile check**: `npm run build` має проходити без помилок.

Це не фінальна реалізація — це **чорновик для обговорення**. Після approve — окремі квитки на повну імплементацію кожного хендлера.

## Out of scope

- Логіка handlers (це буде далі)
- Тести (ticket 13)
- Інтеграція з клієнтом