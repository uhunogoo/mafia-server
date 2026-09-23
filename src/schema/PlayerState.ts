import { Schema, type, view } from "@colyseus/schema";

export const OWNER_VIEW_TAG = 1;

export class PlayerState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") nickname: string = "";
  @type("number") seatIndex: number = 0; // from 1 to 12
  @type("boolean") isHost: boolean = false;
  @type("boolean") isAlive: boolean = true;
  @type("boolean") isConnected: boolean = true;

  // Rest of the logic
  @view(OWNER_VIEW_TAG)
  @type("string") role: string = "";

  @view(OWNER_VIEW_TAG)
  @type("string") team: string = "";
}
