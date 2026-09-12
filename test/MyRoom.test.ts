import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config.js";
import { MafiaState } from "../src/rooms/schema/MyRoomState.js";

describe("mafia_room", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => (colyseus = await boot(appConfig)));
  after(async () => colyseus.shutdown());
  beforeEach(async () => await colyseus.cleanup());

  it("хост і гість приєднуються як гравці з послідовними місцями", async () => {
    const room = await colyseus.createRoom<MafiaState>("mafia_room", {
      token: "tok1",
      guestId: "host-1",
    });
    assert.strictEqual(room.state.hostId, "host-1");

    const host = await colyseus.connectTo(room, {
      token: "tok1",
      guestId: "host-1",
      name: "Хост",
    });
    await room.waitForNextPatch();

    const hostPlayer = room.state.players.get("host-1");
    assert.ok(hostPlayer, "хост потрапив у state.players");
    assert.strictEqual(hostPlayer.isHost, true);
    assert.strictEqual(hostPlayer.seatIndex, 0);

    await colyseus.connectTo(room, { token: "tok1", guestId: "g-1", name: "Гість" });
    await room.waitForNextPatch();

    const guestPlayer = room.state.players.get("g-1");
    assert.ok(guestPlayer, "гість потрапив у state.players");
    assert.strictEqual(guestPlayer.isHost, false);
    assert.strictEqual(guestPlayer.seatIndex, 1);

    assert.strictEqual(room.state.maxPlayers, 12);
    assert.strictEqual(host.sessionId, room.clients[0].sessionId);
  });

  it("невірний токен відхиляється", async () => {
    const room = await colyseus.createRoom<MafiaState>("mafia_room", {
      token: "tok2",
      guestId: "host-2",
    });
    await colyseus.connectTo(room, { token: "tok2", guestId: "host-2", name: "Хост" });
    await room.waitForNextPatch();

    await assert.rejects(() =>
      colyseus.connectTo(room, { token: "WRONG", guestId: "g-2", name: "Гість" }),
    );
  });

  it("хост змінює кількість гравців", async () => {
    const room = await colyseus.createRoom<MafiaState>("mafia_room", {
      token: "tok3",
      guestId: "host-3",
    });
    const host = await colyseus.connectTo(room, {
      token: "tok3",
      guestId: "host-3",
      name: "Хост",
    });
    await room.waitForNextPatch();

    host.send("setMaxPlayers", { maxPlayers: 10 });
    await room.waitForNextPatch();

    assert.strictEqual(room.state.maxPlayers, 10);
    assert.strictEqual(room.maxClients, 10);
  });
});
