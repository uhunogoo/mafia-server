import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import type { Room as SDKRoom } from "@colyseus/sdk";

import appConfig from "../src/app.config.js";
import { MafiaState } from "../src/rooms/schema/MafiaState.js";
import { MafiaRoom } from "../src/rooms/MafiaRoom.js";
import { Role, GamePhase, NightStep } from "../src/rooms/schema/enums.js";

interface Setup {
  room: MafiaRoom;
  host: SDKRoom<MafiaRoom, MafiaState>;
  hostId: string;
  guests: SDKRoom<MafiaRoom, MafiaState>[];
  /** sessionId for the guest with role DOCTOR. */
  doctorId: string;
  /** sessionId for the guest picked as mafia victim. */
  victimId: string;
  /** sessionId for a guest the doctor can heal (different from victim). */
  otherId: string;
}

/**
 * Connect `playerCount` non-host guests plus a host, wire `startGame`, and
 * inject deterministic roles into the engine so the test can target specific
 * players. Returns the room plus the host/guest SDK clients and the real
 * (auto-generated) sessionIds.
 *
 * NOTE: Colyseus 0.18 generates sessionIds server-side; the `guestId` we pass
 * to `connectTo` is only an SDK reconnect hint, not the sessionId. We always
 * resolve real ids from the SDK `Room.sessionId` and the server
 * `room.state.players`.
 */
async function setupRoom(
  colyseus: ColyseusTestServer<typeof appConfig>,
  playerCount: number,
): Promise<Setup> {
  const room = (await colyseus.createRoom("mafia_room", {})) as MafiaRoom;

  const host = (await colyseus.connectTo(room, {
    name: "Host",
  })) as SDKRoom<MafiaRoom, MafiaState>;
  await room.waitForNextPatch();

  const guests: SDKRoom<MafiaRoom, MafiaState>[] = [];
  for (let i = 0; i < playerCount; i++) {
    const c = (await colyseus.connectTo(room, {
      name: `Guest ${i}`,
    })) as SDKRoom<MafiaRoom, MafiaState>;
    guests.push(c);
    await room.waitForNextPatch();
  }

  // Silence the SDK's "onMessage() not registered" warnings for messages
  // the test doesn't care about (yourRole, error). Tests that DO care
  // re-register their own listener on the same type, which overrides this.
  host.onMessage("yourRole", () => {});
  host.onMessage("error", () => {});
  for (const g of guests) {
    g.onMessage("yourRole", () => {});
    g.onMessage("error", () => {});
  }

  host.send("startGame");
  await room.waitForNextPatch();

  // The first player (host) is marked isHost but never gets a role.
  // For guests, the order is the order they joined, so:
  //   guest[0] = DON, guest[1] = MAFIA, guest[2] = SHERIFF, guest[3] = DOCTOR,
  //   others   = CIVILIAN
  for (let i = 0; i < playerCount; i++) {
    let role: Role;
    if (i === 0) role = Role.DON;
    else if (i === 1) role = Role.MAFIA;
    else if (i === 2) role = Role.SHERIFF;
    else if (i === 3) role = Role.DOCTOR;
    else role = Role.CIVILIAN;
    room.engine._assignRoleForTest(guests[i].sessionId, role);
  }

  return {
    room,
    host,
    hostId: host.sessionId,
    guests,
    doctorId: guests[3].sessionId,
    victimId: guests[5].sessionId,
    otherId: guests[7].sessionId,
  };
}

describe("mafia_room", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => (colyseus = await boot(appConfig)));
  after(async () => await colyseus.shutdown());
  beforeEach(async () => await colyseus.cleanup());

  it("lobby → night: startGame transitions state to NIGHT and assigns roles", async () => {
    const { room, guests, hostId } = await setupRoom(colyseus, 10);
    assert.strictEqual(room.state.phase, "NIGHT");
    assert.strictEqual(room.state.dayCount, 0);

    // Every non-host guest should have a role in the engine.
    for (const g of guests) {
      assert.ok(room.engine.getRole(g.sessionId), `${g.sessionId} should have a role`);
    }
    // Host should not.
    assert.strictEqual(room.engine.getRole(hostId), undefined);
  });

  it("mafia kills X, doctor heals X → state.died is empty", async () => {
    const { room, host, guests, victimId } = await setupRoom(colyseus, 10);

    host.send("mafiaKill", { targetId: victimId });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.mafiaTargetId, victimId);

    guests[3].send("doctorHeal", { targetId: victimId });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.doctorTargetId, victimId);

    host.send("resolveNight");
    await room.waitForNextPatch();

    assert.strictEqual(room.state.died, "");
  });

  it("mafia kills X, doctor heals someone else → state.died equals X", async () => {
    const { room, host, guests, victimId, otherId } = await setupRoom(colyseus, 10);

    host.send("mafiaKill", { targetId: victimId });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.mafiaTargetId, victimId);

    guests[3].send("doctorHeal", { targetId: otherId });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.doctorTargetId, otherId);

    host.send("resolveNight");
    await room.waitForNextPatch();

    assert.strictEqual(room.state.died, victimId);
  });

  it("doctor heal rejected when targeting last night's healed player", async () => {
    const { room, host, guests, victimId } = await setupRoom(colyseus, 10);
    const doctorSDK = guests[3];

    // Night 1: heal victimId successfully.
    host.send("mafiaKill", { targetId: "anybody-1" });
    await room.waitForNextPatch();
    doctorSDK.send("doctorHeal", { targetId: victimId });
    await room.waitForNextPatch();
    host.send("resolveNight");
    await room.waitForNextPatch();
    assert.strictEqual(room.state.died, "");

    // Night 2: doctor tries to heal the same target.
    const errors: string[] = [];
    doctorSDK.onMessage("error", (msg: unknown) => {
      errors.push(String((msg as { message?: string }).message ?? msg));
    });

    host.send("mafiaKill", { targetId: "anybody-2" });
    await room.waitForNextPatch();
    doctorSDK.send("doctorHeal", { targetId: victimId });
    await room.waitForNextPatch();

    assert.ok(
      errors.length > 0,
      `doctor should receive an error message for repeat heal (got ${errors.length})`,
    );
    assert.strictEqual(room.state.doctorTargetId, "");
  });

  it("non-host is rejected when sending mafiaKill", async () => {
    const { room, guests } = await setupRoom(colyseus, 10);

    const errors: string[] = [];
    guests[0].onMessage("error", (msg: unknown) => {
      errors.push(String((msg as { message?: string }).message ?? msg));
    });

    guests[0].send("mafiaKill", { targetId: guests[5].sessionId });
    await room.waitForNextPatch();

    assert.ok(errors.length > 0, "non-host should receive an error");
    assert.strictEqual(room.state.mafiaTargetId, "");
  });

  it("public Player schema does not expose role or team", async () => {
    const { room } = await setupRoom(colyseus, 10);

    for (const p of room.state.players.values()) {
      // ADR 0004: Player has no role/team @type annotations.
      assert.strictEqual((p as unknown as { role?: unknown }).role, undefined);
      assert.strictEqual((p as unknown as { team?: unknown }).team, undefined);
    }
  });

  it("night actions are rejected in LOBBY", async () => {
    const room = (await colyseus.createRoom("mafia_room", {})) as MafiaRoom;
    const host = (await colyseus.connectTo(room, { name: "Host" })) as SDKRoom<MafiaRoom, MafiaState>;
    await room.waitForNextPatch();

    const errors: string[] = [];
    host.onMessage("error", (msg: unknown) => {
      errors.push(String((msg as { message?: string }).message ?? msg));
    });

    host.send("mafiaKill", { targetId: "nobody" });
    await room.waitForNextPatch();
    host.send("resolveNight");
    await room.waitForNextPatch();

    assert.ok(errors.length >= 2, "both actions should fail before game start");
    assert.strictEqual(room.state.phase, "LOBBY");
  });

  it("yourRole is sent privately to each non-host player, not the host", async () => {
    const colyseusLocal = colyseus;
    const room = (await colyseusLocal.createRoom("mafia_room", {})) as MafiaRoom;
    const host = (await colyseusLocal.connectTo(room, { name: "Host" })) as SDKRoom<MafiaRoom, MafiaState>;
    await room.waitForNextPatch();

    const guests: SDKRoom<MafiaRoom, MafiaState>[] = [];
    for (let i = 0; i < 10; i++) {
      guests.push(
        (await colyseusLocal.connectTo(room, { name: `G${i}` })) as SDKRoom<MafiaRoom, MafiaState>,
      );
      await room.waitForNextPatch();
    }

    // Capture messages AFTER all clients are connected so we don't miss the
    // yourRole broadcast during startGame.
    const hostMessages: unknown[] = [];
    host.onMessage("yourRole", (payload: unknown) => hostMessages.push(payload));
    const guestMessages: unknown[][] = guests.map(() => []);
    for (let i = 0; i < guests.length; i++) {
      guests[i].onMessage("yourRole", (payload: unknown) => guestMessages[i].push(payload));
    }

    host.send("startGame");
    await room.waitForNextPatch();
    // Allow the broadcast to flush.
    await new Promise((r) => setTimeout(r, 50));

    assert.strictEqual(hostMessages.length, 0, "host should not receive a role");
    for (let i = 0; i < guests.length; i++) {
      assert.strictEqual(guestMessages[i].length, 1, `guest ${i} should get one yourRole`);
    }
  });

  // ─── Ticket 02: pings + action log ────────────────────────────────────

  it("two players exchange pings; each sees their own ping", async () => {
    const { room, guests } = await setupRoom(colyseus, 10);

    // Move into a day phase for pings.
    room.state.phase = GamePhase.DAY_SPEECHES;
    await room.waitForNextPatch();

    const a = guests[0];
    const b = guests[1];

    const aPings: unknown[] = [];
    const bPings: unknown[] = [];
    a.onMessage("ping", (payload: unknown) => aPings.push(payload));
    b.onMessage("ping", (payload: unknown) => bPings.push(payload));

    a.send("ping", { toId: b.sessionId });
    await room.waitForNextPatch();
    b.send("ping", { toId: a.sessionId });
    await room.waitForNextPatch();

    assert.strictEqual(aPings.length, 2, "a is involved in two pings (sent one, received one)");
    assert.strictEqual(bPings.length, 2, "b is involved in two pings (received one, sent one)");
    const toA = aPings.find((p) => (p as { toId: string }).toId === a.sessionId);
    assert.ok(toA, "a should see the ping sent to them");
  });

  it("players don't see each other's unrelated pings", async () => {
    const { room, guests } = await setupRoom(colyseus, 10);
    room.state.phase = GamePhase.DAY_SPEECHES;
    await room.waitForNextPatch();

    const a = guests[0];
    const b = guests[1];
    const c = guests[2]; // uninvolved spectator

    const cPings: unknown[] = [];
    c.onMessage("ping", (payload: unknown) => cPings.push(payload));

    a.send("ping", { toId: b.sessionId });
    await room.waitForNextPatch();

    assert.strictEqual(cPings.length, 0, "c should not see a<->b pings");
  });

  it("host sees every ping regardless of sender or recipient", async () => {
    const { room, host, guests } = await setupRoom(colyseus, 10);
    room.state.phase = GamePhase.DAY_SPEECHES;
    await room.waitForNextPatch();

    const hostPings: unknown[] = [];
    host.onMessage("ping", (payload: unknown) => hostPings.push(payload));

    guests[0].send("ping", { toId: guests[1].sessionId });
    await room.waitForNextPatch();
    guests[2].send("ping", { toId: guests[3].sessionId });
    await room.waitForNextPatch();

    assert.strictEqual(hostPings.length, 2, "host should see every ping");
    const toIds = hostPings.map((p) => (p as { toId: string }).toId).sort();
    assert.deepStrictEqual(toIds, [guests[1].sessionId, guests[3].sessionId].sort());
  });

  it("civilian ping during the night is rejected and the host sees no record", async () => {
    const { room, host, guests } = await setupRoom(colyseus, 10);
    // Phase is NIGHT (default after startGame). Per setupRoom, guests[0]=DON,
    // guests[1]=MAFIA, guests[2]=SHERIFF, guests[3]=DOCTOR, guests[4..]=CIVILIAN.
    // We send from a civilian (guests[4]) to another civilian (guests[5]) so
    // the ping is rejected regardless of role/target being mafia.

    const hostPings: unknown[] = [];
    host.onMessage("ping", (payload: unknown) => hostPings.push(payload));

    const errors: string[] = [];
    guests[4].onMessage("error", (msg: unknown) => {
      errors.push(String((msg as { message?: string }).message ?? msg));
    });

    guests[4].send("ping", { toId: guests[5].sessionId });
    await room.waitForNextPatch();

    assert.ok(errors.length > 0, "civilian ping during night must error");
    assert.strictEqual(hostPings.length, 0, "rejected ping must not reach the host either");
    assert.strictEqual(room.engine.getAllPings().length, 0);
  });

  it("host can fetch the action log via getLog", async () => {
    const { room, host, guests } = await setupRoom(colyseus, 10);
    room.state.phase = GamePhase.DAY_SPEECHES;
    await room.waitForNextPatch();
    guests[0].send("ping", { toId: guests[1].sessionId });
    await room.waitForNextPatch();

    const received: unknown[] = [];
    host.onMessage("log", (payload: unknown) => received.push(payload));

    host.send("getLog", { since: "" });
    await room.waitForNextPatch();

    assert.strictEqual(received.length, 1, "host should receive exactly one log response");
    const entries = (received[0] as { entries: Array<{ type: string }> }).entries;
    assert.ok(entries.length >= 2, `expected >=2 entries, got ${entries.length}`);
    const types = entries.map((e) => e.type);
    assert.ok(types.includes("PING"), "log should include the PING entry");
    assert.ok(types.includes("PHASE_ADVANCE"), "log should include the game-started PHASE_ADVANCE");
  });

  it("non-host is rejected when requesting the action log", async () => {
    const { room, guests } = await setupRoom(colyseus, 10);

    const received: unknown[] = [];
    const errors: string[] = [];
    guests[0].onMessage("log", (payload: unknown) => received.push(payload));
    guests[0].onMessage("error", (msg: unknown) => {
      errors.push(String((msg as { message?: string }).message ?? msg));
    });

    guests[0].send("getLog", { since: "" });
    await room.waitForNextPatch();

    assert.strictEqual(received.length, 0, "non-host must never receive the log");
    assert.ok(errors.length > 0, "non-host should receive an error");
  });

  // ─── Ticket 03: Day-1 basic flow ──────────────────────────────────────

  /**
   * Drive the room through a full Day 1 cycle, starting from the post-
   * startGame NIGHT state produced by `setupRoom`. Mirrors the engine
   * helper but goes through the room's message layer. Nominations are
   * submitted AFTER `startSpeeches` (the only phase in which they're valid);
   * votes are submitted AFTER DAY_VOTING is reached.
   */
  async function driveDay1(
    setup: Setup,
    nominations: { nominator: SDKRoom<MafiaRoom, MafiaState>; target: string }[],
    votes: { voter: SDKRoom<MafiaRoom, MafiaState>; target: string }[],
  ): Promise<void> {
    const { room, host, guests } = setup;

    // Night actions: mafia kills p5, doctor heals p5 → no one dies.
    host.send("mafiaKill", { targetId: guests[5].sessionId });
    await room.waitForNextPatch();
    guests[3].send("doctorHeal", { targetId: guests[5].sessionId });
    await room.waitForNextPatch();
    host.send("resolveNight");
    await room.waitForNextPatch();

    assert.strictEqual(room.state.phase, GamePhase.DAY_ANNOUNCEMENT);
    assert.strictEqual(room.state.dayCount, 1);

    // Speeches — start, nominate during the first few speakers, then drive
    // through every speaker.
    host.send("startSpeeches");
    await room.waitForNextPatch();
    assert.strictEqual(room.state.phase, GamePhase.DAY_SPEECHES);
    const speakingOrder = room.engine.getSpeakingOrder();
    assert.strictEqual(speakingOrder.length, 10);

    // Nominations must happen while we're in DAY_SPEECHES. We send them
    // immediately after startSpeeches so the speakingOrder loop has time to
    // pick them up.
    for (const n of nominations) {
      n.nominator.send("nominate", { targetId: n.target });
      await room.waitForNextPatch();
    }

    for (let i = 0; i < speakingOrder.length; i++) {
      host.send("nextSpeaker");
      await room.waitForNextPatch();
    }
    // After the last nextSpeaker the engine auto-transitions to DAY_DEFENSE.
    assert.strictEqual(room.state.phase, GamePhase.DAY_DEFENSE);

    // Drive through every defender.
    const defenseOrder = room.engine.getDefenseOrder();
    for (let i = 0; i < defenseOrder.length; i++) {
      host.send("nextDefense");
      await room.waitForNextPatch();
    }
    assert.strictEqual(room.state.phase, GamePhase.DAY_VOTING);

    // Cast explicit votes.
    for (const v of votes) {
      v.voter.send("vote", { targetId: v.target });
      await room.waitForNextPatch();
    }
    host.send("resolveVoting");
    await room.waitForNextPatch();
  }

  it("a full Day 1 cycle ends with the correct player eliminated and the engine in NIGHT phase", async () => {
    const setup = await setupRoom(colyseus, 10);

    // Drive the day, casting 6 votes for p6 and 4 for p8.
    await driveDay1(
      setup,
      [
        { nominator: setup.guests[0], target: setup.guests[6].sessionId },
        { nominator: setup.guests[1], target: setup.guests[8].sessionId },
      ],
      [
        ...setup.guests.slice(0, 6).map((v) => ({ voter: v, target: setup.guests[6].sessionId })),
        ...setup.guests.slice(6, 10).map((v) => ({ voter: v, target: setup.guests[8].sessionId })),
      ],
    );

    assert.strictEqual(setup.room.state.phase, GamePhase.NIGHT);
    assert.strictEqual(setup.room.state.nightStep, NightStep.MAFIA);
    assert.strictEqual(setup.room.state.dayCount, 1);

    // p6 was the highest-voted candidate and is now dead.
    assert.strictEqual(setup.room.state.players.get(setup.guests[6].sessionId)!.isAlive, false);
    assert.strictEqual(setup.room.state.players.get(setup.guests[8].sessionId)!.isAlive, true);

    // Player.votes reflects the final tally (the engine writes it before
    // clearing the per-player flags on the next DAY_ANNOUNCEMENT).
    assert.strictEqual(setup.room.state.players.get(setup.guests[6].sessionId)!.votes, 6);
    assert.strictEqual(setup.room.state.players.get(setup.guests[8].sessionId)!.votes, 4);
  });

  it("default vote: players who didn't vote are auto-cast to the last speaker", async () => {
    const setup = await setupRoom(colyseus, 10);

    // Nominate two players — neither of them is the last speaker (p9).
    // Only p0 votes (for p5). The remaining 9 players default to p9, who is
    // not on the candidate list — but per ADR 0003 the last speaker is
    // implicitly a candidate and receives the default votes. With 9 default
    // votes versus 1 explicit, p9 wins by default.
    await driveDay1(
      setup,
      [
        { nominator: setup.guests[0], target: setup.guests[5].sessionId },
        { nominator: setup.guests[1], target: setup.guests[7].sessionId },
      ],
      [{ voter: setup.guests[0], target: setup.guests[5].sessionId }],
    );

    assert.strictEqual(setup.room.state.phase, GamePhase.NIGHT);
    assert.strictEqual(
      setup.room.state.players.get(setup.guests[9].sessionId)!.isAlive,
      false,
      "last speaker wins by default votes",
    );
    assert.strictEqual(setup.room.state.players.get(setup.guests[9].sessionId)!.votes, 9);
    assert.strictEqual(setup.room.state.players.get(setup.guests[5].sessionId)!.votes, 1);
  });

  it("non-host cannot start speeches / nextSpeaker / nextDefense / resolveVoting", async () => {
    const setup = await setupRoom(colyseus, 10);

    const errors: string[] = [];
    setup.guests[0].onMessage("error", (msg: unknown) => {
      errors.push(String((msg as { message?: string }).message ?? msg));
    });

    setup.guests[0].send("startSpeeches");
    await setup.room.waitForNextPatch();
    setup.guests[0].send("nextSpeaker");
    await setup.room.waitForNextPatch();
    setup.guests[0].send("nextDefense");
    await setup.room.waitForNextPatch();
    setup.guests[0].send("resolveVoting");
    await setup.room.waitForNextPatch();

    assert.ok(errors.length >= 4, `non-host should receive errors for all four actions, got ${errors.length}`);
  });

  it("resolveNight from NIGHT transitions to DAY_ANNOUNCEMENT in the public schema", async () => {
    const setup = await setupRoom(colyseus, 10);

    setup.host.send("mafiaKill", { targetId: setup.guests[5].sessionId });
    await setup.room.waitForNextPatch();
    setup.host.send("resolveNight");
    await setup.room.waitForNextPatch();

    assert.strictEqual(setup.room.state.phase, GamePhase.DAY_ANNOUNCEMENT);
    assert.strictEqual(setup.room.state.dayCount, 1);
    assert.strictEqual(setup.room.state.died, setup.guests[5].sessionId);
  });

  it("nominate is rejected when the phase is not DAY_SPEECHES (e.g. NIGHT)", async () => {
    const setup = await setupRoom(colyseus, 10);

    const errors: string[] = [];
    setup.guests[0].onMessage("error", (msg: unknown) => {
      errors.push(String((msg as { message?: string }).message ?? msg));
    });

    setup.guests[0].send("nominate", { targetId: setup.guests[5].sessionId });
    await setup.room.waitForNextPatch();

    assert.ok(errors.length > 0, "nominate during NIGHT must error");
    assert.strictEqual(setup.room.state.nominations.length, 0);
  });

  it("vote is rejected for a non-nominated candidate", async () => {
    const setup = await setupRoom(colyseus, 10);

    // Drive into DAY_VOTING with only p6 nominated.
    setup.host.send("mafiaKill", { targetId: setup.guests[5].sessionId });
    await setup.room.waitForNextPatch();
    setup.guests[3].send("doctorHeal", { targetId: setup.guests[9].sessionId });
    await setup.room.waitForNextPatch();
    setup.host.send("resolveNight");
    await setup.room.waitForNextPatch();
    setup.host.send("startSpeeches");
    await setup.room.waitForNextPatch();
    setup.guests[0].send("nominate", { targetId: setup.guests[6].sessionId });
    await setup.room.waitForNextPatch();

    const order = setup.room.engine.getSpeakingOrder();
    for (let i = 0; i < order.length; i++) {
      setup.host.send("nextSpeaker");
      await setup.room.waitForNextPatch();
    }
    const dOrder = setup.room.engine.getDefenseOrder();
    for (let i = 0; i < dOrder.length; i++) {
      setup.host.send("nextDefense");
      await setup.room.waitForNextPatch();
    }

    assert.strictEqual(setup.room.state.phase, GamePhase.DAY_VOTING);

    const errors: string[] = [];
    setup.guests[0].onMessage("error", (msg: unknown) => {
      errors.push(String((msg as { message?: string }).message ?? msg));
    });

    setup.guests[0].send("vote", { targetId: setup.guests[7].sessionId });
    await setup.room.waitForNextPatch();

    assert.ok(errors.length > 0, "vote for a non-nominated player must error");
  });
});
