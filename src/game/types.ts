import { GamePhase, Role, NightStep, Team } from "../rooms/schema/enums.js";
import type { PhaseTimerMode } from "./PhaseTimer.js";

export { PhaseTimer, PhaseTimerMode, PhaseTimerEvent, PhaseTimerSnapshot } from "./PhaseTimer.js";

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
  PHASE_ADVANCE = "PHASE_ADVANCE",
  PHASE_OVERRIDE = "PHASE_OVERRIDE",
}

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
 * a single subscription; the room uses it to react to elimination (currently
 * logging and victory checks — those are follow-up tickets). Day-cycle
 * elimination fires `VOTE_ELIMINATION`; night deaths use `MAFIA_KILL`;
 * disconnect declarations use `DECLARED_DEAD`.
 */
export type DeathCause =
  | "MAFIA_KILL"
  | "VOTE_ELIMINATION"
  | "DECLARED_DEAD";

/**
 * Result of resolving a day cycle's voting round. The engine applies this
 * to the public schema (Player.isAlive, Player.votes) and returns a copy for
 * tests and for the action log entry.
 *
 * `eliminatedId` is the sessionId of the eliminated player, or empty string
 * when there were no candidates (no nominations → no elimination).
 */
export interface VoteResolution {
  eliminatedId: string;
  voteCounts: Record<string, number>;
  totalVotes: number;
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
}

export class EngineError extends Error {
  constructor(public readonly code: EngineErrorCode, message: string) {
    super(message);
    this.name = "EngineError";
  }
}