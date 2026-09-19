import { MafiaState } from "../rooms/schema/MafiaState.js";
import { GamePhase, NightStep, Role, Team } from "../rooms/schema/enums.js";
import {
  ActionLogEntry,
  ActionType,
  EngineError,
  EngineErrorCode,
  NightResolution,
  PlayerIdentity,
  ROLE_DISTRIBUTION,
  SUPPORTED_PLAYER_COUNTS,
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

  /** Returns the Doctor's last healed target (or empty string if none). */
  getLastHealed(doctorSessionId: string): string {
    return this.lastHealed.get(doctorSessionId) ?? "";
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
   * night action buffer and stores the Doctor's last-healed target for the
   * next night.
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
    return resolution;
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
