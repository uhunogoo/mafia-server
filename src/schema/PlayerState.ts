import { Schema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") sessionId: string = "";
  @type("string") nickname: string = "";
  @type("boolean") isAlive: boolean = true;
  @type("boolean") isConnected: boolean = true;

  // Rest of the logic
}
