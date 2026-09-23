import { Schema, type } from "@colyseus/schema";

export class RoleLogEntry extends Schema {
  @type("number") night: number = 0;
  @type("number") timestamp: number = 0;
  @type("string") kind: string = ""; // "mafia_kill" | "don_check" | "sheriff_check" | "doctor_heal"
  @type("string") targetId: string = "";
  @type("string") payload: string = ""; // Json or other
}
