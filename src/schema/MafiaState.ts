import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";
import { Player } from "./PlayerState.js";
import { VoteState } from "./VoteState.js";

// Game enums
export enum GamePhase {
  WAITING = "waiting",
  PAUSE = "pause",
  NIGHT = "night",

  DAY_ANNOUNCE = "day_announce",
  DAY_DISCUSSION = "day_discussion",
  DAY_DEFENSE = "day_defense",
  DAY_VOTE = "day_vote",
  DAY_REVOTE = "day_revote",

  ENDED = "ended"
}

export class ChatMessage extends Schema {
  @type("string") author: string = "";
  @type("string") text: string = "";
}


export class MafiaState extends Schema {
  @type("string") phase: GamePhase = GamePhase.WAITING;
  @type("uint8")   dayNumber: number = 0;
  @type("string")  phaseDeadline: string = ""; // ISO-таймстемп завершення фази
  @type("string")  winner: string = "";        // "" | "red" | "black"
  @type("string")  nightVictimId: string = ""; // sessionId вбитого цієї ночі

  // Room settings
  @type("number") maxPlayers: number = 12;

  // Players logic
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: VoteState })   votes   = new MapSchema<VoteState>();

  // Core actions
  @type(["string"]) speechOrder = new ArraySchema<string>();

  // Social
  @type([ChatMessage]) chat = new ArraySchema<ChatMessage>();
}
