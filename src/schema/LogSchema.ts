import { Schema, type } from "@colyseus/schema";

export class RoleLogEntry extends Schema {
  @type("number") night: number = 0;
  @type("number") timestamp: number = 0;   // Date.now()

  @type("string") actionType: string = "action"; // "check" | "kill" | "heal" | "skipped"
  @type("string") targetId: string = "";   // sessionId

  @type("string") result: string = "";     // "BLACK" | "RED" | "SHERIFF" | "NOT_SHERIFF" | "SAVED"
}
