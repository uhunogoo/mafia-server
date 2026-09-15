import { Room, Client, ServerError } from "@colyseus/core";
import { MafiaState, Player } from "./schema/MafiaState.js";

const INVITE_TTL_MS = 1000 * 60 * 60 * 6; // 6 годин

export class MafiaRoom extends Room {
  maxClients = 12;
  state = new MafiaState();

  private inviteToken?: string;
  private inviteCreatedAt = 0;

  messages = {
    log: (_client: Client, _payload: { text: string }) => {
      console.log("global log");
    },
    vote: (_client: Client, _payload: { targetId: string }) => {
      console.log("voting");
    },
    startGame: (client: Client) => {
      const caller = [...this.state.players.values()].find(p => p.sessionId === client.sessionId);
      if (!caller || !caller.isHost) {
        client.send("error", "Тільки хост може почати гру");
        return;
      }
      console.log("game was started");
    },
    setMaxPlayers: (client: Client, payload: { maxPlayers: number }) => {
      const caller = [...this.state.players.values()].find(p => p.sessionId === client.sessionId);
      if (!caller || !caller.isHost) {
        client.send("error", "Тільки хост може змінювати кількість гравців");
        return;
      }

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
      const caller = [...this.state.players.values()].find(p => p.sessionId === client.sessionId);
      if (!caller || !caller.isHost) return;

      const nonHosts = [...this.state.players.values()].filter(p => !p.isHost);
      const seats = nonHosts.map(p => p.seatIndex);

      // Тасуємо тільки номери місць
      for (let i = seats.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [seats[i], seats[j]] = [seats[j], seats[i]];
      }

      // Призначаємо нові індекси — оновляться лише змінені поля
      nonHosts.forEach((player, i) => {
        player.seatIndex = seats[i];
      });
    },
  };

  onCreate(options: { token?: string, guestId?: string }) {
    this.setPrivate(true);

    // Room settings
    this.inviteToken = options.token;
    this.inviteCreatedAt = Date.now();
    this.state.hostId = options.guestId ?? "";

    // Auto clear
    this.autoDispose = true;
  }

  async onAuth(_client: Client, options: { token?: string, guestId?: string, name?: string }) {
    // Перший клієнт — творець кімнати: токена в нього ще немає
    if (this.clients.length === 0) return true;

    if (options.token !== this.inviteToken) {
      throw new Error("Невірне посилання");
    }
    if (Date.now() - this.inviteCreatedAt > INVITE_TTL_MS) {
      throw new Error("Посилання застаріло");
    }

    return true;
  }

  onJoin(client: Client, options: { name: string, guestId: string }) {
    if (!options.name || !options.guestId) return;
    const isHost = options.guestId === this.state.hostId;
    const existedPlayer = this.state.players.get(options.guestId);

    if (existedPlayer) {
      existedPlayer.sessionId = client.sessionId;
      console.log(`${existedPlayer.name} перепідключився`);
      return;
    }

    if (this.state.players.size >= this.state.maxPlayers) {
      throw new ServerError(4004, "Кімната заповнена");
    }

    const player = new Player();
    player.name = options.name;
    player.sessionId = client.sessionId;
    player.seatIndex = this.state.players.size;
    player.isHost = isHost;
    player.role = isHost ? "master" : "";
    this.state.players.set(options.guestId, player);
  }

  onLeave(client: Client) {
    const playerEntry = [...this.state.players.entries()].find(
      ([_, p]) => p.sessionId === client.sessionId
    );
    if (!playerEntry) return;

    const [guestId, player] = playerEntry;
    console.log(`Гравець ${player.name} (${guestId}) відключився`);
  }

  onDispose() {}
}
