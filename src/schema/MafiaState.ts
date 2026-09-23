import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";
import { PlayerState } from "./PlayerState.js";
import { VoteState } from "./VoteState.js";
import { RoleLogEntry } from "./LogSchema.js";
import { PingInstance } from "./PingSchema.js";
import { NightActionState } from "./NightActionState.js";
import { SpeechQueueState } from "./SpeechQueueState.js";
import { GamePhase } from "./enums.js";

export class MafiaState extends Schema {
  // Room settings
  @type("string") phase: GamePhase = GamePhase.LOBBY;
  @type("number") nightCount: number = 0;
  @type("number") dayCount: number = 0;
  @type("string") winner: string = ""; // "red" | "black" | "" (for GAME_OVER)
  @type("string") hostId: string = "";

  // Players logic
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: "number" }) nominations = new MapSchema<number>();

  // Actions
  @type(NightActionState) nightAction = new NightActionState();
  @type(SpeechQueueState) speechQueue = new SpeechQueueState();
  @type(VoteState) vote = new VoteState();

  // Pings
  @type({ map: PingInstance }) activePings = new MapSchema<PingInstance>();

  // Logs
  @type([RoleLogEntry]) mafiaLog = new ArraySchema<RoleLogEntry>();
  @type([RoleLogEntry]) donLog = new ArraySchema<RoleLogEntry>();
  @type([RoleLogEntry]) sheriffLog = new ArraySchema<RoleLogEntry>();
  @type([RoleLogEntry]) doctorLog = new ArraySchema<RoleLogEntry>();
}
