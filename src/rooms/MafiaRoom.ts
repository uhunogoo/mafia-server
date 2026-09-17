import { Room, Client, ServerError } from "@colyseus/core";
import { MafiaState, Player } from "./schema/MafiaState.js";
import { Auth } from "../config/auth.js";

const INVITE_TTL_MS = 1000 * 60 * 60 * 6; // 6 годин

export class MafiaRoom extends Room {
  maxClients = 12;
  state = new MafiaState();

  password: string | undefined;
  private inviteCreatedAt = 0;

  private auth = new Auth(this);

  messages = {
    log: (_client: Client, _payload: { text: string }) => {
      console.log("global log");
    },
    vote: (_client: Client, _payload: { targetId: string }) => {
      console.log("voting");
    },
    startGame: (client: Client) => {
      if (!this.requireHost(client)) return;

      console.log("game was started");
    },
    setMaxPlayers: (client: Client, payload: { maxPlayers: number }) => {
      if (!this.requireHost(client)) return;

      const value = payload?.maxPlayers;
      if (!Number.isInteger(value) || value < 6 || value > 12) {
        client.send("error", "Кількість гравців має бути від 6 до 12");
        return;
      }
      if (value < this.state.players.size) {
        client.send("error", "У кімнаті вже більше гравців");
        return;
      }

      this.maxClients = value;
      this.state.maxPlayers = value;
    },
    shuffle_players: (client: Client) => {
      if (!this.requireHost(client)) return;

      const others = [...this.state.players.values()].filter((p) => !p.isHost);
      const seats = others.map((p) => p.seatIndex);

      for (let i = seats.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [seats[i], seats[j]] = [seats[j], seats[i]];
      }

      others.forEach((p, i) => (p.seatIndex = seats[i]));
    },
  };

  onCreate(options: { password: string }) {
    if (options.password) {
      this.password = options.password;
      this.setMatchmaking({ unlisted: true });
    }
  }

  async onAuth(client: Client, options: { name?: string }) {
    return this.auth.onAuth(client, options);
  }

  onJoin(client: Client) {
    this.auth.onJoin(client);
  }

  onDrop(client: Client) {
    this.auth.onDrop(client);
  }

  onLeave(client: Client) {
    this.auth.onLeave(client);
  }

  // ——— helpers ———
  isInviteExpired(): boolean {
    return Date.now() - this.inviteCreatedAt > INVITE_TTL_MS;
  }

  private requireHost(client: Client): boolean {
    const ok = this.state.players.get(client.sessionId)?.isHost === true;
    if (!ok) this.fail(client, "Тільки хост може це робити");
    return ok;
  }

  private fail(client: Client, message: string) {
    client.send("error", message);
  }
}
