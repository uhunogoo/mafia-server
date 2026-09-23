import { Schema, type } from "@colyseus/schema";

// Universal night schema
export class NightActionState extends Schema {
  @type("string") currentWindow: string = "closed"; // "mafia" | "don_check" | "sheriff_check" | "doctor_heal" | "closed"
  @type("string") resolvedTargetId: string = ""; // target ID
  @type("string") resolvedResult: string = ""; // yes | no (in theory for sheriff black or red but it equal to yes/no)
}
