import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";
import { GamePhase, NightStep } from "./enums.js";

/**
 * Public player record. Roles and teams are NOT exposed here — see ADR 0004.
 * The canonical role/team store is a server-side map in `src/game/Engine.ts`.
 */
export class Player extends Schema {
  @type("string") sessionId: string = "";
  @type("number") seatIndex: number = 0;
  @type("string") name: string = "";
  @type("boolean") isAlive: boolean = true;
  @type("boolean") isHost: boolean = false;
  @type("boolean") isNominated: boolean = false;
  @type("number") votes: number = 0;
}

export class MafiaState extends Schema {
  @type("string") phase: GamePhase = GamePhase.LOBBY;
  @type("number") dayCount: number = 0;
  @type("string") nightStep: NightStep = NightStep.MAFIA;

  // Result of the last resolved night. Empty string = nobody died.
  @type("string") died: string = "";

  // Room settings
  @type("number") maxPlayers: number = 12;
  // Voting behavior (see ADR 0006)
  @type("number") revoteCap: number = 3;
  @type("string") revoteBehavior: "host-arbitrates" | "auto-pardon" = "host-arbitrates";

  // Players logic
  @type("string") hostId: string = "";
  @type({ map: Player }) players = new MapSchema<Player>();

  // Active night action targets (latest submitted). Sticky until the night resolves.
  // Reset on resolveNight.
  @type("string") doctorTargetId: string = "";
  @type("string") mafiaTargetId: string = "";

  // For future day-phase work (not yet implemented).
  @type(["string"]) nominations = new ArraySchema<string>();

  // Day-cycle pointers. Empty string means "no active speaker / defender".
  // Updated by the engine as it walks through DAY_SPEECHES / DAY_DEFENSE.
  @type("string") currentSpeakerId: string = "";
  @type("string") currentDefenseId: string = "";
}