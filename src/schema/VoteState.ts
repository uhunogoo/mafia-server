import { Schema, ArraySchema, type } from "@colyseus/schema";

export class VoteState extends Schema {
  @type("string")  candidateId: string = "";
  @type("uint8")   voteCount: number = 0;
  @type(["string"]) voterIds = new ArraySchema<string>();
  @type("boolean") isOnTrial: boolean = false;
}
