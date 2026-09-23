# 06 — Speech queue + defense order algorithm

Type: grilling
Status: open
Blocked by: (none)

## Question

Як сервер моделює чергу промов і порядок захисту, і коли їх авто-адвансить?

Потрібно:

1. **Структура `speechQueue`**:
   ```typescript
   class SpeechQueueState extends Schema {
     @type([PlayerRef]) order = new ArraySchema<PlayerRef>();
     @type("string") currentSpeakerId: string = "";
     @type("number") currentStartedAt: number = 0;
     @type("number") perSpeechMs: number = 60_000;
   }
   ```
   Чи достатньо `order: Map<sessionId, seatIndex>` + `currentSpeakerId`?

2. **Побудова початкової черги в Day 1**: від seat #1, далі round-robin. Що робити, якщо гравець помер після того, як чергу вже побудовано — пропускати чи видаляти з черги?
3. **Побудова черги в Day N+1**: зсув від попереднього firstSpeaker на +1 seat, далі round-robin.

4. **Таймер промови**: 60с. Сервер запускає таймер коли `phase = DAY_SPEECHES && currentSpeakerId встановлено`. По експірі — автоперемикає на наступного. Чи треба 5с warning?

5. **Defense (30с)**: один кандидат за раз чи всі послідовно? Якщо послідовно — сервер сам перемикає по 30с? Чи ведучий?

6. **Номінація під час промови**: як сервер знає, що номінація відбулася саме в цю промову — окреме повідомлення `nominate(targetId)` від промовця, чи `state.nominations[targetId]++` оновлюється при тапі?

7. **Edge cases**:
   - Гравець-перший-промовець помер уночі до промов → хто перший?
   - Усі промовці промовили, але ніхто не номінував → що далі (skip to night? night with empty candidate list)?

8. **Чи має сервер "чекати" на ведучого для переходу з BALAGAN на SPEECHES, і з DEFENSE на VOTE?**

## Out of scope

- UI промовців (це клієнт)
- Мікрофон/аудіо (не входить до сервера)