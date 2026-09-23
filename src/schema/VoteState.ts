import { Schema, type, ArraySchema } from "@colyseus/schema";

export class VoteCandidateState extends Schema {
  @type("string") candidateId: string = "";
  @type("number") forVotes: number = 0;
}

export class VoteState extends Schema {
  @type([VoteCandidateState]) candidates = new ArraySchema<VoteCandidateState>();
  @type("number") abstains: number = 0; // Votes for last
}
