import { type Client, ServerError, ErrorCode } from "@colyseus/core";
import type { MafiaRoom } from "../rooms/MafiaRoom.js";
import { Player } from "../rooms/schema/MafiaState.js";

export interface AuthPayload {
  name: string;
}

export class Auth {
  private readonly RECONNECTION_TIMEOUT = 30;
  constructor(private room: MafiaRoom) { }

  onAuth(_client: Client, options: { password?: string; name?: string }) {
    if (this.room.isInviteExpired()) {
      throw new ServerError(ErrorCode.AUTH_FAILED, "invite expired");
    }
    if (this.room.password && options.password !== this.room.password) {
      throw new ServerError(ErrorCode.AUTH_FAILED, "wrong password");
    }

    const name = String(options.name || "").trim().slice(0, 24);
    if (!name) {
      throw new ServerError(400, "name is required");
    }

    return { name: name };
  }

  onJoin(client: Client) {
    const { name } = client.auth as { name: string };
    const room = this.room;
    const existing = room.state.players.get(client.sessionId);

    // Idempotency guard (ticket 05): when a client reconnects during the
    // Colyseus reconnection grace window, `onJoin` is called again with the
    // SAME sessionId. The player is still in `room.state.players` and may
    // carry runtime flags (`isAlive`, `isMissing`, role assignments) that
    // must NOT be clobbered. Only the display name is refreshed — the host
    // flag and seat are untouched. A missing-player clear is the room's
    // responsibility (see `MafiaRoom.onJoin`), not auth's.
    if (existing) {
      existing.name = name;
      return;
    }

    const isHost = room.state.players.size === 0;
    const player = new Player();
    player.name = name;
    player.sessionId = client.sessionId;
    player.seatIndex = room.state.players.size;
    player.isHost = isHost;

    room.state.players.set(client.sessionId, player);
  }

  onDrop(client: Client) {
    if (this.room.clients.includes(client)) {
      this.room.allowReconnection(client, this.RECONNECTION_TIMEOUT);
    }
  }

  onLeave(client: Client) {
    this.room.state.players.delete(client.sessionId);
    this.reelectHost();
  }

  // Helpers
  private reelectHost() {
    const players = [...this.room.state.players.values()]
      .sort((a, b) => a.seatIndex - b.seatIndex);
    if (players.length > 0 && !players.some((p) => p.isHost)) {
      players[0].isHost = true;
    }
  }
}
