import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";
import { GamePhase } from "./enums.js";

export class Player extends Schema {
  @type("string") sessionId: string;
  @type("number") seatIndex: number;
  @type("string") name: string = "";
  @type("string") role: string = ""; // "civilian" | "mafia" | "don" | "sheriff" | "doctor" | "master"
  @type("string") team: string = ""; // red | black
  @type("boolean") isAlive: boolean = true;
  @type("boolean") isHost: boolean = false;
  @type("boolean") isNominated: boolean = false;
  @type("number") votes: number = 0;
  @type("string") lastHealedId: string = ""; // for doctor heal count
}

export class Spectator extends Schema {
  @type("string") sessionId: string = "";
  @type("string") name: string = "";
}

export class ChatMessage extends Schema {
  @type("string") author: string = "";
  @type("string") text: string = "";
}

export class MafiaState extends Schema {
  @type("string") phase: GamePhase = GamePhase.LOBBY; // lobby | night | day | voting
  @type("number") dayCount: number = 0;

  // Room settings
  @type("number") maxPlayers: number = 12;

  // Players logic
  @type("string") hostId: string = "";
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Spectator }) spectators = new MapSchema<Spectator>();

  // Core actions
  @type(["string"]) nominations = new ArraySchema<string>();
  @type("string") doctorTargetId: string = "";
  @type("string") mafiaTargetId: string = "";

  // Social
  @type([ChatMessage]) chat = new ArraySchema<ChatMessage>();
  // TODO: mafia could chat at the night
}
