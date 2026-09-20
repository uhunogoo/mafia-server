import { GamePhase, Role, NightStep, Team } from "../rooms/schema/enums.js";

import type { PhaseTimerMode } from "./PhaseTimer.js";
export type { PhaseTimerMode, PhaseTimerEvent, PhaseTimerSnapshot } from "./PhaseTimer.js";

/**
 * Default durations and reminder marks (seconds elapsed) for each phase timer
 * mode. Centralized so the engine, the room, and the host UI all share one
 * source of truth. Per ticket 04:
 *
 * - `MAFIA_WINDOW` — 60s with reminders at 30s and 50s elapsed (per
 *   `CONTEXT.md` / spec). Expiry pauses the phase indefinitely (no auto-
 *   advance; the host must submit a victim or hold the pause).
 * - `SPEECH_TURN`  — 60s per speaker; the timer is restarted on every
 *   `nextSpeaker` call so each speaker gets a fresh window.
 * - `DEFENSE_TURN` — 30s per candidate; the timer is restarted on every
 *   `nextDefense` call.
 * - `BALAGAN`      — 90s (in the 1–2 minute range from the spec). Day 1 skips
 *   BALAGAN; ticket 07 owns the entry/exit wiring. The mode is defined here
 *   so ticket 07 can arm the timer by simply calling `startTimer("BALAGAN")`.
 */
export const DEFAULT_TIMER_DURATIONS: Record<PhaseTimerMode, { durationMs: number; reminders: readonly number[] }> = {
  MAFIA_WINDOW: { durationMs: 60_000, reminders: [30, 50] },
  SPEECH_TURN:  { durationMs: 60_000, reminders: [] },
  DEFENSE_TURN: { durationMs: 30_000, reminders: [] },
  BALAGAN:      { durationMs: 90_000, reminders: [60] },
};

/**
 * Canonical role distribution per player count. The list is the role pool;
 * the engine shuffles it and assigns one role per seat.
 *
 * - 9  → 1 Don, 1 Mafia, 1 Sheriff, 1 Doctor, 5 Civilians
 * - 10 → 1 Don, 2 Mafia, 1 Sheriff, 1 Doctor, 5 Civilians
 * - 11 → 1 Don, 2 Mafia, 1 Sheriff, 1 Doctor, 6 Civilians
 */
export const ROLE_DISTRIBUTION: Record<number, Role[]> = {
  9:  [Role.DON, Role.MAFIA, Role.SHERIFF, Role.DOCTOR,
        Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN],
  10: [Role.DON, Role.MAFIA, Role.MAFIA, Role.SHERIFF, Role.DOCTOR,
        Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN],
  11: [Role.DON, Role.MAFIA, Role.MAFIA, Role.SHERIFF, Role.DOCTOR,
        Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN, Role.CIVILIAN],
};

export const SUPPORTED_PLAYER_COUNTS = [9, 10, 11] as const;

/**
 * Anything sent from a client to the server (or recorded in the host log).
 * Slice-1 covers only the four night actions; the rest are placeholders for
 * follow-up tickets.
 */
export enum ActionType {
  MAFIA_KILL = "MAFIA_KILL",
  DON_CHECK = "DON_CHECK",
  SHERIFF_CHECK = "SHERIFF_CHECK",
  DOCTOR_HEAL = "DOCTOR_HEAL",
  NOMINATE = "NOMINATE",
  VOTE = "VOTE",
  PING = "PING",
  FOUL = "FOUL",
  KICK = "KICK",
  DEAD_DECLARED = "DEAD_DECLARED",
  PLAYER_MISSING = "PLAYER_MISSING",
  PLAYER_RETURNED = "PLAYER_RETURNED",
  PHASE_ADVANCE = "PHASE_ADVANCE",
  PHASE_OVERRIDE = "PHASE_OVERRIDE",
  TIE_ARBITRATION = "TIE_ARBITRATION",
}

/**
 * Ticket 08: the three choices the host can make when the engine pauses a
 * persistent 3+ way vote tie after `revoteCap` consecutive revotes (ADR 0006).
 */
export type TieArbitrationChoice = "auto-pardon" | "force-candidate" | "kick-player";

/**
 * One entry in the host-only action log. The log is server-side memory;
 * player clients never see these entries.
 */
export interface ActionLogEntry {
  id: string;
  timestamp: number;
  phase: GamePhase;
  dayCount: number;
  nightStep: NightStep;
  actorSessionId: string;          // empty string for system events
  type: ActionType;
  payload: Record<string, unknown>;
}

/**
 * Identity record kept by the engine. `Player` in the public schema does NOT
 * carry these fields (per ADR 0004).
 */
export interface PlayerIdentity {
  sessionId: string;
  role: Role;
  team: Team;
}

/**
 * Result of the Don's check action (ticket 07b). Returned by `engine.donCheck`
 * and routed privately to the Don's client — never to the target, other
 * players, or the public schema.
 */
export interface DonCheckResult {
  targetId: string;
  isSheriff: boolean;
}

/**
 * Result of the Sheriff's check action (ticket 07b). Returned by
 * `engine.sheriffCheck` and routed privately to the Sheriff's client. The Don
 * always reports as BLACK to the Sheriff (per spec); for every other role the
 * reported team is the target's canonical team.
 */
export interface SheriffCheckResult {
  targetId: string;
  team: Team;
}

/**
 * Result of resolving a single night. The engine applies this to the public
 * `state.died` field; tests assert on it.
 */
export interface NightResolution {
  died: string;                    // empty string = no one died
  mafiaVictimId: string;
  doctorHealId: string;
}

/**
 * Cause of death fired through the engine's `onPlayerDied` seam. The seam is
 * the single observation point for every way a player leaves the living, and
 * is also where the engine runs the victory check (ticket 09). Day-cycle
 * elimination fires `VOTE_ELIMINATION`; night deaths use `MAFIA_KILL`;
 * disconnect declarations use `DECLARED_DEAD`; host moderation (ticket 06)
 * uses `KICKED`.
 */
export type DeathCause =
  | "MAFIA_KILL"
  | "VOTE_ELIMINATION"
  | "DECLARED_DEAD"
  | "KICKED";

/**
 * Ticket 09: how the game ended. Civilian victory — all blacks (Mafia + Don)
 * are dead. Mafia victory — living blacks ≥ living reds.
 */
export type VictoryReason = "CIVILIAN_VICTORY" | "MAFIA_VICTORY";

/**
 * Ticket 09: the outcome of the victory check. `winner` is the team that
 * wins; `reason` says which condition triggered it.
 */
export interface GameOverResult {
  winner: Team;
  reason: VictoryReason;
}

/**
 * Ticket 09: one player's revealed identity for the GAME_OVER reveal. The
 * reveal travels as a private message to every client (ADR 0004 — the public
 * schema never carries roles, even after the game ends).
 */
export interface RoleReveal {
  sessionId: string;
  role: Role;
  team: Team;
}
/**
 * Result of resolving a day cycle's voting round (one `resolveVoting` call —
 * including each revote round; ticket 08). The engine applies this to the
 * public schema (Player.isAlive, Player.votes) and returns a copy for tests
 * and for the action log entry.
 *
 * `outcome`:
 *  - "eliminated"    — a single winner; `eliminatedId` is their sessionId.
 *  - "auto-pardon"   — a 2-way tie (ADR 0003) or any tie when
 *                      `revoteBehavior = "auto-pardon"`; nobody dies, the day
 *                      ends, night falls.
 *  - "revote"        — a 3+ way tie under `revoteBehavior =
 *                      "host-arbitrates"` before the cap; a revote round among
 *                      `tiedLeaders` just started (phase stays DAY_VOTING).
 *  - "host-decision" — the revote cap was reached; the engine is paused
 *                      awaiting the host's arbitration among `tiedLeaders`.
 *  - "no-candidates" — nobody was nominated; no elimination (last speaker
 *                      never wins from default votes alone when off-ballot).
 *
 * `eliminatedId` is the sessionId of the eliminated player, or empty string
 * when nobody was eliminated (auto-pardon / no-candidates / revote /
 * host-decision).
 */
export type VoteOutcome =
  | "eliminated"
  | "auto-pardon"
  | "revote"
  | "host-decision"
  | "no-candidates";

export interface VoteResolution {
  outcome: VoteOutcome;
  eliminatedId: string;
  voteCounts: Record<string, number>;
  totalVotes: number;
  /** The tied leaders, set when outcome is "revote" or "host-decision". */
  tiedLeaders?: string[];
  /** The 1-based number of the revote round that just started (outcome "revote"). */
  revoteNumber?: number;
}

/**
 * A single ping between two players. Pings are ephemeral signals — no message
 * body — used for social coordination. The engine stores every ping it accepts
 * so the host's action log can replay them, and the room uses the record to
 * route the private `ping` message to sender, recipient, and host only.
 *
 * Per ADR 0002: players only see pings they sent or received; pings render
 * for ~10s on the receiving client and disappear.
 */
export interface PingRecord {
  id: string;
  fromId: string;
  toId: string;
  timestamp: number;
}

/**
 * Errors thrown when the engine rejects an input. Each carries a code so the
 * room can translate to a player-visible message without leaking internals.
 */
export enum EngineErrorCode {
  WRONG_PHASE = "WRONG_PHASE",
  NOT_HOST = "NOT_HOST",
  WRONG_ROLE = "WRONG_ROLE",
  PLAYER_DEAD = "PLAYER_DEAD",
  PLAYER_MISSING = "PLAYER_MISSING",
  DOCTOR_RESTRICTION = "DOCTOR_RESTRICTION",
  GAME_LOCKED = "GAME_LOCKED",
  VOTE_ALREADY_CAST = "VOTE_ALREADY_CAST",
}

export class EngineError extends Error {
  constructor(public readonly code: EngineErrorCode, message: string) {
    super(message);
    this.name = "EngineError";
  }
}
