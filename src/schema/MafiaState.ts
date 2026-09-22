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

export class MafiaState extends Schema {

  // Room settings
  @type("number") maxPlayers: number = 12;
  @type("string") phase: GamePhase = GamePhase.WAITING;

  // Players logic
  @type({ map: Player }) players = new MapSchema<Player>();

}
