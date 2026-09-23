import { Schema, type, view } from "@colyseus/schema";
import { Role, Team } from "./enums.js";
import { VIEW_OWNER } from "./viewRules.js";

export class PlayerState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") nickname: string = "";
  @type("number") seatIndex: number = 0; // from 1 to 12
  @type("boolean") isHost: boolean = false;
  @type("boolean") isAlive: boolean = true;
  @type("boolean") isConnected: boolean = true;

  // Rest of the logic
  @view(VIEW_OWNER)
  @type("string") role: Role = Role.CIVILIAN;

  @view(VIEW_OWNER)
  @type("string") team: Team = Team.RED;
}
