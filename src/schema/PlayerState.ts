import { Schema, type, view } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") sessionId: string = "";
  @type("string") nickname: string = "";
  @type("boolean") isAlive: boolean = true;
  @type("boolean") isConnected: boolean = true;
  @type("boolean") wasEliminatedToday: boolean = false;

  // Secrets
  @view() @type("string") role: string = "citizen"; // "sheriff" | "doctor" | "mafia" | "don" | "citizen"

  @view() @type("boolean") nightActionDon: boolean = false;
  @view() @type("boolean") nightActionMafia: boolean = false;
  @view() @type("boolean") nightActionCherif: boolean = false;
  @view() @type("boolean") nightActionDoctor: boolean = false;
}
