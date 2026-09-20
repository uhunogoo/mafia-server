import { MafiaState } from "../rooms/schema/MafiaState.js";
import { GamePhase, NightStep, Role, Team } from "../rooms/schema/enums.js";
import { PhaseTimer, type PhaseTimerEvent, type PhaseTimerMode, type PhaseTimerSnapshot } from "./PhaseTimer.js";
import {
  ActionLogEntry,
  ActionType,
  DEFAULT_TIMER_DURATIONS,
  DeathCause,
  EngineError,
  EngineErrorCode,
  NightResolution,
  PingRecord,
  PlayerIdentity,
  ROLE_DISTRIBUTION,
  SUPPORTED_PLAYER_COUNTS,
  VoteResolution,
} from "./types.js";

/**
 * Map a role to its team. RED = Civilian, Sheriff, Doctor. BLACK = Mafia, Don.
 */
function roleToTeam(role: Role): Team {
  switch (role) {
    case Role.MAFIA:
    case Role.DON:
      return Team.BLACK;
    case Role.CIVILIAN:
    case Role.SHERIFF:
    case Role.DOCTOR:
      return Team.RED;
  }
}

/**
 * Fisher–Yates shuffle using Math.random. The distribution is fixed by
 * `ROLE_DISTRIBUTION`; this only randomizes which seat gets which role.
 */
function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Pure game engine. Holds the canonical role/team map, action log, and the
 * per-Doctor "last healed" tracking. Mutates the public `MafiaState` only
 * through the explicit methods called by the room layer.
 *
 * Slice-1 implements the Night-2 vertical slice:
 *  - startGame assigns roles per the distribution table and transitions LOBBY → NIGHT
 *  - mafiaKill / donCheck / sheriffCheck / doctorHeal validate phase + role
 *  - doctorHeal hard-rejects the Doctor's previous night's target
 *  - resolveNight compares mafia victim vs doctor heal and writes state.died
 *
 * Slice-3 (ticket 03) adds the Day-1 basic flow:
 *  - resolveNight transitions NIGHT → DAY_ANNOUNCEMENT and bumps dayCount
 *  - nominate / vote / resolveVoting walk the day cycle through speeches,
 *    defense, and voting (skipping BALAGAN for Day 1 per ADR 0005)
 *  - resolveVoting tallies with default vote = last speaker, marks the loser
 *    dead, fires the onPlayerDied seam, and transitions DAY_VOTING → NIGHT
 *
 * Slice-4 (ticket 04) adds phase timers + host overrides:
 *  - startGame / startSpeeches / nextSpeaker / enterDayDefense / nextDefense /
 *    mafiaKill / resolveNight arm or clear the appropriate `PhaseTimer`
 *  - tickPhaseTimer advances the active timer and dispatches EXPIRED events
 *    to the right transition (nextSpeaker, nextDefense, or "pause" for the
 *    mafia window)
 *  - pausePhase / resumePhase / skipPhase / extendPhase let the host override
 *    the timer (skip on a per-turn phase calls the same internal transition
 *    that timer expiry would)
 *
 * Slice-5 (ticket 05) adds disconnect pause + declareDead:
 *  - pauseForMissing pauses the phase timer when a player drops mid-phase,
 *    marks them missing in the public schema, and emits a host notification
 *    via the action log; the room forwards that notification to the host
 *  - clearMissing clears the missing flag and resumes the timer when the
 *    player reconnects within the Colyseus reconnection window (30s)
 *  - declareDead marks a missing player dead (permanently, even if they
 *    later reconnect), fires the onPlayerDied seam with DECLARED_DEAD, and
 *    resumes the timer; the same seam that observes vote eliminations and
 *    mafia kills observes the declaration so future victory-check work
 *    (ticket 09) plugs in transparently
 *
 * Slice-6 (ticket 06) adds host moderation (kept separate from phase flow):
 *  - kick marks a player dead and reduces them to a read-only spectator —
 *    the seat is held and the role stays sealed, but every player action is
 *    rejected; the onPlayerDied seam fires with KICKED so the victory check
 *    treats an ejection like any other death
 *  - foul records a warning in the host action log without touching the
 *    player's game state
 *  - donCheck / sheriffCheck / doctorHeal now also require the actor to be
 *    alive, so a dead or kicked role-holder cannot act (the room gates
 *    non-host messages from dead players as the first line of defense)
 *
 * Slice-7 (ticket 07) adds Day 2+ BALAGAN + first-word rule:
 *  - on Day 2+ (`dayCount >= 2`), the day sequence inserts `DAY_BALAGAN`
 *    between speeches and defense; Day 1 still skips BALAGAN per ADR 0005
 *  - on Day 2+, the first speaker must nominate an elimination candidate
 *    during their speech; `nextSpeaker` rejects the call when they haven't
 *  - the first-word right shifts clockwise each day — the first speaker of
 *    Day N+1 is the seat immediately after Day N's first speaker; this is
 *    driven by tracking the previous day's first speaker sessionId and
 *    rotating the speaking order to start from the next clockwise seat
 *
 * The engine never touches the network; the room translates `EngineError`
 * into player-visible messages and `client.send` for private role reveals.
 */
export class Engine {
  /**
   * Canonical role/team store keyed by sessionId. The public `Player` schema
   * has no role/team fields (ADR 0004).
   */
  private identities = new Map<string, PlayerIdentity>();

  /**
   * Host-only action log. Players never receive these entries; the host UI
   * reads them out-of-band (ADR 0002).
   */
  private actionLog: ActionLogEntry[] = [];

  /**
   * Doctor's last healed target, keyed by Doctor sessionId. The Doctor may not
   * heal the same player (including themselves) on two consecutive nights
   * (ADR 0003).
   */
  private lastHealed = new Map<string, string>();

  /**
   * Every accepted ping for this game. Pings stay in the host's action log
   * permanently; the room only forwards them to sender + recipient + host as
   * live private messages (per ADR 0002 — "pings are ephemeral").
   */
  private pings: PingRecord[] = [];

  /**
   * Per-night action buffer. Cleared on `resolveNight`.
   */
  private nightActions: {
    mafiaVictimId: string;
    donCheck: { actorId: string; targetId: string } | null;
    sheriffCheck: { actorId: string; targetId: string } | null;
    doctorHeal: { actorId: string; targetId: string } | null;
  } = {
    mafiaVictimId: "",
    donCheck: null,
    sheriffCheck: null,
    doctorHeal: null,
  };

  /**
   * Day-cycle speaking order — alive non-host players in seat order. Recomputed
   * each day at `startSpeeches`; players who die during the day stay in this
   * list (defensive — they should not be on it because we recompute at start).
   */
  private speakingOrder: string[] = [];

  /**
   * Pointer into `speakingOrder`. `-1` while no speech has started yet;
   * `speakingOrder.length` when all speeches are done (auto-transition to
   * DAY_DEFENSE).
   */
  private currentSpeakerIndex = -1;

  /**
   * Day-cycle defense order — nominated players in seat order. Empty when no
   * one was nominated. Recomputed when entering DAY_DEFENSE.
   */
  private defenseOrder: string[] = [];

  /**
   * Pointer into `defenseOrder`. Same semantics as `currentSpeakerIndex`.
   */
  private currentDefenseIndex = -1;

  /**
   * Per-day vote buffer: voter → target. Cleared at the start of each day and
   * after `resolveVoting`.
   */
  private votes = new Map<string, string>();

  /**
   * SessionId of the previous day's first speaker. Used to rotate the Day 2+
   * speaking order so the first-word right shifts clockwise each day. Empty
   * string before the first day; updated by `startSpeeches` after computing
   * the new speaking order (ticket 07).
   */
  private firstSpeakerId = "";

  /**
   * Has the current day's first speaker nominated an elimination candidate?
   * Reset by `startSpeeches`; set when the first speaker calls `nominate`.
   * On Day 2+ the engine rejects `nextSpeaker` when this is still false at
   * the end of the first speaker's speech (ticket 07 — first-word rule).
   */
  private firstSpeakerNominated = false;

  /**
   * Optional seam fired whenever a player dies. Day-cycle elimination calls it
   * with `VOTE_ELIMINATION`; night mafia kills call `MAFIA_KILL`; ticket 05
   * adds `DECLARED_DEAD` for host-declared dead on disconnect. The room uses
   * this hook to run victory checks and host notifications.
   */
  private onPlayerDied: ((sessionId: string, cause: DeathCause) => void) | null = null;

  /**
   * SessionIds of players who have dropped but not yet been declared dead.
   * At most one missing player at a time: a second drop while the phase is
   * already paused for the first is ignored (idempotent). The set drives the
   * `Player.isMissing` flag in the public schema and gates `declareDead`
   * (the host can only declare a missing player dead, not an arbitrary one).
   * Cleared automatically when the player reconnects (`clearMissing`) or
   * when the host resolves the pause (`declareDead`).
   */
  private missing = new Set<string>();

  private nextEntryId = 0;

  /**
   * Active server-side timer for the current phase. `null` when the phase has
   * no timer (LOBBY, GAME_OVER, DAY_ANNOUNCEMENT, DAY_VOTING). The engine arms
   * and clears this timer automatically as the phase machine progresses; the
   * host's pause/resume/skip/extend overrides mutate it in place.
   */
  private phaseTimer: PhaseTimer | null = null;

  /**
   * Wall-clock provider. Tests inject a fake clock to advance time
   * deterministically; production uses `Date.now`.
   */
  private clock: () => number;

  constructor(public readonly state: MafiaState, clock?: () => number) {
    this.clock = clock ?? (() => Date.now());
  }

  // ─── Read accessors ─────────────────────────────────────────────────────

  /** Returns the canonical role for a sessionId, or undefined if not assigned. */
  getRole(sessionId: string): Role | undefined {
    return this.identities.get(sessionId)?.role;
  }

  /** Returns the canonical team for a sessionId, or undefined if not assigned. */
  getTeam(sessionId: string): Team | undefined {
    return this.identities.get(sessionId)?.team;
  }

  /** Read-only view of the host-only action log (ADR 0002). */
  getActionLog(): readonly ActionLogEntry[] {
    return this.actionLog;
  }

  /**
   * Return every action-log entry strictly newer than `sinceEntryId`. The
   * host uses this to incrementally fetch the log without resending the whole
   * history on each poll. Pass `""` (empty string) to get the entire log.
   * Unknown ids fall back to returning the whole log so a missed id never
   * blocks the host from receiving entries.
   */
  getActionLogSince(sinceEntryId: string): ActionLogEntry[] {
    if (sinceEntryId === "") {
      return [...this.actionLog];
    }
    const idx = this.actionLog.findIndex((e) => e.id === sinceEntryId);
    if (idx === -1) {
      return [...this.actionLog];
    }
    return this.actionLog.slice(idx + 1);
  }

  /** Returns the Doctor's last healed target (or empty string if none). */
  getLastHealed(doctorSessionId: string): string {
    return this.lastHealed.get(doctorSessionId) ?? "";
  }

  /**
   * Day cycle: the sessionId of the player currently giving their speech, or
   * empty string when the phase isn't DAY_SPEECHES or all speeches are done.
   */
  getCurrentSpeaker(): string {
    if (this.state.phase !== GamePhase.DAY_SPEECHES) return "";
    if (this.currentSpeakerIndex < 0) return "";
    if (this.currentSpeakerIndex >= this.speakingOrder.length) return "";
    return this.speakingOrder[this.currentSpeakerIndex];
  }

  /**
   * Day cycle: the sessionId of the candidate currently defending, or empty
   * string when the phase isn't DAY_DEFENSE or all defenses are done.
   */
  getCurrentDefense(): string {
    if (this.state.phase !== GamePhase.DAY_DEFENSE) return "";
    if (this.currentDefenseIndex < 0) return "";
    if (this.currentDefenseIndex >= this.defenseOrder.length) return "";
    return this.defenseOrder[this.currentDefenseIndex];
  }

  /** Day cycle: alive non-host players in seat order (frozen at startSpeeches). */
  getSpeakingOrder(): string[] {
    return [...this.speakingOrder];
  }

  /** Day cycle: nominated players in seat order (frozen at DAY_DEFENSE entry). */
  getDefenseOrder(): string[] {
    return [...this.defenseOrder];
  }

  /**
   * Day cycle: the target a voter cast for. Returns empty string if the player
   * has not voted (and a default vote has not been applied yet — defaults are
   * applied only inside `resolveVoting`).
   */
  getVote(voterSessionId: string): string {
    return this.votes.get(voterSessionId) ?? "";
  }

  /**
   * Pings visible to a specific player (sender or recipient). The room uses
   * this when relaying pings to clients so a player only sees pings they were
   * involved in (ADR 0002).
   */
  getPingsForPlayer(sessionId: string): PingRecord[] {
    return this.pings.filter((p) => p.fromId === sessionId || p.toId === sessionId);
  }

  /**
   * All pings accepted in this game, in insertion order. The host UI uses this
   * to render a unified ping timeline; the per-player filtering is on top of
   * the same data.
   */
  getAllPings(): PingRecord[] {
    return [...this.pings];
  }

  // ─── Game flow ──────────────────────────────────────────────────────────

  /**
   * Assign roles from the distribution table for the current player count and
   * transition LOBBY → NIGHT. The host does not receive a role.
   *
   * Slice-1 starts the game directly at Night 2 (Night 1 is intro-only; the
   * follow-up tickets handle full phase progression).
   */
  startGame(): void {
    if (this.state.phase !== GamePhase.LOBBY) {
      throw new EngineError(
        EngineErrorCode.GAME_LOCKED,
        "Game is already in progress",
      );
    }

    const players = [...this.state.players.values()].filter((p) => !p.isHost);
    const count = players.length;
    if (!SUPPORTED_PLAYER_COUNTS.includes(count as (typeof SUPPORTED_PLAYER_COUNTS)[number])) {
      throw new EngineError(
        EngineErrorCode.GAME_LOCKED,
        `Role distribution is not defined for ${count} players (supported: ${SUPPORTED_PLAYER_COUNTS.join(", ")})`,
      );
    }

    const roles = shuffle(ROLE_DISTRIBUTION[count]);
    this.identities.clear();
    this.lastHealed.clear();
    this.resetNightActions();

    for (let i = 0; i < players.length; i++) {
      const role = roles[i];
      const player = players[i];
      this.identities.set(player.sessionId, {
        sessionId: player.sessionId,
        role,
        team: roleToTeam(role),
      });
    }

    this.state.phase = GamePhase.NIGHT;
    this.state.nightStep = NightStep.MAFIA;
    this.state.dayCount = 0;
    this.state.died = "";
    this.state.doctorTargetId = "";
    this.state.mafiaTargetId = "";

    // Arm the 60s mafia window with 30s/50s host reminders.
    this.startTimer("MAFIA_WINDOW");

    this.logEntry({
      actorSessionId: "",
      type: ActionType.PHASE_ADVANCE,
      payload: { event: "game_started", phase: GamePhase.NIGHT, dayCount: 0 },
    });
  }

  /**
   * Host-only: submit the mafia's victim for this night. Stored in the
   * per-night buffer; resolution happens on `resolveNight`.
   */
  mafiaKill(hostSessionId: string, targetId: string): void {
    this.requirePhase(GamePhase.NIGHT);
    this.requireHost(hostSessionId);
    this.requireAlivePlayer(targetId);

    this.nightActions.mafiaVictimId = targetId;
    this.state.mafiaTargetId = targetId;
    // Kill submitted — the mafia window is satisfied for this step.
    this.clearTimer();
    this.logEntry({
      actorSessionId: hostSessionId,
      type: ActionType.MAFIA_KILL,
      payload: { targetId },
    });
  }

  /**
   * Stub for ticket 07b: the action is recorded and the engine would later
   * resolve the "is Sheriff?" result privately. For now we only enforce that
   * the caller is the Don, the target is alive, and the phase is NIGHT.
   */
  donCheck(actorSessionId: string, targetId: string): void {
    this.requirePhase(GamePhase.NIGHT);
    this.requireRole(actorSessionId, Role.DON);
    this.requireAlivePlayer(actorSessionId);
    this.requireAlivePlayer(targetId);
    if (actorSessionId === targetId) {
      throw new EngineError(
        EngineErrorCode.WRONG_ROLE,
        "Don cannot check themselves",
      );
    }

    this.nightActions.donCheck = { actorId: actorSessionId, targetId };
    this.logEntry({
      actorSessionId,
      type: ActionType.DON_CHECK,
      payload: { targetId },
    });
  }

  /**
   * Stub for ticket 07b: recorded only, not yet resolved privately.
   */
  sheriffCheck(actorSessionId: string, targetId: string): void {
    this.requirePhase(GamePhase.NIGHT);
    this.requireRole(actorSessionId, Role.SHERIFF);
    this.requireAlivePlayer(actorSessionId);
    this.requireAlivePlayer(targetId);
    if (actorSessionId === targetId) {
      throw new EngineError(
        EngineErrorCode.WRONG_ROLE,
        "Sheriff cannot check themselves",
      );
    }

    this.nightActions.sheriffCheck = { actorId: actorSessionId, targetId };
    this.logEntry({
      actorSessionId,
      type: ActionType.SHERIFF_CHECK,
      payload: { targetId },
    });
  }

  /**
   * Doctor picks a player to heal. Hard-rejected when `targetId` equals the
   * Doctor's last healed target (ADR 0003 — includes the Doctor's own
   * sessionId).
   */
  doctorHeal(actorSessionId: string, targetId: string): void {
    this.requirePhase(GamePhase.NIGHT);
    this.requireRole(actorSessionId, Role.DOCTOR);
    this.requireAlivePlayer(actorSessionId);
    this.requireAlivePlayer(targetId);

    const previous = this.lastHealed.get(actorSessionId) ?? "";
    if (previous !== "" && previous === targetId) {
      throw new EngineError(
        EngineErrorCode.DOCTOR_RESTRICTION,
        "Doctor cannot heal the same player two nights in a row",
      );
    }

    this.nightActions.doctorHeal = { actorId: actorSessionId, targetId };
    this.state.doctorTargetId = targetId;
    this.logEntry({
      actorSessionId,
      type: ActionType.DOCTOR_HEAL,
      payload: { targetId },
    });
  }

  /**
   * Compare mafia victim vs doctor heal and write `state.died`. Clears the
   * night action buffer, stores the Doctor's last-healed target for the next
   * night, marks the victim dead, fires the `onPlayerDied` seam with cause
   * `MAFIA_KILL`, and transitions NIGHT → DAY_ANNOUNCEMENT. Bumps
   * `dayCount` so the public schema reflects "we are now on Day N" once
   * the day starts.
   *
   * Day 1 starts with `dayCount = 1`; Day 2 starts with `dayCount = 2`. The
   * increment happens here so `state.died` and `state.dayCount` are mutually
   * consistent on DAY_ANNOUNCEMENT entry.
   *
   * Returns the resolution so tests can assert without reading mutable state.
   */
  resolveNight(): NightResolution {
    this.requirePhase(GamePhase.NIGHT);

    const victim = this.nightActions.mafiaVictimId;
    const heal = this.nightActions.doctorHeal?.targetId ?? "";
    const died = victim !== "" && victim !== heal ? victim : "";

    this.state.died = died;
    if (this.nightActions.doctorHeal) {
      this.lastHealed.set(
        this.nightActions.doctorHeal.actorId,
        this.nightActions.doctorHeal.targetId,
      );
    }

    const resolution: NightResolution = {
      died,
      mafiaVictimId: victim,
      doctorHealId: heal,
    };

    this.logEntry({
      actorSessionId: "",
      type: ActionType.PHASE_ADVANCE,
      payload: { event: "night_resolved", ...resolution },
    });

    this.resetNightActions();

    // Mark the victim dead in the public schema and fire the seam. Doing
    // this here (not at DAY_ANNOUNCEMENT entry) keeps the seam as a single
    // observation point for every death cause — vote elimination in
    // `resolveVoting`, host-declared dead in the upcoming ticket 05.
    if (died !== "") {
      const target = this.state.players.get(died);
      if (target) target.isAlive = false;
      this.onPlayerDied?.(died, "MAFIA_KILL");
    }

    // Day-cycle entry: bump dayCount, reset day state, transition phase.
    this.state.dayCount = this.state.dayCount + 1;
    this.resetDayState();
    this.state.phase = GamePhase.DAY_ANNOUNCEMENT;
    // No timer in DAY_ANNOUNCEMENT; the host advances to DAY_SPEECHES.
    this.clearTimer();

    return resolution;
  }

  // ─── Day cycle ──────────────────────────────────────────────────────────

  /**
   * Register a callback fired whenever a player dies. The room subscribes to
   * observe elimination so it can run victory checks and host notifications.
   * Pass `null` to unsubscribe. A single callback overwrites any previous one.
   *
   * `DECLARED_DEAD` is the only cause where the dead flag is set *after* a
   * disconnect-pause is resolved by the host. The other two causes
   * (`VOTE_ELIMINATION`, `MAFIA_KILL`) are issued by the day/night cycle
   * itself.
   */
  setOnPlayerDied(callback: ((sessionId: string, cause: DeathCause) => void) | null): void {
    this.onPlayerDied = callback;
  }

  /**
   * Add `targetId` to the day's nomination list. Valid during DAY_SPEECHES
   * (Day 1) and during DAY_BALAGAN (Day 2+ — out of scope here, but the phase
   * guard matches the future ticket 07).
   *
   * The actor must be alive; the target must be alive and not already
   * nominated. Players self-nominating is allowed (a player may volunteer for
   * the chop).
   */
  nominate(actorSessionId: string, targetId: string): void {
    // Day 1 has only DAY_SPEECHES; Day 2+ uses DAY_SPEECHES or DAY_BALAGAN.
    if (
      this.state.phase !== GamePhase.DAY_SPEECHES &&
      this.state.phase !== GamePhase.DAY_BALAGAN
    ) {
      throw new EngineError(
        EngineErrorCode.WRONG_PHASE,
        `nominate requires phase DAY_SPEECHES or DAY_BALAGAN, currently ${this.state.phase}`,
      );
    }
    this.requireAlivePlayer(actorSessionId);
    this.requireAlivePlayer(targetId);
    if (this.state.nominations.includes(targetId)) {
      throw new EngineError(
        EngineErrorCode.WRONG_ROLE,
        `Player ${targetId} is already nominated`,
      );
    }

    this.state.nominations.push(targetId);
    const target = this.state.players.get(targetId)!;
    target.isNominated = true;

    // First-word rule (Day 2+): record that the current day's first speaker
    // has nominated. The rule only requires the first speaker to nominate at
    // least one candidate during their speech — subsequent nominations from
    // any other player do not affect this flag.
    if (actorSessionId === this.firstSpeakerId) {
      this.firstSpeakerNominated = true;
    }

    this.logEntry({
      actorSessionId,
      type: ActionType.NOMINATE,
      payload: { targetId },
    });
  }

  /**
   * Transition DAY_ANNOUNCEMENT → DAY_SPEECHES. Computes the speaking order
   * (alive non-host players in seat order), points at the first speaker, and
   * writes `state.currentSpeakerId` so clients can render the speaker badge.
   *
   * On Day 2+ (`dayCount >= 2`) the speaking order is rotated so the first
   * speaker is the seat immediately clockwise from the previous day's first
   * speaker — the "first-word right shifts clockwise" rule (ticket 07). The
   * first speaker of the new day is recorded for tomorrow's rotation.
   *
   * Resets `firstSpeakerNominated` so the new day's first speaker must
   * nominate afresh (or not at all, on Day 1).
   */
  startSpeeches(): void {
    this.requirePhase(GamePhase.DAY_ANNOUNCEMENT);

    this.speakingOrder = this.computeSpeakingOrder();
    // Remember the new first speaker so tomorrow's rotation can start from
    // the seat after them.
    this.firstSpeakerId = this.speakingOrder[0] ?? "";
    this.firstSpeakerNominated = false;
    this.currentSpeakerIndex = this.speakingOrder.length === 0 ? -1 : 0;
    this.state.phase = GamePhase.DAY_SPEECHES;
    this.state.currentSpeakerId = this.getCurrentSpeaker();
    this.state.currentDefenseId = "";

    // Arm the per-turn speech timer for the first speaker (or skip when no
    // speakers remain — same as nextSpeaker's auto-transition path).
    if (this.speakingOrder.length > 0) {
      this.startTimer("SPEECH_TURN");
    } else {
      this.clearTimer();
    }

    this.logEntry({
      actorSessionId: "",
      type: ActionType.PHASE_ADVANCE,
      payload: { event: "speeches_started", speakerCount: this.speakingOrder.length },
    });
  }

  /**
   * Advance to the next speaker in the clockwise order. When all speakers are
   * done, auto-transition to DAY_BALAGAN (Day 2+) or DAY_DEFENSE (Day 1).
   *
   * Day 2+ inserts BALAGAN between speeches and defense per ADR 0005 / ticket
   * 07. Day 1 (the first day) still skips BALAGAN.
   *
   * First-word rule (Day 2+): the first speaker must nominate an elimination
   * candidate during their speech. When `nextSpeaker` is called to end that
   * speech and they haven't nominated, the call is rejected with WRONG_PHASE
   * — the day cannot advance to BALAGAN until the first speaker fulfils the
   * nomination requirement. Day 1 has no such requirement.
   */
  nextSpeaker(): void {
    this.requirePhase(GamePhase.DAY_SPEECHES);

    // First-word rule check — gate the advance when the current speaker is
    // the first speaker of Day 2+ and they haven't nominated anyone yet.
    if (
      this.state.dayCount >= 2 &&
      this.currentSpeakerIndex === 0 &&
      !this.firstSpeakerNominated
    ) {
      throw new EngineError(
        EngineErrorCode.WRONG_PHASE,
        "First speaker on Day 2+ must nominate an elimination candidate during their speech",
      );
    }

    this.currentSpeakerIndex += 1;
    if (this.currentSpeakerIndex >= this.speakingOrder.length) {
      // All speeches done. Day 2+ inserts BALAGAN before defense; Day 1
      // skips straight to defense per ADR 0005.
      this.clearTimer();
      if (this.state.dayCount >= 2) {
        this.enterDayBalagan();
      } else {
        this.enterDayDefense();
      }
      return;
    }
    this.state.currentSpeakerId = this.getCurrentSpeaker();
    // Fresh 60s window for the new speaker.
    this.startTimer("SPEECH_TURN");
  }

  /**
   * Advance to the next nominated candidate's defense. When all defenders
   * are done, auto-transition to DAY_VOTING. Calling nextDefense on an empty
   * defense order immediately transitions (so a day with zero nominations
   * ends without a defense round).
   */
  nextDefense(): void {
    this.requirePhase(GamePhase.DAY_DEFENSE);

    this.currentDefenseIndex += 1;
    if (this.currentDefenseIndex >= this.defenseOrder.length) {
      // Voting has no timer; enterDayVoting() clears it.
      this.clearTimer();
      this.enterDayVoting();
      return;
    }
    this.state.currentDefenseId = this.getCurrentDefense();
    // Fresh 30s window for the next defender.
    this.startTimer("DEFENSE_TURN");
  }

  /**
   * Record `actorSessionId`'s vote for `targetId`. Valid only during
   * DAY_VOTING; the target must already be nominated. Players can re-vote
   * before the round closes; only the latest choice counts.
   */
  vote(actorSessionId: string, targetId: string): void {
    this.requirePhase(GamePhase.DAY_VOTING);
    this.requireAlivePlayer(actorSessionId);
    this.requireAlivePlayer(targetId);
    if (!this.state.nominations.includes(targetId)) {
      throw new EngineError(
        EngineErrorCode.WRONG_ROLE,
        `Player ${targetId} is not nominated and cannot be voted for`,
      );
    }

    this.votes.set(actorSessionId, targetId);
    this.logEntry({
      actorSessionId,
      type: ActionType.VOTE,
      payload: { targetId },
    });
  }

  /**
   * Tally the day's votes and eliminate the highest-voted candidate (single-
   * winner rule for Day 1; tie-breaking follows first-nominated-wins). Any
   * alive player who did not submit a vote gets a default vote cast for the
   * last speaker (per ADR 0003). Marks the loser dead, writes per-candidate
   * totals to `Player.votes`, fires the `onPlayerDied` seam, and transitions
   * DAY_VOTING → NIGHT.
   *
   * The candidate list for tally purposes is the explicit nominations plus
   * the last speaker — the last speaker implicitly receives default votes
   * from non-voters and is therefore eligible to win even if they did not
   * formally nominate themselves.
   *
   * Returns the resolution for tests and action-log payloads. If no one was
   * nominated and there is no last speaker (e.g., all players dead), no one
   * is eliminated and the callback is not fired.
   */
  resolveVoting(): VoteResolution {
    this.requirePhase(GamePhase.DAY_VOTING);

    // Build a complete roster of voters: every alive non-host player gets a
    // vote recorded. Non-voters are auto-assigned to the last speaker.
    const lastSpeaker = this.speakingOrder[this.speakingOrder.length - 1] ?? "";
    const voters: string[] = [];
    for (const p of this.state.players.values()) {
      if (p.isHost || !p.isAlive) continue;
      voters.push(p.sessionId);
    }

    // Apply explicit votes + default votes into a normalized voter → target map.
    const effective = new Map<string, string>();
    for (const voter of voters) {
      const explicit = this.votes.get(voter);
      effective.set(voter, explicit ?? lastSpeaker);
    }

    // The candidate list is the explicit nominations plus the last speaker
    // (who implicitly receives default votes from non-voters).
    const candidates: string[] = [...this.state.nominations];
    if (lastSpeaker !== "" && !candidates.includes(lastSpeaker)) {
      candidates.push(lastSpeaker);
    }

    // Tally per candidate.
    const counts: Record<string, number> = {};
    for (const candidate of candidates) {
      counts[candidate] = 0;
    }
    for (const target of effective.values()) {
      if (target === "") continue;
      counts[target] = (counts[target] ?? 0) + 1;
    }

    // Pick the single highest-voted candidate. Deterministic tie-break:
    // first candidate in candidate-list order (i.e. nomination order, with
    // the implicit last speaker appended last). 3-way revote logic lives in
    // the follow-up ticket 08.
    //
    // If no one was explicitly nominated, no one is eliminated — the last
    // speaker is added to the candidate list only so default votes have a
    // landing target, but they do not "win" when they were never on the
    // actual ballot.
    let eliminatedId = "";
    let best = -1;
    if (this.state.nominations.length > 0) {
      for (const candidate of candidates) {
        const c = counts[candidate] ?? 0;
        if (c > best) {
          best = c;
          eliminatedId = candidate;
        }
      }
    }

    // Write per-candidate totals to the public schema. The tallies persist
    // on Player.votes until the next DAY_ANNOUNCEMENT (cleared in
    // resetDayState), so clients can read the day's final results during
    // the post-resolution NIGHT.
    for (const candidate of candidates) {
      const player = this.state.players.get(candidate);
      if (player) player.votes = counts[candidate] ?? 0;
    }

    const resolution: VoteResolution = {
      eliminatedId,
      voteCounts: counts,
      totalVotes: voters.length,
    };

    this.logEntry({
      actorSessionId: "",
      type: ActionType.PHASE_ADVANCE,
      payload: { event: "voting_resolved", ...resolution },
    });

    // Mark the loser dead and fire the seam. The seam is intentionally the
    // only place that knows about the death — the room uses it to run victory
    // checks and host notifications.
    if (eliminatedId !== "") {
      const target = this.state.players.get(eliminatedId);
      if (target) target.isAlive = false;
      this.onPlayerDied?.(eliminatedId, "VOTE_ELIMINATION");
    }

    // Clear transient day-cycle engine state, but preserve Player.votes (see
    // comment above) so the final tally is visible during the post-vote NIGHT.
    // Votes are cleared on the next DAY_ANNOUNCEMENT via resetDayState.
    this.resetDayState({ preserveTallies: true });

    this.state.phase = GamePhase.NIGHT;
    this.state.nightStep = NightStep.MAFIA;
    // Night begins with a fresh 60s mafia window.
    this.startTimer("MAFIA_WINDOW");

    return resolution;
  }

  /**
   * Accept a ping from `fromId` to `toId`. The record is returned so the room
   * can forward it to sender, recipient, and host as a private message; the
   * engine also writes a `PING` entry to the host's action log.
   *
   * Visibility rules:
   * - LOBBY / GAME_OVER: rejected (no signalling outside of an active game).
   * - NIGHT: only mafia (DON or MAFIA) can send; the recipient must also be
   *   mafia. Mafia coordination uses pings instead of text chat.
   * - Any DAY_* phase: any alive player can ping any alive player.
   * - Dead players can neither send nor receive pings (golden rule #1 —
   *   "Dead don't speak").
   *
   * The engine never inspects network clients; the room is responsible for
   * routing the returned record to the right three parties.
   */
  ping(fromId: string, toId: string): PingRecord {
    if (
      this.state.phase === GamePhase.LOBBY ||
      this.state.phase === GamePhase.GAME_OVER
    ) {
      throw new EngineError(
        EngineErrorCode.WRONG_PHASE,
        `Pings are not allowed in phase ${this.state.phase}`,
      );
    }
    if (fromId === toId) {
      throw new EngineError(
        EngineErrorCode.WRONG_ROLE,
        "Cannot ping yourself",
      );
    }

    this.requireAlivePlayer(fromId);
    this.requireAlivePlayer(toId);

    if (this.state.phase === GamePhase.NIGHT) {
      const senderRole = this.getRole(fromId);
      if (senderRole !== Role.MAFIA && senderRole !== Role.DON) {
        throw new EngineError(
          EngineErrorCode.WRONG_ROLE,
          "Only mafia can ping during the night",
        );
      }
      const targetRole = this.getRole(toId);
      if (targetRole !== Role.MAFIA && targetRole !== Role.DON) {
        throw new EngineError(
          EngineErrorCode.WRONG_ROLE,
          "Mafia can only ping other mafia during the night",
        );
      }
    }

    const record: PingRecord = {
      id: `ping_${this.nextEntryId++}`,
      fromId,
      toId,
      timestamp: Date.now(),
    };
    this.pings.push(record);
    this.logEntry({
      actorSessionId: fromId,
      type: ActionType.PING,
      payload: { id: record.id, toId },
    });
    return record;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private requirePhase(expected: GamePhase): void {
    if (this.state.phase !== expected) {
      throw new EngineError(
        EngineErrorCode.WRONG_PHASE,
        `Action requires phase ${expected}, currently ${this.state.phase}`,
      );
    }
  }

  private requireHost(hostSessionId: string): void {
    const player = this.state.players.get(hostSessionId);
    if (!player?.isHost) {
      throw new EngineError(
        EngineErrorCode.NOT_HOST,
        "Only the host can perform this action",
      );
    }
  }

  private requireRole(actorSessionId: string, role: Role): void {
    const identity = this.identities.get(actorSessionId);
    if (!identity) {
      throw new EngineError(
        EngineErrorCode.PLAYER_MISSING,
        "Actor has no role assignment",
      );
    }
    if (identity.role !== role) {
      throw new EngineError(
        EngineErrorCode.WRONG_ROLE,
        `Action requires role ${role}, actor has ${identity.role}`,
      );
    }
  }

  private requireAlivePlayer(sessionId: string): void {
    const player = this.state.players.get(sessionId);
    if (!player) {
      throw new EngineError(
        EngineErrorCode.PLAYER_MISSING,
        `Player ${sessionId} is not at the table`,
      );
    }
    if (!player.isAlive) {
      throw new EngineError(
        EngineErrorCode.PLAYER_DEAD,
        `Player ${sessionId} is dead`,
      );
    }
  }

  private resetNightActions(): void {
    this.nightActions = {
      mafiaVictimId: "",
      donCheck: null,
      sheriffCheck: null,
      doctorHeal: null,
    };
    this.state.mafiaTargetId = "";
    this.state.doctorTargetId = "";
  }

  /**
   * Build the day's speaking order: alive non-host players sorted by seatIndex
   * (clockwise). The host never speaks. Dead players are skipped — a player
   * who dies during the night is removed from the speech roster before
   * DAY_SPEECHES starts.
   *
   * On Day 2+ (`dayCount >= 2`) the order is rotated so the first speaker is
   * the seat immediately clockwise from the previous day's first speaker
   * (ticket 07 — first-word right shifts clockwise each day). If the previous
   * first speaker is no longer at the table, we still have their seatIndex
   * (the seat is held for the lifetime of the game, even after death or
   * kick) — so the rotation uses the seatIndex as the anchor. If no alive
   * player has a strictly greater seatIndex, we wrap to the lowest seat.
   */
  private computeSpeakingOrder(): string[] {
    const players = [...this.state.players.values()]
      .filter((p) => !p.isHost && p.isAlive)
      .sort((a, b) => a.seatIndex - b.seatIndex);
    if (players.length === 0) return [];

    // Day 2+ rotation: anchor on the previous day's first speaker seatIndex.
    if (this.state.dayCount >= 2 && this.firstSpeakerId !== "") {
      const prev = this.state.players.get(this.firstSpeakerId);
      if (prev) {
        const prevSeat = prev.seatIndex;
        const startIdx = players.findIndex((p) => p.seatIndex > prevSeat);
        if (startIdx !== -1) {
          return [
            ...players.slice(startIdx),
            ...players.slice(0, startIdx),
          ].map((p) => p.sessionId);
        }
        // No seat higher than the previous first speaker (i.e. they were at
        // the highest seat) — wrap to the lowest seat.
        return players.map((p) => p.sessionId);
      }
    }

    return players.map((p) => p.sessionId);
  }

  /**
   * Build the day's defense order: nominated players (those in
   * `state.nominations`) sorted by seatIndex, so the defense follows the same
   * clockwise direction as the speeches.
   */
  private computeDefenseOrder(): string[] {
    return [...this.state.nominations]
      .map((id) => this.state.players.get(id))
      .filter((p): p is NonNullable<typeof p> => p !== undefined && p.isAlive)
      .sort((a, b) => a.seatIndex - b.seatIndex)
      .map((p) => p.sessionId);
  }

  /**
   * Enter DAY_DEFENSE from DAY_SPEECHES. Computes the defense order from the
   * nominations and points at the first defender. If no one was nominated,
   * the engine enters DAY_DEFENSE with an empty defense order; the first
   * nextDefense() call will immediately move to DAY_VOTING.
   */
  private enterDayDefense(): void {
    this.defenseOrder = this.computeDefenseOrder();
    this.currentDefenseIndex = this.defenseOrder.length === 0 ? -1 : 0;
    this.state.phase = GamePhase.DAY_DEFENSE;
    this.state.currentSpeakerId = "";
    this.state.currentDefenseId = this.getCurrentDefense();
    // Arm the per-turn defense timer for the first defender (skip when
    // nobody was nominated — nextDefense() will auto-transition).
    if (this.defenseOrder.length > 0) {
      this.startTimer("DEFENSE_TURN");
    } else {
      this.clearTimer();
    }
    this.logEntry({
      actorSessionId: "",
      type: ActionType.PHASE_ADVANCE,
      payload: { event: "defense_started", defenseCount: this.defenseOrder.length },
    });
  }

  /**
   * Enter DAY_BALAGAN from DAY_SPEECHES (Day 2+ only — Day 1 skips BALAGAN
   * per ADR 0005). Arms the 90s BALAGAN timer; expiry auto-transitions to
   * DAY_DEFENSE (see `onTimerExpired`), and the host can `skipPhase` to end
   * the debate early.
   *
   * `nominate` is also valid during BALAGAN — the phase guard in
   * `nominate` already accepts both `DAY_SPEECHES` and `DAY_BALAGAN`.
   */
  private enterDayBalagan(): void {
    this.state.phase = GamePhase.DAY_BALAGAN;
    this.state.currentSpeakerId = "";
    this.state.currentDefenseId = "";
    this.startTimer("BALAGAN");
    this.logEntry({
      actorSessionId: "",
      type: ActionType.PHASE_ADVANCE,
      payload: { event: "balagan_started" },
    });
  }

  /**
   * Enter DAY_VOTING from DAY_DEFENSE. Resets the vote buffer to prepare for
   * a fresh round; clients see DAY_VOTING and may now submit votes.
   */
  private enterDayVoting(): void {
    this.votes.clear();
    this.state.phase = GamePhase.DAY_VOTING;
    this.state.currentDefenseId = "";
    // Voting is resolved manually via resolveVoting; no auto-timer.
    this.clearTimer();
    this.logEntry({
      actorSessionId: "",
      type: ActionType.PHASE_ADVANCE,
      payload: { event: "voting_started", nominations: this.state.nominations.length },
    });
  }

  /**
   * Reset day-cycle state. Called from two places:
   *  - `resolveNight` (new day starts) — clears Player.votes too.
   *  - `resolveVoting` (day just ended) — preserves Player.votes so clients
   *    can read the final tally during the post-resolution NIGHT.
   */
  private resetDayState({ preserveTallies }: { preserveTallies: boolean } = { preserveTallies: false }): void {
    for (const p of this.state.players.values()) {
      p.isNominated = false;
      if (!preserveTallies) p.votes = 0;
    }
    this.state.nominations.splice(0, this.state.nominations.length);
    this.state.currentSpeakerId = "";
    this.state.currentDefenseId = "";
    this.speakingOrder = [];
    this.currentSpeakerIndex = -1;
    this.defenseOrder = [];
    this.currentDefenseIndex = -1;
    this.votes.clear();
    // `firstSpeakerId` and `firstSpeakerNominated` are intentionally NOT
    // reset here — `firstSpeakerId` carries across days so Day N+1's
    // rotation can anchor on Day N's first speaker. `firstSpeakerNominated`
    // is reset by `startSpeeches` for the new day.
  }

  private logEntry(entry: Omit<ActionLogEntry, "id" | "timestamp" | "phase" | "dayCount" | "nightStep">): void {
    this.actionLog.push({
      id: `act_${this.nextEntryId++}`,
      timestamp: Date.now(),
      phase: this.state.phase,
      dayCount: this.state.dayCount,
      nightStep: this.state.nightStep,
      ...entry,
    });
  }

  /**
   * Test-only: inject a role directly into the engine's identity map. Useful
   * when integration tests want to bypass the random role shuffle to assert
   * specific game-flow behavior.
   */
  _assignRoleForTest(sessionId: string, role: Role): void {
    this.identities.set(sessionId, {
      sessionId,
      role,
      team: roleToTeam(role),
    });
  }

  /**
   * Test-only: seed the Doctor's last-healed record. Mirrors what a previous
   * `resolveNight` would have set after the Doctor healed someone.
   */
  _setLastHealedForTest(doctorSessionId: string, targetId: string): void {
    this.lastHealed.set(doctorSessionId, targetId);
  }

  /**
   * Test-only: pin the previous day's first speaker. Used by the
   * wrap-around rotation test (ticket 07) to set up `firstSpeakerId` to a
   * specific player without driving a full day cycle.
   */
  _setFirstSpeakerIdForTest(sessionId: string): void {
    this.firstSpeakerId = sessionId;
  }

  // ─── Phase timers + host overrides (ticket 04) ─────────────────────────

  /** Wall-clock now, injectable for tests. */
  private now(): number {
    return this.clock();
  }

  /** Arm (or re-arm) the phase timer for `mode` with the default duration. */
  private startTimer(mode: PhaseTimerMode): void {
    const config = DEFAULT_TIMER_DURATIONS[mode];
    this.phaseTimer = new PhaseTimer(mode, config.durationMs, config.reminders, this.now());
  }

  /** Clear the active phase timer. Called on phase exit and on host skip. */
  private clearTimer(): void {
    this.phaseTimer = null;
  }

  /**
   * Snapshot of the active phase timer, or `null` when no timer is running.
   * The room layer uses this for host-side display (e.g., "speech timer:
   * 42s left"); tests use it to assert timer state without driving ticks.
   */
  getPhaseTimer(): PhaseTimerSnapshot | null {
    if (!this.phaseTimer) return null;
    return this.phaseTimer.snapshot(this.now());
  }

  /**
   * Advance the active phase timer and dispatch any events. Called by the
   * room layer on every wall-clock tick (~250ms). Returns the raw event list
   * so the room can route REMINDERs to the host; the engine has already
   * reacted to EXPIRED events internally (calling `nextSpeaker`,
   * `nextDefense`, or pausing the mafia window).
   */
  tickPhaseTimer(): PhaseTimerEvent[] {
    if (!this.phaseTimer) return [];
    const events = this.phaseTimer.tick(this.now());
    for (const event of events) {
      if (event.type === "EXPIRED") {
        this.onTimerExpired(event.mode);
      }
    }
    return events;
  }

  /**
   * React to a timer expiry. Dispatch by mode:
   * - per-turn phases (SPEECH_TURN, DEFENSE_TURN) → call the matching advance,
   *   which either restarts the timer (next turn) or auto-transitions to the
   *   next phase (round complete).
   * - BALAGAN → enter DAY_DEFENSE (no-op for Day 1; wired in ticket 07).
   * - MAFIA_WINDOW → pause indefinitely per spec; resume re-arms a fresh
   *   60s window so the host can keep nudging.
   */
  private onTimerExpired(mode: PhaseTimerMode): void {
    switch (mode) {
      case "SPEECH_TURN":
        this.phaseTimer = null;
        this.nextSpeaker();
        break;
      case "DEFENSE_TURN":
        this.phaseTimer = null;
        this.nextDefense();
        break;
      case "BALAGAN":
        // Day 2+ inserts BALAGAN between speeches and defense; its expiry
        // advances into DAY_DEFENSE.
        this.phaseTimer = null;
        this.enterDayDefense();
        break;
      case "MAFIA_WINDOW":
        // Spec: if no victim by the deadline, the phase pauses indefinitely.
        // We transition the timer into paused state and keep it around so
        // `resumePhase` can re-arm a fresh 60s window.
        this.phaseTimer?.pause(this.now());
        break;
    }
  }

  // ─── Host overrides ──────────────────────────────────────────────────────

  /**
   * Host-only: pause the active phase timer. No-op if there is no timer or
   * the timer is already paused.
   */
  pausePhase(hostSessionId: string): void {
    this.requireHost(hostSessionId);
    if (!this.phaseTimer || this.phaseTimer.isPaused()) return;
    this.phaseTimer.pause(this.now());
    this.logEntry({
      actorSessionId: hostSessionId,
      type: ActionType.PHASE_OVERRIDE,
      payload: { event: "pause", mode: this.phaseTimer.mode },
    });
  }

  /**
   * Host-only: resume the active phase timer. No-op if there is no timer or
   * the timer is not paused. After a MAFIA_WINDOW expiry, resume re-arms a
   * fresh 60s window so the host gets another nudge cycle; for other modes
   * the timer picks up from the pause point.
   */
  resumePhase(hostSessionId: string): void {
    this.requireHost(hostSessionId);
    if (!this.phaseTimer) return;
    if (!this.phaseTimer.isPaused()) return;

    if (this.phaseTimer.mode === "MAFIA_WINDOW") {
      // Re-arm a fresh window. Per spec the host gets another full 60s to
      // submit a victim; we don't continue counting from where we left off.
      this.startTimer("MAFIA_WINDOW");
    } else {
      this.phaseTimer.resume(this.now());
    }
    this.logEntry({
      actorSessionId: hostSessionId,
      type: ActionType.PHASE_OVERRIDE,
      payload: { event: "resume", mode: this.phaseTimer.mode },
    });
  }

  /**
   * Host-only: skip the current phase immediately. For per-turn phases this
   * is equivalent to calling `nextSpeaker` / `nextDefense` once (which may
   * cascade through the round). For MAFIA_WINDOW the spec offers no
   * downstream phase to advance to inside NIGHT step MAFIA, so skip is a
   * no-op.
   */
  skipPhase(hostSessionId: string): void {
    this.requireHost(hostSessionId);
    if (!this.phaseTimer) return;
    const mode = this.phaseTimer.mode;
    this.phaseTimer = null;

    this.logEntry({
      actorSessionId: hostSessionId,
      type: ActionType.PHASE_OVERRIDE,
      payload: { event: "skip", mode },
    });

    switch (mode) {
      case "SPEECH_TURN":
        this.nextSpeaker();
        break;
      case "DEFENSE_TURN":
        this.nextDefense();
        break;
      case "MAFIA_WINDOW":
        // No phase to jump to inside NIGHT step MAFIA — the host must
        // submit a victim or hold the pause.
        break;
      case "BALAGAN":
        // Day 2+ inserts BALAGAN between speeches and defense; skipping
        // jumps straight to DAY_DEFENSE.
        this.enterDayDefense();
        break;
    }
  }

  /**
   * Host-only: add `seconds` to the active phase timer. No-op when no timer
   * is active. The added time is reflected in the next `getPhaseTimer()`
   * snapshot.
   */
  extendPhase(hostSessionId: string, seconds: number): void {
    this.requireHost(hostSessionId);
    if (!this.phaseTimer) return;
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    this.phaseTimer.extend(seconds);
    this.logEntry({
      actorSessionId: hostSessionId,
      type: ActionType.PHASE_OVERRIDE,
      payload: { event: "extend", mode: this.phaseTimer.mode, seconds },
    });
  }

  // ─── Disconnect pause + declareDead (ticket 05) ──────────────────────────

  /**
   * SessionIds of players who are currently missing (dropped, awaiting the
   * host's `declareDead` decision). The set is the source of truth for
   * `Player.isMissing` in the public schema; the room reads it indirectly
   * via the schema field and via the `PLAYER_MISSING` / `PLAYER_RETURNED`
   * entries in the action log.
   */
  getMissingPlayers(): string[] {
    return [...this.missing];
  }

  /**
   * Called by the room when a player drops mid-phase. Pauses the phase
   * timer (if any), marks the player missing in the public schema, and
   * records a `PLAYER_MISSING` entry in the host's action log so the host
   * UI can surface the notification. Idempotent: a second drop while the
   * phase is already paused for someone else is a no-op.
   *
   * Returns `true` when state actually changed (room should notify the
   * host); `false` for the silent no-op cases (LOBBY/GAME_OVER, already
   * missing, not at the table, or already dead).
   *
   * Disconnects in LOBBY and GAME_OVER are silently ignored — there is no
   * phase to pause. The room is expected to drop the player from
   * `state.players` via the normal Colyseus flow in that case.
   */
  pauseForMissing(sessionId: string): boolean {
    if (
      this.state.phase === GamePhase.LOBBY ||
      this.state.phase === GamePhase.GAME_OVER
    ) {
      return false;
    }
    if (this.missing.has(sessionId)) return false;
    const player = this.state.players.get(sessionId);
    if (!player) return false;
    if (!player.isAlive) return false;

    this.missing.add(sessionId);
    player.isMissing = true;
    if (this.phaseTimer && !this.phaseTimer.isPaused()) {
      this.phaseTimer.pause(this.now());
    }
    this.logEntry({
      actorSessionId: "",
      type: ActionType.PLAYER_MISSING,
      payload: { sessionId },
    });
    return true;
  }

  /**
   * Called by the room when a missing player reconnects within the
   * Colyseus reconnection window (default 30s) or when the reconnection
   * grace expires without a reconnect. Clears the missing flag and resumes
   * the timer if it was paused for the drop. No-op if the player wasn't
   * missing.
   *
   * Returns `true` when state actually changed (room should notify the
   * host); `false` for the silent no-op case.
   *
   * If the host already called `declareDead` (so the player is permanently
   * dead in the schema), `declareDead` has already cleared them from the
   * missing set; `clearMissing` is a no-op in that case.
   */
  clearMissing(sessionId: string): boolean {
    if (!this.missing.has(sessionId)) return false;
    this.missing.delete(sessionId);
    const player = this.state.players.get(sessionId);
    if (player) player.isMissing = false;
    this.resumePausedTimer();
    this.logEntry({
      actorSessionId: "",
      type: ActionType.PLAYER_RETURNED,
      payload: { sessionId },
    });
    return true;
  }

  /**
   * Host-only: declare a missing player dead and resume the phase. The
   * player is removed from the missing set, `Player.isAlive` is cleared
   * (so any reconnect attempt will be rebuffed by `requireAlivePlayer`),
   * and the `onPlayerDied` seam fires with `DECLARED_DEAD` — the same
   * observation point that handles vote eliminations and mafia kills, so
   * the future victory-check work in ticket 09 picks up declared-dead
   * players automatically.
   *
   * Guards: requires host, requires `sessionId` to be at the table and
   * currently missing. Re-declaring an already-dead player is rejected
   * with PLAYER_DEAD; declaring a player who isn't missing is rejected
   * with WRONG_ROLE (the host can only resolve a known disconnect).
   */
  declareDead(hostSessionId: string, sessionId: string): void {
    this.requireHost(hostSessionId);
    const player = this.state.players.get(sessionId);
    if (!player) {
      throw new EngineError(
        EngineErrorCode.PLAYER_MISSING,
        `Player ${sessionId} is not at the table`,
      );
    }
    if (!this.missing.has(sessionId)) {
      throw new EngineError(
        EngineErrorCode.WRONG_ROLE,
        `Player ${sessionId} is not missing — only a missing player can be declared dead`,
      );
    }
    if (!player.isAlive) {
      throw new EngineError(
        EngineErrorCode.PLAYER_DEAD,
        `Player ${sessionId} is already dead`,
      );
    }

    this.missing.delete(sessionId);
    player.isMissing = false;
    player.isAlive = false;

    this.logEntry({
      actorSessionId: hostSessionId,
      type: ActionType.DEAD_DECLARED,
      payload: { sessionId },
    });

    // Fire the seam BEFORE resuming the timer so any host-side victory
    // check that wants to inspect post-death state (e.g. did this kill
    // the last mafia?) sees the public schema already updated.
    this.onPlayerDied?.(sessionId, "DECLARED_DEAD");

    this.resumePausedTimer();
  }

  /**
   * Resume a timer that was paused by `pauseForMissing` (or, equivalently,
   * by `declareDead`). The semantics mirror `resumePhase`: the mafia
   * window re-arms a fresh 60s, everything else picks up from the pause
   * point. No-op if the timer wasn't paused or there is no active timer.
   */
  private resumePausedTimer(): void {
    if (!this.phaseTimer) return;
    if (!this.phaseTimer.isPaused()) return;
    if (this.phaseTimer.mode === "MAFIA_WINDOW") {
      this.startTimer("MAFIA_WINDOW");
    } else {
      this.phaseTimer.resume(this.now());
    }
  }

  // ─── Host moderation: kick + foul (ticket 06) ────────────────────────────

  /**
   * Host-only: eject a player from the game (e.g. for showing a role card).
   * The player is marked dead and reduced to a read-only spectator: they
   * stay connected and observe the public state, but every player action is
   * rejected (the room gates non-host messages from dead players; the
   * role-action guards added in this ticket are defense in depth). The seat
   * is held — the player stays in `state.players` with their seatIndex, and
   * their role identity stays sealed in the engine (never revealed).
   *
   * Moderation, not phase-flow (kept separate from the phase timers): kick
   * does not advance, pause, or resume anything. If the kicked player was
   * mid-turn the host moves the round along manually (skipPhase).
   *
   * The `onPlayerDied` seam fires with cause `KICKED` so the victory check
   * (ticket 09) sees an ejection exactly like any other death.
   *
   * Guards: requires host, requires an active game (LOBBY has no game to be
   * ejected from and GAME_OVER state is frozen for the reveal), requires the
   * target to be at the table, alive, and not the host.
   */
  kick(hostSessionId: string, targetId: string, reason: string): void {
    this.requireHost(hostSessionId);
    if (
      this.state.phase === GamePhase.LOBBY ||
      this.state.phase === GamePhase.GAME_OVER
    ) {
      throw new EngineError(
        EngineErrorCode.WRONG_PHASE,
        `kick requires an active game, currently ${this.state.phase}`,
      );
    }
    const player = this.state.players.get(targetId);
    if (!player) {
      throw new EngineError(
        EngineErrorCode.PLAYER_MISSING,
        `Player ${targetId} is not at the table`,
      );
    }
    if (player.isHost) {
      throw new EngineError(
        EngineErrorCode.WRONG_ROLE,
        "The host cannot be kicked",
      );
    }
    if (!player.isAlive) {
      throw new EngineError(
        EngineErrorCode.PLAYER_DEAD,
        `Player ${targetId} is already dead`,
      );
    }

    player.isAlive = false;

    this.logEntry({
      actorSessionId: hostSessionId,
      type: ActionType.KICK,
      payload: { sessionId: targetId, reason },
    });

    // Same seam as mafia kills / vote eliminations / declared-dead: one
    // observation point for every way a player leaves the living.
    this.onPlayerDied?.(targetId, "KICKED");
  }

  /**
   * Host-only: record a foul (a formal warning) against a player without
   * touching their game state — the player stays alive and fully active.
   * A pure log entry: the host UI reads FOUL entries out of the action log.
   *
   * Works in any phase, including LOBBY and GAME_OVER (a warning before the
   * game or after a death is still a warning); the only requirements are
   * host authority and the target being at the table.
   */
  foul(hostSessionId: string, targetId: string, reason: string): void {
    this.requireHost(hostSessionId);
    if (!this.state.players.has(targetId)) {
      throw new EngineError(
        EngineErrorCode.PLAYER_MISSING,
        `Player ${targetId} is not at the table`,
      );
    }

    this.logEntry({
      actorSessionId: hostSessionId,
      type: ActionType.FOUL,
      payload: { sessionId: targetId, reason },
    });
  }

  /**
   * Test-only: replace the wall-clock provider. Lets integration tests
   * advance time deterministically without sleeping.
   */
  _setClockForTest(clock: () => number): void {
    this.clock = clock;
  }
}
