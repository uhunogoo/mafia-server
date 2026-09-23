import { Schema, type } from "@colyseus/schema";

export class PingInstance extends Schema {
  @type("string") id: string = "";
  @type("string") chip: string = "";
  @type("string") senderId: string = "";
  @type("string") targetId: string = "";
  @type("number") sentAt: number = 0;
  @type("number") durationMs: number = 17500; // 17.5s
}
