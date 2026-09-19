import { MafiaState } from "../rooms/schema/MafiaState.js";
import { GamePhase, NightStep, Role, Team } from "../rooms/schema/enums.js";
import {
  ActionLogEntry,
  ActionType,
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
   * Optional seam fired whenever a player dies. Day-cycle elimination calls it
   * with `VOTE_ELIMINATION`; night mafia kills call `MAFIA_KILL`; follow-up
   * tickets (05) add `DECLARED_DEAD` for host-declared dead on disconnect.
   * The room uses this hook to run victory checks and host notifications.
   */
  private onPlayerDied: ((sessionId: string, cause: DeathCause) => void) | null = null;

  private nextEntryId = 0;

  constructor(public readonly state: MafiaState) {}

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

    return resolution;
  }

  // ─── Day cycle ──────────────────────────────────────────────────────────

  /**
   * Register a callback fired whenever a player dies. The room subscribes to
   * observe elimination so it can run victory checks and host notifications.
   * Pass `null` to unsubscribe. A single callback overwrites any previous one.
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
   */
  startSpeeches(): void {
    this.requirePhase(GamePhase.DAY_ANNOUNCEMENT);

    this.speakingOrder = this.computeSpeakingOrder();
    this.currentSpeakerIndex = this.speakingOrder.length === 0 ? -1 : 0;
    this.state.phase = GamePhase.DAY_SPEECHES;
    this.state.currentSpeakerId = this.getCurrentSpeaker();
    this.state.currentDefenseId = "";

    this.logEntry({
      actorSessionId: "",
      type: ActionType.PHASE_ADVANCE,
      payload: { event: "speeches_started", speakerCount: this.speakingOrder.length },
    });
  }

  /**
   * Advance to the next speaker in the clockwise order. When all speakers are
   * done, auto-transition to DAY_DEFENSE (skipping DAY_BALAGAN on Day 1 per
   * ADR 0005 — Day 2+ ticket 07 will revisit the BALAGAN insertion).
   */
  nextSpeaker(): void {
    this.requirePhase(GamePhase.DAY_SPEECHES);

    this.currentSpeakerIndex += 1;
    if (this.currentSpeakerIndex >= this.speakingOrder.length) {
      this.enterDayDefense();
      return;
    }
    this.state.currentSpeakerId = this.getCurrentSpeaker();
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
      this.enterDayVoting();
      return;
    }
    this.state.currentDefenseId = this.getCurrentDefense();
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
   */
  private computeSpeakingOrder(): string[] {
    const players = [...this.state.players.values()]
      .filter((p) => !p.isHost && p.isAlive)
      .sort((a, b) => a.seatIndex - b.seatIndex);
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
    this.logEntry({
      actorSessionId: "",
      type: ActionType.PHASE_ADVANCE,
      payload: { event: "defense_started", defenseCount: this.defenseOrder.length },
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
}
