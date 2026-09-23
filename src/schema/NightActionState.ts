import { MapSchema, Schema, type } from "@colyseus/schema";

// Universal night schema
export class NightActionState extends Schema {
  @type("string") resolvedTargetId: string = ""; // target ID
  @type({ map: "string" }) votes = new MapSchema<string>();
  @type("string") resolvedResult: string = ""; // yes | no (in theory for sheriff black or red but it equal to yes/no)
}
