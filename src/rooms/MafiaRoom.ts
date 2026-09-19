import { Room, Client } from "@colyseus/core";
import { MafiaState } from "./schema/MafiaState.js";
import { Auth } from "../config/auth.js";
import { Engine } from "../game/Engine.js";
import { EngineError, EngineErrorCode } from "../game/types.js";

const INVITE_TTL_MS = 1000 * 60 * 60 * 6;

export class MafiaRoom extends Room {
  maxClients = 12;
  state = new MafiaState();
  /**
   * Pure game logic. The room layer is a thin transport; all state mutations
   * flow through `engine` and any errors come back as `EngineError`.
   */
  engine = new Engine(this.state);

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

      try {
        this.engine.startGame();
      } catch (e) {
        this.fail(client, this.engineErrorMessage(e));
        return;
      }

      // ADR 0004: each player gets their role in a private message.
      // The host never receives one (host never gets a role).
      for (const c of this.clients) {
        const role = this.engine.getRole(c.sessionId);
        if (!role) continue;
        c.send("yourRole", {
          role,
          team: this.engine.getTeam(c.sessionId),
        });
      }
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
    mafiaKill: (client: Client, payload: { targetId: string }) => {
      if (!this.requireHost(client)) return;
      if (typeof payload?.targetId !== "string") {
        this.fail(client, "targetId is required");
        return;
      }
      this.runEngine(() => this.engine.mafiaKill(client.sessionId, payload.targetId), client);
    },
    donCheck: (client: Client, payload: { targetId: string }) => {
      if (typeof payload?.targetId !== "string") {
        this.fail(client, "targetId is required");
        return;
      }
      this.runEngine(() => this.engine.donCheck(client.sessionId, payload.targetId), client);
    },
    sheriffCheck: (client: Client, payload: { targetId: string }) => {
      if (typeof payload?.targetId !== "string") {
        this.fail(client, "targetId is required");
        return;
      }
      this.runEngine(() => this.engine.sheriffCheck(client.sessionId, payload.targetId), client);
    },
    doctorHeal: (client: Client, payload: { targetId: string }) => {
      if (typeof payload?.targetId !== "string") {
        this.fail(client, "targetId is required");
        return;
      }
      this.runEngine(() => this.engine.doctorHeal(client.sessionId, payload.targetId), client);
    },
    resolveNight: (client: Client) => {
      if (!this.requireHost(client)) return;
      this.runEngine(() => this.engine.resolveNight(), client);
    },
  };

  onCreate(options: { password: string }) {
    this.inviteCreatedAt = Date.now();
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

  private runEngine(action: () => void, client: Client): void {
    try {
      action();
    } catch (e) {
      this.fail(client, this.engineErrorMessage(e));
    }
  }

  /**
   * Map an engine error onto a player-visible message without leaking
   * internal codes. Defaults to a generic message for unexpected errors.
   */
  private engineErrorMessage(e: unknown): string {
    if (e instanceof EngineError) {
      switch (e.code) {
        case EngineErrorCode.WRONG_PHASE:
          return "Зараз не та фаза для цієї дії";
        case EngineErrorCode.NOT_HOST:
          return "Тільки хост може це робити";
        case EngineErrorCode.WRONG_ROLE:
          return "Ця роль не може виконати цю дію";
        case EngineErrorCode.PLAYER_DEAD:
          return "Мертвий гравець не може діяти";
        case EngineErrorCode.PLAYER_MISSING:
          return "Гравця не знайдено";
        case EngineErrorCode.DOCTOR_RESTRICTION:
          return "Лікар не може лікувати того самого гравця дві ночі поспіль";
        case EngineErrorCode.GAME_LOCKED:
          return e.message;
      }
    }
    return "Сталася помилка";
  }
}
