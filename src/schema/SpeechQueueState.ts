import { Schema, type, ArraySchema } from "@colyseus/schema";

export class SpeechQueueState extends Schema {
  @type(["string"]) order = new ArraySchema<string>();
  @type("string") currentSpeakerId: string = "";
  @type("number") speechStartedAt: number = 0;
  @type("number") durationMs: number = 60000;
}
