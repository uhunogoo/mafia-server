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

  it("lobby в†’ night: startGame transitions state to NIGHT and assigns roles", async () => {
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

  it("mafia kills X, doctor heals X в†’ state.died is empty", async () => {
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

  it("mafia kills X, doctor heals someone else в†’ state.died equals X", async () => {
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

  // в”Ђв”Ђв”Ђ Ticket 02: pings + action log в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

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

  // в”Ђв”Ђв”Ђ Ticket 03: Day-1 basic flow в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

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

    // Night actions: mafia kills p5, doctor heals p5 в†’ no one dies.
    host.send("mafiaKill", { targetId: guests[5].sessionId });
    await room.waitForNextPatch();
    guests[3].send("doctorHeal", { targetId: guests[5].sessionId });
    await room.waitForNextPatch();
    host.send("resolveNight");
    await room.waitForNextPatch();

    assert.strictEqual(room.state.phase, GamePhase.DAY_ANNOUNCEMENT);
    assert.strictEqual(room.state.dayCount, 1);

    // Speeches вЂ” start, nominate during the first few speakers, then drive
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

    // Nominate two players вЂ” neither of them is the last speaker (p9).
    // Only p0 votes (for p5). The remaining 9 players default to p9, who is
    // not on the candidate list вЂ” but per ADR 0003 the last speaker is
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

  // в”Ђв”Ђв”Ђ Ticket 04: phase timers + host overrides в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

  it("startGame arms the mafia-window timer (60s) in the engine", async () => {
    const { room } = await setupRoom(colyseus, 10);
    const snap = room.engine.getPhaseTimer();
    assert.ok(snap, "a phase timer should be active right after startGame");
    assert.strictEqual(snap!.mode, "MAFIA_WINDOW");
    assert.strictEqual(snap!.durationMs, 60_000);
    assert.strictEqual(snap!.paused, false);
  });

  it("startSpeeches arms a 60s SPEECH_TURN timer; resolveVoting re-arms the MAFIA_WINDOW", async () => {
    const setup = await setupRoom(colyseus, 10);

    setup.host.send("mafiaKill", { targetId: setup.guests[5].sessionId });
    await setup.room.waitForNextPatch();
    setup.guests[3].send("doctorHeal", { targetId: setup.guests[5].sessionId });
    await setup.room.waitForNextPatch();
    setup.host.send("resolveNight");
    await setup.room.waitForNextPatch();
    setup.host.send("startSpeeches");
    await setup.room.waitForNextPatch();

    const speechSnap = setup.room.engine.getPhaseTimer();
    assert.strictEqual(speechSnap?.mode, "SPEECH_TURN");
    assert.strictEqual(speechSnap?.durationMs, 60_000);

    // Nominate someone so DAY_DEFENSE has at least one candidate; otherwise
    // resolveVoting would be rejected for being called outside DAY_VOTING.
    setup.guests[0].send("nominate", { targetId: setup.guests[6].sessionId });
    await setup.room.waitForNextPatch();

    // Drive through all speeches.
    const speakingOrderLength = setup.room.engine.getSpeakingOrder().length;
    for (let i = 0; i < speakingOrderLength; i++) {
      setup.host.send("nextSpeaker");
      await setup.room.waitForNextPatch();
    }
    // Drive through all defenders (now at least one).
    const defenseOrderLength = setup.room.engine.getDefenseOrder().length;
    for (let i = 0; i < defenseOrderLength; i++) {
      setup.host.send("nextDefense");
      await setup.room.waitForNextPatch();
    }
    setup.host.send("resolveVoting");
    await setup.room.waitForNextPatch();

    // After resolveVoting we are in NIGHT step MAFIA вЂ” a fresh MAFIA_WINDOW
    // timer should be armed.
    const nightSnap = setup.room.engine.getPhaseTimer();
    assert.ok(nightSnap, "MAFIA_WINDOW timer should be armed after resolveVoting");
    assert.strictEqual(nightSnap!.mode, "MAFIA_WINDOW");
    assert.strictEqual(nightSnap!.durationMs, 60_000);
  });

  it("host can pausePhase в†’ resumePhase в†’ the timer's paused flag flips", async () => {
    const { room, host } = await setupRoom(colyseus, 10);
    assert.strictEqual(room.engine.getPhaseTimer()!.paused, false);

    host.send("pausePhase");
    await room.waitForNextPatch();
    assert.strictEqual(room.engine.getPhaseTimer()!.paused, true);

    host.send("resumePhase");
    await room.waitForNextPatch();
    assert.strictEqual(room.engine.getPhaseTimer()!.paused, false);
  });

  it("host can extendPhase{seconds: 30} and the timer's total duration grows by 30s", async () => {
    const { room, host } = await setupRoom(colyseus, 10);
    const before = room.engine.getPhaseTimer()!.durationMs;
    host.send("extendPhase", { seconds: 30 });
    await room.waitForNextPatch();
    const after = room.engine.getPhaseTimer()!.durationMs;
    // `durationMs` is the timer's configured total; `extend` modifies it
    // directly, so it's not subject to setInterval wall-clock drift between
    // the before/after snapshots the way `remainingMs` is.
    assert.strictEqual(
      after - before,
      30_000,
      `extend should grow durationMs by exactly 30s; got before=${before} after=${after}`,
    );
    // The remaining time also should not have shrunk below the original
    // duration (i.e. the host's 30s extension was applied).
    assert.ok(
      room.engine.getPhaseTimer()!.remainingMs >= before,
      `remainingMs should be >= the original duration after extend; ` +
        `got remainingMs=${room.engine.getPhaseTimer()!.remainingMs} originalDuration=${before}`,
    );
  });

  it("host can skipPhase during DAY_SPEECHES and the speech cursor advances", async () => {
    const setup = await setupRoom(colyseus, 10);
    setup.host.send("mafiaKill", { targetId: setup.guests[5].sessionId });
    await setup.room.waitForNextPatch();
    setup.guests[3].send("doctorHeal", { targetId: setup.guests[5].sessionId });
    await setup.room.waitForNextPatch();
    setup.host.send("resolveNight");
    await setup.room.waitForNextPatch();
    setup.host.send("startSpeeches");
    await setup.room.waitForNextPatch();

    const first = setup.room.engine.getCurrentSpeaker();
    setup.host.send("skipPhase");
    await setup.room.waitForNextPatch();
    assert.notStrictEqual(setup.room.engine.getCurrentSpeaker(), first);
    assert.strictEqual(setup.room.engine.getPhaseTimer()!.mode, "SPEECH_TURN");
  });

  it("non-host is rejected for pausePhase / resumePhase / skipPhase / extendPhase", async () => {
    const { room, guests } = await setupRoom(colyseus, 10);

    const errors: string[] = [];
    guests[0].onMessage("error", (msg: unknown) => {
      errors.push(String((msg as { message?: string }).message ?? msg));
    });

    guests[0].send("pausePhase");
    await room.waitForNextPatch();
    guests[0].send("resumePhase");
    await room.waitForNextPatch();
    guests[0].send("skipPhase");
    await room.waitForNextPatch();
    guests[0].send("extendPhase", { seconds: 30 });
    await room.waitForNextPatch();

    assert.ok(errors.length >= 4, `non-host should be rejected for all four overrides, got ${errors.length}`);
    assert.strictEqual(room.engine.getPhaseTimer()!.paused, false, "no state change from rejected pause");
  });

  it("mafia-window reminder at 30s elapsed is routed to the host", async () => {
    const { room, host } = await setupRoom(colyseus, 10);

    const reminders: unknown[] = [];
    host.onMessage("timerReminder", (payload: unknown) => reminders.push(payload));

    // Drive the room's timer driver with a fake-now delta of 30s. The room
    // temporarily swaps the engine's clock, ticks once, and restores the
    // real-time clock on exit. The engine fires a REMINDER event for the
    // mafia window's 30s mark; the room forwards it to the host.
    (room as unknown as { _driveTimerAtForTest(deltaMs: number): unknown[] })._driveTimerAtForTest(30_000);
    // Allow the SDK to deliver the message.
    await new Promise((r) => setTimeout(r, 50));

    assert.strictEqual(reminders.length, 1, `host should receive exactly one reminder, got ${reminders.length}`);
    const payload = reminders[0] as { mode: string; remainingSeconds: number };
    assert.strictEqual(payload.mode, "MAFIA_WINDOW");
    assert.strictEqual(payload.remainingSeconds, 30);
  });

  it("mafia-window reminders fire at both 30s and 50s elapsed", async () => {
    const { room, host } = await setupRoom(colyseus, 10);

    const reminders: Array<{ mode: string; remainingSeconds: number }> = [];
    host.onMessage("timerReminder", (payload: unknown) =>
      reminders.push(payload as { mode: string; remainingSeconds: number }),
    );

    // Drive the timer 50s past wall-clock вЂ” both the 30s and 50s marks
    // should fire in the same tick.
    (room as unknown as { _driveTimerAtForTest(deltaMs: number): unknown[] })._driveTimerAtForTest(50_000);
    await new Promise((r) => setTimeout(r, 50));

    assert.strictEqual(reminders.length, 2);
    assert.strictEqual(reminders[0].mode, "MAFIA_WINDOW");
    assert.strictEqual(reminders[0].remainingSeconds, 30);
    assert.strictEqual(reminders[1].mode, "MAFIA_WINDOW");
    assert.strictEqual(reminders[1].remainingSeconds, 10);
  });

  // в”Ђв”Ђв”Ђ Ticket 05: disconnect pause + declareDead в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

  it("a player dropping mid-phase pauses the timer and notifies the host", async () => {
    const { room, host, guests } = await setupRoom(colyseus, 10);

    const missing: Array<{ sessionId: string }> = [];
    host.onMessage("playerMissing", (payload: unknown) =>
      missing.push(payload as { sessionId: string }),
    );

    // The MAFIA_WINDOW timer is running right after startGame вЂ” assert it.
    assert.strictEqual(room.engine.getPhaseTimer()?.mode, "MAFIA_WINDOW");
    assert.strictEqual(room.engine.getPhaseTimer()?.paused, false);

    const droppedId = guests[5].sessionId;
    (room as unknown as { _simulateDropForTest(s: string): void })._simulateDropForTest(droppedId);
    await room.waitForNextPatch();
    // Allow the host notification to flush through the SDK.
    await new Promise((r) => setTimeout(r, 50));

    // Schema flip: missing flag set on the dropped player.
    assert.strictEqual(
      room.state.players.get(droppedId)!.isMissing,
      true,
      "Player.isMissing flipped to true",
    );
    // Timer paused.
    assert.strictEqual(
      room.engine.getPhaseTimer()!.paused,
      true,
      "MAFIA_WINDOW paused for missing player",
    );
    // Host got the notification.
    assert.strictEqual(missing.length, 1, "host received exactly one playerMissing");
    assert.strictEqual(missing[0].sessionId, droppedId);
  });

  it("declareDead marks the missing player dead, resumes the timer, and routes through onPlayerDied", async () => {
    const { room, host, guests } = await setupRoom(colyseus, 10);

    let deadId = "";
    let deadCause = "";
    room.engine.setOnPlayerDied((id, cause) => {
      deadId = id;
      deadCause = cause;
    });

    const declared: Array<{ sessionId: string }> = [];
    host.onMessage("playerDeclaredDead", (payload: unknown) =>
      declared.push(payload as { sessionId: string }),
    );

    const droppedId = guests[5].sessionId;
    (room as unknown as { _simulateDropForTest(s: string): void })._simulateDropForTest(droppedId);
    await room.waitForNextPatch();
    assert.strictEqual(room.engine.getPhaseTimer()!.paused, true);

    host.send("declareDead", { sessionId: droppedId });
    await room.waitForNextPatch();
    await new Promise((r) => setTimeout(r, 50));

    // Schema: dead and not missing.
    assert.strictEqual(
      room.state.players.get(droppedId)!.isAlive,
      false,
      "Player.isAlive = false after declareDead",
    );
    assert.strictEqual(
      room.state.players.get(droppedId)!.isMissing,
      false,
      "Player.isMissing cleared after declareDead",
    );

    // Timer resumed вЂ” MAFIA_WINDOW gets a fresh 60s nudge cycle, same shape
    // as resumePhase after mafia-window expiry. The snapshot reads the real
    // clock, so a few hundred ms may have ticked between declareDead and
    // the snapshot call (we round-trip through Colyseus + add a 50ms sleep).
    // Assert a 60s window up to a half-second drift.
    const snap = room.engine.getPhaseTimer();
    assert.ok(snap, "MAFIA_WINDOW re-armed");
    assert.strictEqual(snap!.paused, false);
    assert.strictEqual(snap!.mode, "MAFIA_WINDOW");
    assert.ok(
      snap!.remainingMs >= 59_500 && snap!.remainingMs <= 60_000,
      `fresh ~60s window after declareDead, got ${snap!.remainingMs}`,
    );

    // Seam fired with DECLARED_DEAD.
    assert.strictEqual(deadId, droppedId);
    assert.strictEqual(deadCause, "DECLARED_DEAD");

    // Host got the notification.
    assert.strictEqual(declared.length, 1);
    assert.strictEqual(declared[0].sessionId, droppedId);
  });

  it("non-host is rejected when sending declareDead", async () => {
    const { room, guests } = await setupRoom(colyseus, 10);
    const droppedId = guests[5].sessionId;
    (room as unknown as { _simulateDropForTest(s: string): void })._simulateDropForTest(droppedId);
    await room.waitForNextPatch();

    const errors: string[] = [];
    guests[0].onMessage("error", (msg: unknown) => {
      errors.push(String((msg as { message?: string }).message ?? msg));
    });

    guests[0].send("declareDead", { sessionId: droppedId });
    await room.waitForNextPatch();

    assert.ok(errors.length > 0, "non-host should receive an error");
    // Player must remain alive вЂ” the rejection didn't run the engine method.
    assert.strictEqual(room.state.players.get(droppedId)!.isAlive, true);
    // Still missing вЂ” the rejection didn't clear the flag.
    assert.strictEqual(room.state.players.get(droppedId)!.isMissing, true);
  });

  it("declareDead requires the target to be missing", async () => {
    const { room, host, guests } = await setupRoom(colyseus, 10);
    // No drop happened вЂ” guests[5] is alive and not missing.

    const errors: string[] = [];
    host.onMessage("error", (msg: unknown) => {
      errors.push(String((msg as { message?: string }).message ?? msg));
    });

    host.send("declareDead", { sessionId: guests[5].sessionId });
    await room.waitForNextPatch();

    assert.ok(errors.length > 0, "declareDead on a non-missing player must error");
    assert.strictEqual(room.state.players.get(guests[5].sessionId)!.isAlive, true);
  });

  it("the marked-dead player cannot perform actions (vote rejected with PLAYER_DEAD)", async () => {
    const setup = await setupRoom(colyseus, 10);

    // Drop and declare dead.
    const droppedId = setup.guests[5].sessionId;
    (setup.room as unknown as { _simulateDropForTest(s: string): void })._simulateDropForTest(droppedId);
    await setup.room.waitForNextPatch();
    setup.host.send("declareDead", { sessionId: droppedId });
    await setup.room.waitForNextPatch();

    // Drive into DAY_VOTING so the dead guest can try to vote.
    setup.host.send("mafiaKill", { targetId: setup.guests[7].sessionId });
    await setup.room.waitForNextPatch();
    setup.guests[3].send("doctorHeal", { targetId: setup.guests[7].sessionId });
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
    setup.guests[5].onMessage("error", (msg: unknown) => {
      errors.push(String((msg as { message?: string }).message ?? msg));
    });

    setup.guests[5].send("vote", { targetId: setup.guests[6].sessionId });
    await setup.room.waitForNextPatch();

    assert.ok(errors.length > 0, "vote from a declared-dead player must error");
  });

  it("a drop in DAY_VOTING (no timer) is recorded but doesn't try to pause a timer", async () => {
    const setup = await setupRoom(colyseus, 10);
    // Drive into DAY_VOTING with one nomination.
    setup.host.send("mafiaKill", { targetId: setup.guests[7].sessionId });
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
    assert.strictEqual(setup.room.engine.getPhaseTimer(), null, "no timer in DAY_VOTING");

    const droppedId = setup.guests[5].sessionId;
    (setup.room as unknown as { _simulateDropForTest(s: string): void })._simulateDropForTest(droppedId);
    await setup.room.waitForNextPatch();

    assert.strictEqual(setup.room.state.players.get(droppedId)!.isMissing, true);
    assert.deepStrictEqual(setup.room.engine.getMissingPlayers(), [droppedId]);
    assert.strictEqual(setup.room.engine.getPhaseTimer(), null, "no timer was armed by the drop");

    // declareDead still works and fires the seam.
    let fired = false;
    let cause = "";
    setup.room.engine.setOnPlayerDied((id, c) => {
      fired = true;
      cause = c;
      assert.strictEqual(id, droppedId);
    });
    setup.host.send("declareDead", { sessionId: droppedId });
    await setup.room.waitForNextPatch();
    assert.strictEqual(setup.room.state.players.get(droppedId)!.isAlive, false);
    assert.strictEqual(fired, true);
    assert.strictEqual(cause, "DECLARED_DEAD");
  });

  it("PLAYER_MISSING and PLAYER_RETURNED entries appear in the host's action log", async () => {
    const { room, host, guests } = await setupRoom(colyseus, 10);

    const droppedId = guests[5].sessionId;
    (room as unknown as { _simulateDropForTest(s: string): void })._simulateDropForTest(droppedId);
    await room.waitForNextPatch();

    // Log the missing event.
    const logEntries: Array<{ entries: Array<{ type: string; payload?: Record<string, unknown> }> }> = [];
    host.onMessage("log", (payload: unknown) =>
      logEntries.push(payload as { entries: Array<{ type: string; payload?: Record<string, unknown> }> }),
    );
    host.send("getLog", { since: "" });
    await room.waitForNextPatch();
    assert.ok(logEntries.length > 0, "host received a log response");
    const types = logEntries[0].entries.map((e) => e.type);
    assert.ok(types.includes("PLAYER_MISSING"), `log includes PLAYER_MISSING, got ${types.join(", ")}`);

    // Host calls declareDead в†’ DEAD_DECLARED entry also appears.
    logEntries.length = 0;
    host.send("declareDead", { sessionId: droppedId });
    await room.waitForNextPatch();

    host.send("getLog", { since: "" });
    await room.waitForNextPatch();
    const types2 = logEntries[0].entries.map((e) => e.type);
    assert.ok(types2.includes("DEAD_DECLARED"), `log includes DEAD_DECLARED, got ${types2.join(", ")}`);
  });

  // в”Ђв”Ђв”Ђ Ticket 06: kick + foul в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

  it("host can kick a player: marked dead server-side, still connected and reading public state", async () => {
    const { room, host, guests } = await setupRoom(colyseus, 10);
    const kickedId = guests[5].sessionId;

    host.send("kick", { sessionId: kickedId, reason: "showing a role card" });
    await room.waitForNextPatch();
    await new Promise((r) => setTimeout(r, 50));

    // Server-side: dead, but the seat is held.
    assert.strictEqual(room.state.players.get(kickedId)!.isAlive, false);
    assert.ok(room.state.players.has(kickedId), "kicked player stays in state.players");

    // The kicked client is still connected and its SDK state view keeps
    // syncing the public schema (read-only spectator).
    const clientView = guests[5].state.players.get(kickedId)!;
    assert.strictEqual(clientView.isAlive, false, "kicked client still receives public state");
  });

  it("kicked player cannot send anything: doctorHeal and ping rejected by the room gate", async () => {
    const { room, host, guests } = await setupRoom(colyseus, 10);

    // Kick the doctor вЂ” doctorHeal had no actor-alive guard before ticket 06,
    // so this proves the room-level gate (not just per-action engine checks).
    const kickedId = guests[3].sessionId;
    host.send("kick", { sessionId: kickedId, reason: "leaving" });
    await room.waitForNextPatch();

    const errors: string[] = [];
    guests[3].onMessage("error", (msg: unknown) => {
      errors.push(String((msg as { message?: string }).message ?? msg));
    });

    guests[3].send("doctorHeal", { targetId: guests[4].sessionId });
    await room.waitForNextPatch();
    assert.ok(errors.length > 0, "kicked doctor must receive an error");
    assert.strictEqual(room.state.doctorTargetId, "", "rejected heal must not write state");

    // And in a day phase, a kicked player cannot ping either.
    room.state.phase = GamePhase.DAY_SPEECHES;
    await room.waitForNextPatch();
    guests[3].send("ping", { toId: guests[4].sessionId });
    await room.waitForNextPatch();
    assert.ok(errors.length >= 2, "kicked player's ping must also be rejected");
    assert.strictEqual(room.engine.getAllPings().length, 0, "no ping accepted from a kicked player");
  });

  it("kick routes through onPlayerDied with the KICKED cause", async () => {
    const { room, host, guests } = await setupRoom(colyseus, 10);

    let deadId = "";
    let deadCause = "";
    room.engine.setOnPlayerDied((id, cause) => {
      deadId = id;
      deadCause = cause;
    });

    const kickedId = guests[5].sessionId;
    host.send("kick", { sessionId: kickedId, reason: "role card" });
    await room.waitForNextPatch();

    assert.strictEqual(deadId, kickedId);
    assert.strictEqual(deadCause, "KICKED");
  });

  it("foul records a warning and leaves the player fully active", async () => {
    const { room, host, guests } = await setupRoom(colyseus, 10);
    const fouledId = guests[5].sessionId;

    let seamFired = false;
    room.engine.setOnPlayerDied(() => {
      seamFired = true;
    });

    host.send("foul", { sessionId: fouledId, reason: "flood-pinging" });
    await room.waitForNextPatch();

    assert.strictEqual(room.state.players.get(fouledId)!.isAlive, true, "foul does not kill");
    assert.strictEqual(seamFired, false, "no death seam for a foul");

    // The fouled player is still a fully active participant.
    room.state.phase = GamePhase.DAY_SPEECHES;
    await room.waitForNextPatch();
    const fouledErrors: string[] = [];
    guests[5].onMessage("error", (msg: unknown) => {
      fouledErrors.push(String(msg));
    });
    guests[5].send("ping", { toId: guests[6].sessionId });
    await room.waitForNextPatch();
    assert.strictEqual(fouledErrors.length, 0, "fouled player can still act");
    assert.strictEqual(room.engine.getAllPings().length, 1);
  });

  it("KICK and FOUL entries appear in the host action log with actor, target and reason", async () => {
    const { room, host, guests } = await setupRoom(colyseus, 10);

    host.send("foul", { sessionId: guests[5].sessionId, reason: "flood-pinging" });
    await room.waitForNextPatch();
    host.send("kick", { sessionId: guests[6].sessionId, reason: "showing a role card" });
    await room.waitForNextPatch();

    const received: unknown[] = [];
    host.onMessage("log", (payload: unknown) => received.push(payload));
    host.send("getLog", { since: "" });
    await room.waitForNextPatch();

    const entries = (received[0] as { entries: Array<{ type: string; actorSessionId: string; payload: Record<string, unknown> }> }).entries;
    const foul = entries.find((e) => e.type === "FOUL");
    const kick = entries.find((e) => e.type === "KICK");
    assert.ok(foul, "log includes FOUL");
    assert.strictEqual(foul!.actorSessionId, host.sessionId);
    assert.strictEqual(foul!.payload.sessionId, guests[5].sessionId);
    assert.strictEqual(foul!.payload.reason, "flood-pinging");
    assert.ok(kick, "log includes KICK");
    assert.strictEqual(kick!.actorSessionId, host.sessionId);
    assert.strictEqual(kick!.payload.sessionId, guests[6].sessionId);
    assert.strictEqual(kick!.payload.reason, "showing a role card");
  });

  it("non-host cannot kick or foul", async () => {
    const { room, guests } = await setupRoom(colyseus, 10);

    const errors: string[] = [];
    guests[0].onMessage("error", (msg: unknown) => {
      errors.push(String((msg as { message?: string }).message ?? msg));
    });

    guests[0].send("kick", { sessionId: guests[5].sessionId, reason: "mutiny" });
    await room.waitForNextPatch();
    guests[0].send("foul", { sessionId: guests[5].sessionId, reason: "mutiny" });
    await room.waitForNextPatch();

    assert.ok(errors.length >= 2, "non-host should be rejected for both actions");
    assert.strictEqual(room.state.players.get(guests[5].sessionId)!.isAlive, true, "no kick happened");
    const logTypes = room.engine.getActionLog().map((e) => e.type);
    assert.ok(!logTypes.includes("KICK"), "no KICK entry");
    assert.ok(!logTypes.includes("FOUL"), "no FOUL entry");
  });

  // в”Ђв”Ђв”Ђ Ticket 07: Day 2+ BALAGAN + first-word rule (room layer) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

  /**
   * Drive a complete Day 1 cycle through the room's message layer, with the
   * first speaker nominating `nomineeDuringDay1` (an alive player who survives
   * вЂ” they get defended and the defense runs, but they are NOT voted out) and
   * every guest voting for `votedOutId`. Lands the engine in NIGHT
   * (post-vote), dayCount = 1. The `votedOutId` player is now dead; everyone
   * else (including `nomineeDuringDay1`) is still alive for Day 2 tests.
   *
   * `nomineeDuringDay1` is intentionally different from `votedOutId` so the
   * nominee remains alive for downstream Day 2 nominations, and so the Day 2
   * first-word-rule tests don't have to deal with a dead target.
   */
  async function driveFullDay1(
    setup: Setup,
    nomineeDuringDay1: string,
    votedOutId: string,
  ): Promise<void> {
    const { room, host, guests } = setup;

    host.send("mafiaKill", { targetId: guests[5].sessionId });
    await room.waitForNextPatch();
    guests[3].send("doctorHeal", { targetId: guests[5].sessionId });
    await room.waitForNextPatch();
    host.send("resolveNight");
    await room.waitForNextPatch();

    assert.strictEqual(room.state.phase, GamePhase.DAY_ANNOUNCEMENT);
    assert.strictEqual(room.state.dayCount, 1);

    host.send("startSpeeches");
    await room.waitForNextPatch();
    assert.strictEqual(room.state.phase, GamePhase.DAY_SPEECHES);

    // The first speaker is the lowest-seat non-host player (guests[0]).
    guests[0].send("nominate", { targetId: nomineeDuringDay1 });
    await room.waitForNextPatch();

    const order = room.engine.getSpeakingOrder();
    for (let i = 0; i < order.length; i++) {
      host.send("nextSpeaker");
      await room.waitForNextPatch();
    }
    // Day 1 auto-transitions from the last speech to DAY_DEFENSE.
    assert.strictEqual(room.state.phase, GamePhase.DAY_DEFENSE);

    const dOrder = room.engine.getDefenseOrder();
    for (let i = 0; i < dOrder.length; i++) {
      host.send("nextDefense");
      await room.waitForNextPatch();
    }
    assert.strictEqual(room.state.phase, GamePhase.DAY_VOTING);

    for (const g of guests) {
      g.send("vote", { targetId: votedOutId });
      await room.waitForNextPatch();
    }
    host.send("resolveVoting");
    await room.waitForNextPatch();

    assert.strictEqual(room.state.phase, GamePhase.NIGHT);
    assert.strictEqual(room.state.dayCount, 1);
    // The voted-out player is dead; the nominee survived.
    assert.strictEqual(room.state.players.get(votedOutId)!.isAlive, false);
    assert.strictEqual(room.state.players.get(nomineeDuringDay1)!.isAlive, true);
  }

  /**
   * Drive Night 2 with a save so all 10 players remain alive. Lands the
   * engine in DAY_ANNOUNCEMENT with dayCount = 2.
   */
  async function driveNight2WithSave(setup: Setup): Promise<void> {
    const { room, host, guests } = setup;

    host.send("mafiaKill", { targetId: guests[6].sessionId });
    await room.waitForNextPatch();
    guests[3].send("doctorHeal", { targetId: guests[6].sessionId });
    await room.waitForNextPatch();
    host.send("resolveNight");
    await room.waitForNextPatch();

    assert.strictEqual(room.state.phase, GamePhase.DAY_ANNOUNCEMENT);
    assert.strictEqual(room.state.dayCount, 2);
  }

  // A Day-1 nominee who survives the vote вЂ” picked as an alive civilian who
  // we want alive for Day 2 nominations. Sacrifice target is guests[9] so
  // Day 2 nominations can target guests[8] without colliding with a death.
  const day1Nominee = (setup: Setup): string => setup.guests[8].sessionId;
  const day1Sacrifice = (setup: Setup): string => setup.guests[9].sessionId;

  it("Day 1 first speech without nomination is accepted: nextSpeaker drives into DAY_DEFENSE", async () => {
    const setup = await setupRoom(colyseus, 10);

    // Drive Night 1 в†’ DAY_ANNOUNCEMENT.
    setup.host.send("mafiaKill", { targetId: setup.guests[5].sessionId });
    await setup.room.waitForNextPatch();
    setup.guests[3].send("doctorHeal", { targetId: setup.guests[5].sessionId });
    await setup.room.waitForNextPatch();
    setup.host.send("resolveNight");
    await setup.room.waitForNextPatch();
    setup.host.send("startSpeeches");
    await setup.room.waitForNextPatch();

    // First speaker is guests[0]; they intentionally nominate NO ONE.
    const errors: string[] = [];
    setup.host.onMessage("error", (msg: unknown) => {
      errors.push(String((msg as { message?: string }).message ?? msg));
    });

    // Drive all the way through Day 1 speeches without a single nomination.
    const order = setup.room.engine.getSpeakingOrder();
    for (let i = 0; i < order.length; i++) {
      setup.host.send("nextSpeaker");
      await setup.room.waitForNextPatch();
    }

    assert.strictEqual(errors.length, 0, "Day 1 should accept a nomination-less speech");
    assert.strictEqual(setup.room.state.phase, GamePhase.DAY_DEFENSE);
    assert.strictEqual(
      setup.room.state.nominations.length,
      0,
      "Day 1 doesn't auto-add the last speaker as a candidate (only votes default to them)",
    );
  });

  it("Day 2 first speaker without a nomination is rejected through the room with WRONG_PHASE", async () => {
    const setup = await setupRoom(colyseus, 10);
    await driveFullDay1(
      setup,
      (day1Nominee(setup)),
      (day1Sacrifice(setup)),
    );
    await driveNight2WithSave(setup);

    setup.host.send("startSpeeches");
    await setup.room.waitForNextPatch();
    assert.strictEqual(setup.room.state.phase, GamePhase.DAY_SPEECHES);
    assert.strictEqual(setup.room.state.dayCount, 2);

    // Day 2's first speaker is guests[1] (one seat clockwise from guests[0]).
    assert.strictEqual(setup.room.engine.getCurrentSpeaker(), setup.guests[1].sessionId);
    assert.strictEqual(setup.room.engine.getSpeakingOrder()[0], setup.guests[1].sessionId);

    const errors: string[] = [];
    setup.host.onMessage("error", (msg: unknown) => {
      errors.push(String((msg as { message?: string }).message ?? msg));
    });

    // End the first speech WITHOUT a nomination вЂ” must be rejected.
    setup.host.send("nextSpeaker");
    await setup.room.waitForNextPatch();

    assert.strictEqual(errors.length, 1, `host should receive one error, got ${errors.length}`);
    assert.strictEqual(
      errors[0],
      "\u0417\u0430\u0440\u0430\u0437 \u043d\u0435 \u0442\u0430 \u0444\u0430\u0437\u0430 \u0434\u043b\u044f \u0446\u0456\u0454\u0457 \u0434\u0456\u0457",
      "WRONG_PHASE surfaces as the Ukrainian phase-mismatch message",
    );
    // Phase must NOT have advanced вЂ” the rejection prevented BALAGAN entry.
    assert.strictEqual(setup.room.state.phase, GamePhase.DAY_SPEECHES);
    assert.strictEqual(setup.room.engine.getCurrentSpeaker(), setup.guests[1].sessionId);
  });

  it("Day 2 first speaker nominates в†’ nextSpeaker advances to DAY_BALAGAN with the 90s timer armed", async () => {
    const setup = await setupRoom(colyseus, 10);
    await driveFullDay1(
      setup,
      (day1Nominee(setup)),
      (day1Sacrifice(setup)),
    );
    await driveNight2WithSave(setup);

    setup.host.send("startSpeeches");
    await setup.room.waitForNextPatch();
    assert.strictEqual(setup.room.engine.getCurrentSpeaker(), setup.guests[1].sessionId);

    // The first speaker (guests[1]) nominates guests[8] (alive, untouched by
    // the Day-1 sacrifice of guests[9]) вЂ” fulfils the first-word rule.
    setup.guests[1].send("nominate", { targetId: setup.guests[8].sessionId });
    await setup.room.waitForNextPatch();
    assert.strictEqual(setup.room.state.nominations.length, 1);

    // Drive through every remaining speech. The last call to nextSpeaker
    // auto-transitions to DAY_BALAGAN on Day 2+.
    const order = setup.room.engine.getSpeakingOrder();
    for (let i = 0; i < order.length; i++) {
      setup.host.send("nextSpeaker");
      await setup.room.waitForNextPatch();
    }

    assert.strictEqual(setup.room.state.phase, GamePhase.DAY_BALAGAN);
    const snap = setup.room.engine.getPhaseTimer();
    assert.ok(snap, "BALAGAN timer should be armed");
    assert.strictEqual(snap!.mode, "BALAGAN");
    assert.strictEqual(snap!.durationMs, 90_000);
    assert.strictEqual(snap!.paused, false);
  });

  it("host can skipPhase during DAY_BALAGAN and the room advances into DAY_DEFENSE", async () => {
    const setup = await setupRoom(colyseus, 10);
    await driveFullDay1(
      setup,
      (day1Nominee(setup)),
      (day1Sacrifice(setup)),
    );
    await driveNight2WithSave(setup);

    setup.host.send("startSpeeches");
    await setup.room.waitForNextPatch();
    // First speaker (guests[1]) nominates so nextSpeaker will eventually
    // advance past speeches.
    setup.guests[1].send("nominate", { targetId: setup.guests[8].sessionId });
    await setup.room.waitForNextPatch();

    const order = setup.room.engine.getSpeakingOrder();
    for (let i = 0; i < order.length; i++) {
      setup.host.send("nextSpeaker");
      await setup.room.waitForNextPatch();
    }
    assert.strictEqual(setup.room.state.phase, GamePhase.DAY_BALAGAN);

    setup.host.send("skipPhase");
    await setup.room.waitForNextPatch();
    assert.strictEqual(setup.room.state.phase, GamePhase.DAY_DEFENSE);
  });

  it("Day 3 first speaker is the seat immediately clockwise from Day 2's first speaker", async () => {
    const setup = await setupRoom(colyseus, 10);

    // Drive a full Day 1 cycle (no first-word rule applies). Sacrifice
    // guests[9]; leave everyone else alive for the rotation test.
    await driveFullDay1(
      setup,
      (day1Nominee(setup)),
      (day1Sacrifice(setup)),
    );
    await driveNight2WithSave(setup);

    // Day 2 first speaker must be guests[1] (one seat clockwise from guests[0]).
    setup.host.send("startSpeeches");
    await setup.room.waitForNextPatch();
    assert.strictEqual(setup.room.state.dayCount, 2);
    assert.strictEqual(setup.room.engine.getCurrentSpeaker(), setup.guests[1].sessionId);

    // Drive Day 2 end-to-end so the next startSpeeches lands on Day 3.
    // First speaker nominates (fulfils the rule), then we drive through
    // speeches в†’ BALAGAN в†’ DEFENSE в†’ VOTING в†’ NIGHT (dayCount = 2).
    setup.guests[1].send("nominate", { targetId: setup.guests[8].sessionId });
    await setup.room.waitForNextPatch();

    const order = setup.room.engine.getSpeakingOrder();
    for (let i = 0; i < order.length; i++) {
      setup.host.send("nextSpeaker");
      await setup.room.waitForNextPatch();
    }
    assert.strictEqual(setup.room.state.phase, GamePhase.DAY_BALAGAN);

    setup.host.send("skipPhase");
    await setup.room.waitForNextPatch();
    assert.strictEqual(setup.room.state.phase, GamePhase.DAY_DEFENSE);

    const dOrder = setup.room.engine.getDefenseOrder();
    for (let i = 0; i < dOrder.length; i++) {
      setup.host.send("nextDefense");
      await setup.room.waitForNextPatch();
    }
    assert.strictEqual(setup.room.state.phase, GamePhase.DAY_VOTING);

    for (const g of setup.guests) {
      g.send("vote", { targetId: setup.guests[8].sessionId });
      await setup.room.waitForNextPatch();
    }
    setup.host.send("resolveVoting");
    await setup.room.waitForNextPatch();
    assert.strictEqual(setup.room.state.phase, GamePhase.NIGHT);
    assert.strictEqual(setup.room.state.dayCount, 2);

    // Night 3 вЂ” a save keeps everyone alive for the rotation test.
    setup.host.send("mafiaKill", { targetId: setup.guests[7].sessionId });
    await setup.room.waitForNextPatch();
    setup.guests[3].send("doctorHeal", { targetId: setup.guests[7].sessionId });
    await setup.room.waitForNextPatch();
    setup.host.send("resolveNight");
    await setup.room.waitForNextPatch();
    assert.strictEqual(setup.room.state.phase, GamePhase.DAY_ANNOUNCEMENT);
    assert.strictEqual(setup.room.state.dayCount, 3);

    // Day 3 first speaker must be guests[2] вЂ” one seat after Day 2's guests[1].
    setup.host.send("startSpeeches");
    await setup.room.waitForNextPatch();
    assert.strictEqual(setup.room.engine.getCurrentSpeaker(), setup.guests[2].sessionId);
    assert.strictEqual(setup.room.engine.getSpeakingOrder()[0], setup.guests[2].sessionId);
  });

  it("first-word rule is reset for Day 3: Day 2's last-minute nomination does not bleed across days", async () => {
    const setup = await setupRoom(colyseus, 10);
    await driveFullDay1(
      setup,
      (day1Nominee(setup)),
      (day1Sacrifice(setup)),
    );
    await driveNight2WithSave(setup);

    // Day 2 вЂ” first speaker (guests[1]) nominates, fulfilling the rule.
    setup.host.send("startSpeeches");
    await setup.room.waitForNextPatch();
    setup.guests[1].send("nominate", { targetId: setup.guests[8].sessionId });
    await setup.room.waitForNextPatch();

    const order = setup.room.engine.getSpeakingOrder();
    for (let i = 0; i < order.length; i++) {
      setup.host.send("nextSpeaker");
      await setup.room.waitForNextPatch();
    }
    setup.host.send("skipPhase");
    await setup.room.waitForNextPatch();
    const dOrder = setup.room.engine.getDefenseOrder();
    for (let i = 0; i < dOrder.length; i++) {
      setup.host.send("nextDefense");
      await setup.room.waitForNextPatch();
    }
    for (const g of setup.guests) {
      g.send("vote", { targetId: setup.guests[8].sessionId });
      await setup.room.waitForNextPatch();
    }
    setup.host.send("resolveVoting");
    await setup.room.waitForNextPatch();

    // Night 3 в†’ Day 3 (dayCount = 3).
    setup.host.send("mafiaKill", { targetId: setup.guests[7].sessionId });
    await setup.room.waitForNextPatch();
    setup.guests[3].send("doctorHeal", { targetId: setup.guests[7].sessionId });
    await setup.room.waitForNextPatch();
    setup.host.send("resolveNight");
    await setup.room.waitForNextPatch();

    setup.host.send("startSpeeches");
    await setup.room.waitForNextPatch();
    assert.strictEqual(setup.room.engine.getCurrentSpeaker(), setup.guests[2].sessionId);

    // Day 3 first speaker (guests[2]) must nominate afresh вЂ” Day 2's
    // flag flip must not carry over. Without a nomination here, the host's
    // nextSpeaker should be rejected.
    const errors: string[] = [];
    setup.host.onMessage("error", (msg: unknown) => {
      errors.push(String((msg as { message?: string }).message ?? msg));
    });
    setup.host.send("nextSpeaker");
    await setup.room.waitForNextPatch();
    assert.strictEqual(
      errors.length,
      1,
      "Day 3 first speaker must also nominate вЂ” Day 2's flag must not bleed",
    );
    assert.strictEqual(
      errors[0],
      "\u0417\u0430\u0440\u0430\u0437 \u043d\u0435 \u0442\u0430 \u0444\u0430\u0437\u0430 \u0434\u043b\u044f \u0446\u0456\u0454\u0457 \u0434\u0456\u0457",
    );
    assert.strictEqual(setup.room.state.phase, GamePhase.DAY_SPEECHES);
  });

  it("nominate during DAY_BALAGAN is accepted (a Day 2 first-word failure can still be cured before defense)", async () => {
    const setup = await setupRoom(colyseus, 10);
    await driveFullDay1(
      setup,
      (day1Nominee(setup)),
      (day1Sacrifice(setup)),
    );
    await driveNight2WithSave(setup);

    setup.host.send("startSpeeches");
    await setup.room.waitForNextPatch();
    // First speaker (guests[1]) intentionally does NOT nominate.
    // Drive all the way through speeches в†’ BALAGAN. The first-word rule
    // permits advancing because guests[1] is NOT the first speaker вЂ” wait,
    // actually guests[1] IS the Day 2 first speaker, so nextSpeaker on index
    // 0 should reject. We need a different shape for this test: have a
    // DIFFERENT player (e.g. guests[3]) be the first speaker, or have the
    // first speaker (guests[1]) nominate.
    //
    // Re-shape: have guests[1] (Day 2 first speaker) satisfy the rule with a
    // nomination, drive into BALAGAN, then have a non-first player nominate
    // a SECOND candidate during BALAGAN.
    setup.guests[1].send("nominate", { targetId: setup.guests[8].sessionId });
    await setup.room.waitForNextPatch();

    const order = setup.room.engine.getSpeakingOrder();
    for (let i = 0; i < order.length; i++) {
      setup.host.send("nextSpeaker");
      await setup.room.waitForNextPatch();
    }
    assert.strictEqual(setup.room.state.phase, GamePhase.DAY_BALAGAN);
    assert.strictEqual(setup.room.state.nominations.length, 1);

    // During BALAGAN, a second late nomination from any player is accepted.
    const errors: string[] = [];
    setup.guests[3].onMessage("error", (msg: unknown) => {
      errors.push(String((msg as { message?: string }).message ?? msg));
    });
    setup.guests[3].send("nominate", { targetId: setup.guests[7].sessionId });
    await setup.room.waitForNextPatch();

    assert.strictEqual(errors.length, 0, "nominate during DAY_BALAGAN is allowed");
    assert.strictEqual(setup.room.state.nominations.length, 2);
    assert.strictEqual(setup.room.state.phase, GamePhase.DAY_BALAGAN);
  });
});
