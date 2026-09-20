import assert from "assert";
import { MafiaState, Player } from "../src/rooms/schema/MafiaState.js";
import { GamePhase, NightStep, Role, Team } from "../src/rooms/schema/enums.js";
import { Engine } from "../src/game/Engine.js";
import { PhaseTimer } from "../src/game/PhaseTimer.js";
import { EngineErrorCode } from "../src/game/types.js";

/**
 * Helper: build a fresh MafiaState populated with `count` non-host players
 * (plus an optional host) and return both. Players are keyed by deterministic
 * sessionIds "p0"вЂ¦"pN-1" so tests can target them directly.
 */
function freshState(count: number, withHost = true): MafiaState {
  const state = new MafiaState();
  state.maxPlayers = count;
  let seat = 0;
  if (withHost) {
    const host = new Player();
    host.sessionId = "host";
    host.name = "Host";
    host.isHost = true;
    host.seatIndex = seat++;
    state.players.set(host.sessionId, host);
  }
  for (let i = 0; i < count; i++) {
    const p = new Player();
    p.sessionId = `p${i}`;
    p.name = `P${i}`;
    p.isHost = false;
    p.seatIndex = seat++;
    state.players.set(p.sessionId, p);
  }
  return state;
}

describe("Engine вЂ” role assignment", () => {
  for (const count of [9, 10, 11] as const) {
    it(`assigns the right distribution for ${count} players`, () => {
      const state = freshState(count);
      const engine = new Engine(state);
      engine.startGame();

      // Host never gets a role.
      assert.strictEqual(engine.getRole("host"), undefined);

      // Count by role matches the table.
      const counts = new Map<Role, number>();
      for (let i = 0; i < count; i++) {
        const r = engine.getRole(`p${i}`);
        assert.ok(r, `player p${i} should have a role`);
        counts.set(r, (counts.get(r) ?? 0) + 1);
      }

      const expected: Record<Role, number> = {
        [Role.DON]: 1,
        [Role.MAFIA]: count === 9 ? 1 : 2,
        [Role.SHERIFF]: 1,
        [Role.DOCTOR]: 1,
        [Role.CIVILIAN]: count === 11 ? 6 : 5,
      };
      for (const [role, want] of Object.entries(expected)) {
        assert.strictEqual(counts.get(role as Role) ?? 0, want, `${role} count`);
      }
    });
  }

  it("moves state from LOBBY to NIGHT with nightStep MAFIA", () => {
    const state = freshState(10);
    const engine = new Engine(state);
    engine.startGame();

    assert.strictEqual(state.phase, GamePhase.NIGHT);
    assert.strictEqual(state.nightStep, NightStep.MAFIA);
    assert.strictEqual(state.dayCount, 0);
  });

  it("assigns the right team per role", () => {
    const state = freshState(10);
    const engine = new Engine(state);
    engine.startGame();

    for (let i = 0; i < 10; i++) {
      const role = engine.getRole(`p${i}`);
      const team = engine.getTeam(`p${i}`);
      assert.ok(role && team);
      if (role === Role.MAFIA || role === Role.DON) {
        assert.strictEqual(team, Team.BLACK);
      } else {
        assert.strictEqual(team, Team.RED);
      }
    }
  });

  it("rejects startGame when the player count is not in the distribution table", () => {
    const state = freshState(7); // unsupported
    const engine = new Engine(state);
    assert.throws(() => engine.startGame(), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.GAME_LOCKED;
    });
  });

  it("rejects startGame when the game is already running", () => {
    const state = freshState(10);
    const engine = new Engine(state);
    engine.startGame();
    assert.throws(() => engine.startGame(), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.GAME_LOCKED;
    });
  });
});

describe("Engine вЂ” public schema secrecy", () => {
  it("Player schema has no role/team fields", () => {
    const p = new Player();
    // Public Player exposes: sessionId, seatIndex, name, isAlive, isHost,
    // isNominated, votes вЂ” and crucially NOT role/team.
    assert.strictEqual((p as unknown as { role?: unknown }).role, undefined);
    assert.strictEqual((p as unknown as { team?: unknown }).team, undefined);
  });

  it("after startGame, no player in state.players exposes role/team via the schema", () => {
    const state = freshState(10);
    const engine = new Engine(state);
    engine.startGame();

    for (const p of state.players.values()) {
      assert.strictEqual((p as unknown as { role?: unknown }).role, undefined);
      assert.strictEqual((p as unknown as { team?: unknown }).team, undefined);
    }
  });
});

describe("Engine вЂ” night actions", () => {
  function startAndAssign(engine: Engine) {
    engine.startGame();
    // Inject deterministic roles so tests can target specific actors.
    // p0 = DON, p1 = MAFIA, p2 = SHERIFF, p3 = DOCTOR, others = CIVILIAN
    engine._assignRoleForTest("p0", Role.DON);
    engine._assignRoleForTest("p1", Role.MAFIA);
    engine._assignRoleForTest("p2", Role.SHERIFF);
    engine._assignRoleForTest("p3", Role.DOCTOR);
    for (let i = 4; i < 10; i++) {
      engine._assignRoleForTest(`p${i}`, Role.CIVILIAN);
    }
  }

  it("mafiaKill accepts a host and writes state.mafiaTargetId", () => {
    const state = freshState(10);
    const engine = new Engine(state);
    startAndAssign(engine);

    engine.mafiaKill("host", "p4");
    assert.strictEqual(state.mafiaTargetId, "p4");
  });

  it("mafiaKill rejects a non-host", () => {
    const state = freshState(10);
    const engine = new Engine(state);
    startAndAssign(engine);

    assert.throws(() => engine.mafiaKill("p1", "p4"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.NOT_HOST;
    });
  });

  it("doctorHeal accepts the Doctor targeting any alive player", () => {
    const state = freshState(10);
    const engine = new Engine(state);
    startAndAssign(engine);

    engine.doctorHeal("p3", "p5");
    assert.strictEqual(state.doctorTargetId, "p5");
  });

  it("doctorHeal rejects a non-Doctor actor", () => {
    const state = freshState(10);
    const engine = new Engine(state);
    startAndAssign(engine);

    assert.throws(() => engine.doctorHeal("p2", "p5"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_ROLE;
    });
  });

  it("doctorHeal rejects a target that was healed last night", () => {
    const state = freshState(10);
    const engine = new Engine(state);
    startAndAssign(engine);

    // Simulate "Doctor healed p5 last night" via the test-only helper.
    engine._setLastHealedForTest("p3", "p5");

    assert.throws(() => engine.doctorHeal("p3", "p5"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.DOCTOR_RESTRICTION;
    });

    // But healing a different player is still allowed.
    engine.doctorHeal("p3", "p6");
    assert.strictEqual(state.doctorTargetId, "p6");
  });

  it("donCheck and sheriffCheck accept the right actor and reject the wrong one", () => {
    const state = freshState(10);
    const engine = new Engine(state);
    startAndAssign(engine);

    engine.donCheck("p0", "p2");
    engine.sheriffCheck("p2", "p0");

    assert.strictEqual(engine.getActionLog().length >= 2, true);

    assert.throws(() => engine.donCheck("p2", "p0"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_ROLE;
    });
    assert.throws(() => engine.sheriffCheck("p0", "p2"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_ROLE;
    });
  });

  it("donCheck/sheriffCheck reject self-check", () => {
    const state = freshState(10);
    const engine = new Engine(state);
    startAndAssign(engine);

    assert.throws(() => engine.donCheck("p0", "p0"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_ROLE;
    });
    assert.throws(() => engine.sheriffCheck("p2", "p2"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_ROLE;
    });
  });
});

describe("Engine вЂ” phase guards", () => {
  function startEngine10(): { state: MafiaState; engine: Engine } {
    const state = freshState(10);
    const engine = new Engine(state);
    engine.startGame();
    return { state, engine };
  }

  it("night actions are rejected in LOBBY", () => {
    const state = freshState(10);
    const engine = new Engine(state);
    assert.throws(() => engine.mafiaKill("host", "p0"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_PHASE;
    });
    assert.throws(() => engine.doctorHeal("p3", "p0"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_PHASE;
    });
  });

  it("night actions are rejected during DAY_ANNOUNCEMENT", () => {
    const { engine } = startEngine10();
    engine.state.phase = GamePhase.DAY_ANNOUNCEMENT;
    assert.throws(() => engine.mafiaKill("host", "p0"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_PHASE;
    });
    assert.throws(() => engine.doctorHeal("p3", "p0"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_PHASE;
    });
  });

  it("resolveNight is rejected outside NIGHT", () => {
    const { engine } = startEngine10();
    engine.state.phase = GamePhase.DAY_ANNOUNCEMENT;
    assert.throws(() => engine.resolveNight(), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_PHASE;
    });
  });
});

describe("Engine вЂ” night resolution", () => {
  function setup10(): { state: MafiaState; engine: Engine } {
    const state = freshState(10);
    const engine = new Engine(state);
    engine.startGame();
    engine._assignRoleForTest("p3", Role.DOCTOR);
    return { state, engine };
  }

  it("doctor matches mafia victim в†’ state.died is empty", () => {
    const { state, engine } = setup10();
    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p3", "p4");
    const res = engine.resolveNight();

    assert.strictEqual(res.died, "");
    assert.strictEqual(res.mafiaVictimId, "p4");
    assert.strictEqual(res.doctorHealId, "p4");
    assert.strictEqual(state.died, "");
  });

  it("doctor does not match mafia victim в†’ state.died equals the victim", () => {
    const { state, engine } = setup10();
    engine.mafiaKill("host", "p4");
    // Doctor heals someone else.
    engine.doctorHeal("p3", "p5");
    const res = engine.resolveNight();

    assert.strictEqual(res.died, "p4");
    assert.strictEqual(state.died, "p4");
  });

  it("no mafia victim submitted в†’ state.died stays empty", () => {
    const { state, engine } = setup10();
    engine.doctorHeal("p3", "p5");
    const res = engine.resolveNight();

    assert.strictEqual(res.died, "");
    assert.strictEqual(state.died, "");
  });

  it("after resolution, lastHealed is recorded so the next night rejects repeat target", () => {
    const { engine } = setup10();

    // Night 1: heal p4 successfully.
    engine.mafiaKill("host", "p7");
    engine.doctorHeal("p3", "p4");
    engine.resolveNight();

    // resolveNight now transitions to DAY_ANNOUNCEMENT (ticket 03). To test
    // the next night's restriction without driving the whole day cycle, we
    // manually put the engine back into NIGHT and clear the action buffer.
    engine.state.phase = GamePhase.NIGHT;
    engine.state.nightStep = NightStep.MAFIA;
    (engine as unknown as { nightActions: unknown }).nightActions = {
      mafiaVictimId: "",
      donCheck: null,
      sheriffCheck: null,
      doctorHeal: null,
    };

    assert.throws(() => engine.doctorHeal("p3", "p4"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.DOCTOR_RESTRICTION;
    });
  });

  it("mafia kill rejected when target is not at the table", () => {
    const { engine } = setup10();
    assert.throws(() => engine.mafiaKill("host", "ghost"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.PLAYER_MISSING;
    });
  });

  it("mafia kill rejected when target is dead", () => {
    const { state, engine } = setup10();
    state.players.get("p4")!.isAlive = false;
    assert.throws(() => engine.mafiaKill("host", "p4"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.PLAYER_DEAD;
    });
  });
});

describe("Engine вЂ” action log", () => {
  it("records every accepted action and the phase events", () => {
    const state = freshState(10);
    const engine = new Engine(state);
    engine.startGame();
    engine._assignRoleForTest("p3", Role.DOCTOR);
    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p3", "p4");
    engine.resolveNight();

    const log = engine.getActionLog();
    // startGame, mafiaKill, doctorHeal, resolveNight -> 4 entries
    assert.strictEqual(log.length, 4);
    assert.strictEqual(log[0].phase, GamePhase.NIGHT);
    assert.strictEqual(log[0].type, "PHASE_ADVANCE");
  });
});

describe("Engine -- action log query", () => {
  function seed(): Engine {
    const state = freshState(10);
    const engine = new Engine(state);
    engine.startGame();
    engine._assignRoleForTest("p3", Role.DOCTOR);
    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p3", "p4");
    engine.resolveNight();
    return engine;
  }

  it("returns the whole log when since is empty", () => {
    const engine = seed();
    const entries = engine.getActionLogSince("");
    assert.strictEqual(entries.length, engine.getActionLog().length);
    assert.strictEqual(entries.length, 4);
  });

  it("returns entries strictly after the given id", () => {
    const engine = seed();
    const all = engine.getActionLog();
    const sinceId = all[1].id; // skip startGame, return the rest
    const tail = engine.getActionLogSince(sinceId);
    assert.strictEqual(tail.length, all.length - 2);
    assert.deepStrictEqual(
      tail.map((e) => e.id),
      all.slice(2).map((e) => e.id),
    );
  });

  it("falls back to the whole log when the id is unknown", () => {
    const engine = seed();
    const tail = engine.getActionLogSince("act_does_not_exist");
    assert.strictEqual(tail.length, engine.getActionLog().length);
  });
});

describe("Engine -- pings", () => {
  function setupDay(): { state: MafiaState; engine: Engine } {
    const state = freshState(10);
    const engine = new Engine(state);
    engine.startGame();
    // Simulate "we are now in DAY_SPEECHES" by flipping the phase directly.
    engine.state.phase = GamePhase.DAY_SPEECHES;
    return { state, engine };
  }

  function setupNight(): { state: MafiaState; engine: Engine } {
    const state = freshState(10);
    const engine = new Engine(state);
    engine.startGame();
    // Pin every role so the night-ping tests don't depend on the random
    // shuffle. p0=DON, p1=MAFIA, p2-p9=CIVILIAN.
    engine._assignRoleForTest("p0", Role.DON);
    engine._assignRoleForTest("p1", Role.MAFIA);
    for (let i = 2; i < 10; i++) {
      engine._assignRoleForTest(`p${i}`, Role.CIVILIAN);
    }
    return { state, engine };
  }

  it("day phase: any alive player can ping any other alive player", () => {
    const { engine } = setupDay();
    const record = engine.ping("p0", "p4");
    assert.strictEqual(record.fromId, "p0");
    assert.strictEqual(record.toId, "p4");
    assert.ok(record.id.startsWith("ping_"));
    assert.ok(record.timestamp > 0);
  });

  it("day phase: a player cannot ping themselves", () => {
    const { engine } = setupDay();
    assert.throws(() => engine.ping("p0", "p0"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_ROLE;
    });
  });

  it("day phase: a dead player cannot ping or be pinged", () => {
    const { state, engine } = setupDay();
    state.players.get("p4")!.isAlive = false;

    assert.throws(() => engine.ping("p0", "p4"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.PLAYER_DEAD;
    });

    state.players.get("p0")!.isAlive = false;
    assert.throws(() => engine.ping("p0", "p5"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.PLAYER_DEAD;
    });
  });

  it("day phase: pings are visible only to sender and recipient", () => {
    const { engine } = setupDay();
    engine.ping("p0", "p4");
    engine.ping("p4", "p5");
    engine.ping("p5", "p6");

    const p0 = engine.getPingsForPlayer("p0");
    const p4 = engine.getPingsForPlayer("p4");
    const p5 = engine.getPingsForPlayer("p5");
    const p6 = engine.getPingsForPlayer("p6");
    const p7 = engine.getPingsForPlayer("p7");

    assert.strictEqual(p0.length, 1, "p0 sent one ping");
    assert.strictEqual(p0[0].toId, "p4");

    assert.strictEqual(p4.length, 2, "p4 received p0's and sent one");
    const p4Ids = p4.map((p) => `${p.fromId}->${p.toId}`).sort();
    assert.deepStrictEqual(p4Ids, ["p0->p4", "p4->p5"]);

    assert.strictEqual(p5.length, 2, "p5 received p4's and sent one");
    const p5Ids = p5.map((p) => `${p.fromId}->${p.toId}`).sort();
    assert.deepStrictEqual(p5Ids, ["p4->p5", "p5->p6"]);

    assert.strictEqual(p6.length, 1, "p6 received one");
    assert.strictEqual(p6[0].fromId, "p5");

    assert.strictEqual(p7.length, 0, "p7 is not involved in any ping");

    assert.strictEqual(engine.getAllPings().length, 3, "host sees everything");
  });

  it("day phase: each accepted ping is also a PING entry in the action log", () => {
    const { engine } = setupDay();
    const before = engine.getActionLog().length;
    engine.ping("p0", "p4");
    engine.ping("p4", "p5");

    const log = engine.getActionLog();
    assert.strictEqual(log.length, before + 2);
    assert.strictEqual(log[log.length - 2].type, "PING");
    assert.strictEqual(log[log.length - 2].actorSessionId, "p0");
    assert.strictEqual((log[log.length - 2].payload as { toId: string }).toId, "p4");
    assert.strictEqual(log[log.length - 1].type, "PING");
    assert.strictEqual(log[log.length - 1].actorSessionId, "p4");
  });

  it("lobby: rejects pings", () => {
    const state = freshState(10);
    const engine = new Engine(state);
    assert.throws(() => engine.ping("p0", "p4"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_PHASE;
    });
  });

  it("game over: rejects pings", () => {
    const { engine } = setupDay();
    engine.state.phase = GamePhase.GAME_OVER;
    assert.throws(() => engine.ping("p0", "p4"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_PHASE;
    });
  });

  it("night: mafia (DON or MAFIA) can ping other mafia", () => {
    const { engine } = setupNight();
    // p0 = DON, p1 = MAFIA
    const r1 = engine.ping("p0", "p1");
    assert.strictEqual(r1.fromId, "p0");
    assert.strictEqual(r1.toId, "p1");

    const r2 = engine.ping("p1", "p0");
    assert.strictEqual(r2.fromId, "p1");
    assert.strictEqual(r2.toId, "p0");
  });

  it("night: a civilian cannot ping during the night", () => {
    const { engine } = setupNight();
    // p4 is unassigned -> still a civilian via the role distribution
    assert.throws(() => engine.ping("p4", "p1"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_ROLE;
    });
  });

  it("night: mafia cannot ping a civilian", () => {
    const { engine } = setupNight();
    assert.throws(() => engine.ping("p1", "p4"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_ROLE;
    });
  });

  it("night: civilians don't see mafia pings via getPingsForPlayer", () => {
    const { engine } = setupNight();
    engine.ping("p0", "p1"); // mafia ping accepted
    // p4 trying to ping p5 is rejected (civilian, also target is civilian);
    // verify the rejection happens AND that the visibility list is empty.
    assert.throws(() => engine.ping("p4", "p5"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_ROLE;
    });
    assert.deepStrictEqual(engine.getPingsForPlayer("p4"), []);
    // But the host sees the mafia ping.
    const all = engine.getAllPings();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].fromId, "p0");
    assert.strictEqual(all[0].toId, "p1");
  });
});

// ─── Ticket 03: Day-1 basic flow ───────────────────────────────────────

describe("Engine — resolveNight → day cycle entry", () => {
  it("resolveNight transitions to DAY_ANNOUNCEMENT and increments dayCount to 1", () => {
    const { state, engine } = ((): { state: MafiaState; engine: Engine } => {
      const state = freshState(10);
      const engine = new Engine(state);
      engine.startGame();
      engine._assignRoleForTest("p3", Role.DOCTOR);
      return { state, engine };
    })();

    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p3", "p5");
    engine.resolveNight();

    assert.strictEqual(state.phase, GamePhase.DAY_ANNOUNCEMENT);
    assert.strictEqual(state.dayCount, 1);
    assert.strictEqual(state.died, "p4");
  });

  it("resolveNight with no deaths still enters DAY_ANNOUNCEMENT", () => {
    const { state, engine } = ((): { state: MafiaState; engine: Engine } => {
      const state = freshState(10);
      const engine = new Engine(state);
      engine.startGame();
      engine._assignRoleForTest("p3", Role.DOCTOR);
      return { state, engine };
    })();

    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p3", "p4");
    engine.resolveNight();

    assert.strictEqual(state.phase, GamePhase.DAY_ANNOUNCEMENT);
    assert.strictEqual(state.dayCount, 1);
    assert.strictEqual(state.died, "");
  });

  it("resolveNight clears night action targets and the next-night Doctor restriction is preserved", () => {
    const { state, engine } = ((): { state: MafiaState; engine: Engine } => {
      const state = freshState(10);
      const engine = new Engine(state);
      engine.startGame();
      engine._assignRoleForTest("p3", Role.DOCTOR);
      return { state, engine };
    })();

    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p3", "p5");
    engine.resolveNight();

    assert.strictEqual(state.mafiaTargetId, "");
    assert.strictEqual(state.doctorTargetId, "");
    // Doctor healed p5 last night — should still be in the engine's lastHealed
    // map so the next night rejects a repeat heal.
    assert.strictEqual(engine.getLastHealed("p3"), "p5");
  });
});

describe("Engine — Day 1 phase sequence (no BALAGAN, ADR 0005)", () => {
  /**
   * Drive a full Day 1 cycle from NIGHT through to the next NIGHT.
   * Mirrors the integration test, but without Colyseus — exercises the
   * engine's state-machine surface directly.
   */
  function driveNightThenDay(): Engine {
    const state = freshState(10);
    const engine = new Engine(state);
    engine.startGame();
    engine._assignRoleForTest("p3", Role.DOCTOR);
    // Mafia kills p4; Doctor saves p4 → no one dies, so the speaking order
    // still has all 10 players.
    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p3", "p4");
    engine.resolveNight();
    return engine;
  }

  it("startSpeeches: transitions to DAY_SPEECHES and points at the first alive player", () => {
    const engine = driveNightThenDay();
    engine.startSpeeches();
    assert.strictEqual(engine.state.phase, GamePhase.DAY_SPEECHES);
    assert.strictEqual(engine.getCurrentSpeaker(), "p0");
    assert.strictEqual(engine.getSpeakingOrder()[0], "p0");
  });

  it("nextSpeaker advances clockwise; on the last call it auto-transitions to DAY_DEFENSE (Day 1 skips BALAGAN)", () => {
    const engine = driveNightThenDay();
    engine.startSpeeches();
    const order = engine.getSpeakingOrder();
    assert.strictEqual(order.length, 10);

    for (let i = 1; i < order.length; i++) {
      engine.nextSpeaker();
      assert.strictEqual(engine.getCurrentSpeaker(), order[i]);
    }
    // One more nextSpeaker finishes the round.
    engine.nextSpeaker();
    assert.strictEqual(engine.getCurrentSpeaker(), "");
    assert.strictEqual(engine.state.phase, GamePhase.DAY_DEFENSE);
  });

  it("startSpeeches rejects if the engine is not in DAY_ANNOUNCEMENT", () => {
    const engine = driveNightThenDay();
    // engine is in DAY_ANNOUNCEMENT; first startSpeeches succeeds.
    engine.startSpeeches();
    assert.throws(() => engine.startSpeeches(), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_PHASE;
    });
  });

  it("nextSpeaker rejects outside DAY_SPEECHES", () => {
    const engine = driveNightThenDay();
    assert.throws(() => engine.nextSpeaker(), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_PHASE;
    });
  });

  it("dead players are skipped in the speaking order", () => {
    const engine = driveNightThenDay();
    // Mark p3 (doctor) dead before speeches — p3 should be skipped.
    engine.state.players.get("p3")!.isAlive = false;
    engine.startSpeeches();

    const order = engine.getSpeakingOrder();
    assert.ok(!order.includes("p3"), "dead player p3 should not be in speaking order");
    // All other players should still be present.
    for (let i = 0; i < 10; i++) {
      if (i === 3) continue;
      assert.ok(order.includes(`p${i}`), `p${i} should be in speaking order`);
    }
  });
});

describe("Engine — nominations", () => {
  function inDay1Speeches(): Engine {
    const state = freshState(10);
    const engine = new Engine(state);
    engine.startGame();
    engine._assignRoleForTest("p3", Role.DOCTOR);
    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p3", "p5");
    engine.resolveNight();
    engine.startSpeeches();
    return engine;
  }

  it("nominate adds the target to state.nominations and marks Player.isNominated", () => {
    const engine = inDay1Speeches();
    engine.nominate("p0", "p6");
    assert.deepStrictEqual([...engine.state.nominations], ["p6"]);
    assert.strictEqual(engine.state.players.get("p6")!.isNominated, true);
    assert.strictEqual(engine.state.players.get("p7")!.isNominated, false);
  });

  it("multiple nominations append in order", () => {
    const engine = inDay1Speeches();
    engine.nominate("p0", "p6");
    engine.nominate("p1", "p7");
    engine.nominate("p2", "p8");
    assert.deepStrictEqual([...engine.state.nominations], ["p6", "p7", "p8"]);
  });

  it("nominate rejects nominations for already-nominated players", () => {
    const engine = inDay1Speeches();
    engine.nominate("p0", "p6");
    assert.throws(() => engine.nominate("p1", "p6"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_ROLE;
    });
  });

  it("nominate rejects nominations for dead players", () => {
    const engine = inDay1Speeches();
    engine.state.players.get("p6")!.isAlive = false;
    assert.throws(() => engine.nominate("p0", "p6"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.PLAYER_DEAD;
    });
  });

  it("nominate rejects nominations by dead actors", () => {
    const engine = inDay1Speeches();
    engine.state.players.get("p0")!.isAlive = false;
    assert.throws(() => engine.nominate("p0", "p6"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.PLAYER_DEAD;
    });
  });

  it("nominate is rejected outside DAY_SPEECHES (Day 1 doesn't have BALAGAN)", () => {
    const state = freshState(10);
    const engine = new Engine(state);
    engine.startGame();
    assert.throws(() => engine.nominate("p0", "p4"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_PHASE;
    });
  });

  it("nominate is rejected during DAY_DEFENSE / DAY_VOTING", () => {
    const engine = inDay1Speeches();
    // Drive through all speeches → DAY_DEFENSE.
    const order = engine.getSpeakingOrder();
    for (let i = 0; i < order.length; i++) {
      engine.nextSpeaker();
    }
    assert.strictEqual(engine.state.phase, GamePhase.DAY_DEFENSE);
    assert.throws(() => engine.nominate("p0", "p6"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_PHASE;
    });
  });
});

describe("Engine — DAY_DEFENSE flow", () => {
  function inDay1Defense(): Engine {
    const state = freshState(10);
    const engine = new Engine(state);
    engine.startGame();
    engine._assignRoleForTest("p3", Role.DOCTOR);
    engine.mafiaKill("host", "p4");
    // Doctor saves p4 so all 10 players remain alive for the day-cycle
    // (speaking order, voting) — these tests need every seat available.
    engine.doctorHeal("p3", "p4");
    engine.resolveNight();
    engine.startSpeeches();
    engine.nominate("p0", "p6");
    engine.nominate("p1", "p8");
    const order = engine.getSpeakingOrder();
    for (let i = 0; i < order.length; i++) {
      engine.nextSpeaker();
    }
    // Engine should have auto-transitioned to DAY_DEFENSE.
    return engine;
  }

  it("defense order is the nominated players in speaking order", () => {
    const engine = inDay1Defense();
    assert.strictEqual(engine.state.phase, GamePhase.DAY_DEFENSE);
    // p6 < p8 in seatIndex order (both are alive, both nominated).
    assert.deepStrictEqual(engine.getDefenseOrder(), ["p6", "p8"]);
  });

  it("nextDefense advances and auto-transitions to DAY_VOTING when done", () => {
    const engine = inDay1Defense();
    assert.strictEqual(engine.getCurrentDefense(), "p6");
    engine.nextDefense();
    assert.strictEqual(engine.getCurrentDefense(), "p8");
    engine.nextDefense();
    assert.strictEqual(engine.getCurrentDefense(), "");
    assert.strictEqual(engine.state.phase, GamePhase.DAY_VOTING);
  });

  it("nextDefense is rejected outside DAY_DEFENSE", () => {
    const state = freshState(10);
    const engine = new Engine(state);
    engine.startGame();
    assert.throws(() => engine.nextDefense(), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_PHASE;
    });
  });

  it("DAY_DEFENSE with no nominations auto-transitions to DAY_VOTING on first nextDefense call", () => {
    const state = freshState(10);
    const engine = new Engine(state);
    engine.startGame();
    engine._assignRoleForTest("p3", Role.DOCTOR);
    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p3", "p5");
    engine.resolveNight();
    engine.startSpeeches();
    const order = engine.getSpeakingOrder();
    for (let i = 0; i < order.length; i++) {
      engine.nextSpeaker();
    }
    assert.strictEqual(engine.state.phase, GamePhase.DAY_DEFENSE);
    engine.nextDefense();
    assert.strictEqual(engine.state.phase, GamePhase.DAY_VOTING);
    assert.deepStrictEqual(engine.getDefenseOrder(), []);
  });
});

describe("Engine — voting", () => {
  function inDay1Voting(): Engine {
    const state = freshState(10);
    const engine = new Engine(state);
    engine.startGame();
    engine._assignRoleForTest("p3", Role.DOCTOR);
    engine.mafiaKill("host", "p4");
    // Doctor saves p4 so all 10 players remain alive for the day-cycle
    // (speaking order, voting) — these tests need every seat available.
    engine.doctorHeal("p3", "p4");
    engine.resolveNight();
    engine.startSpeeches();
    engine.nominate("p0", "p6");
    engine.nominate("p1", "p8");
    const order = engine.getSpeakingOrder();
    for (let i = 0; i < order.length; i++) {
      engine.nextSpeaker();
    }
    const dOrder = engine.getDefenseOrder();
    for (let i = 0; i < dOrder.length; i++) {
      engine.nextDefense();
    }
    return engine;
  }

  it("vote records the voter's choice for a nominated candidate", () => {
    const engine = inDay1Voting();
    engine.vote("p0", "p6");
    engine.vote("p1", "p8");
    engine.vote("p2", "p6");
    assert.strictEqual(engine.getVote("p0"), "p6");
    assert.strictEqual(engine.getVote("p1"), "p8");
    assert.strictEqual(engine.getVote("p2"), "p6");
    assert.strictEqual(engine.getVote("p3"), "");
  });

  it("vote rejects a target that is not nominated", () => {
    const engine = inDay1Voting();
    assert.throws(() => engine.vote("p0", "p7"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_ROLE;
    });
  });

  it("vote rejects a dead voter", () => {
    const engine = inDay1Voting();
    engine.state.players.get("p0")!.isAlive = false;
    assert.throws(() => engine.vote("p0", "p6"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.PLAYER_DEAD;
    });
  });

  it("vote rejects a dead target", () => {
    const engine = inDay1Voting();
    engine.state.players.get("p6")!.isAlive = false;
    assert.throws(() => engine.vote("p0", "p6"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.PLAYER_DEAD;
    });
  });

  it("vote is rejected outside DAY_VOTING", () => {
    const state = freshState(10);
    const engine = new Engine(state);
    engine.startGame();
    assert.throws(() => engine.vote("p0", "p4"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_PHASE;
    });
  });

  it("a voter can re-vote; only the latest choice counts", () => {
    const engine = inDay1Voting();
    engine.vote("p0", "p6");
    engine.vote("p0", "p8");
    assert.strictEqual(engine.getVote("p0"), "p8");
  });
});

describe("Engine — resolveVoting", () => {
  function inDay1Voting(): Engine {
    const state = freshState(10);
    const engine = new Engine(state);
    engine.startGame();
    engine._assignRoleForTest("p3", Role.DOCTOR);
    engine.mafiaKill("host", "p4");
    // Doctor saves p4 so all 10 players remain alive for the day-cycle
    // (speaking order, voting) — these tests need every seat available.
    engine.doctorHeal("p3", "p4");
    engine.resolveNight();
    engine.startSpeeches();
    engine.nominate("p0", "p6");
    engine.nominate("p1", "p8");
    const order = engine.getSpeakingOrder();
    for (let i = 0; i < order.length; i++) {
      engine.nextSpeaker();
    }
    const dOrder = engine.getDefenseOrder();
    for (let i = 0; i < dOrder.length; i++) {
      engine.nextDefense();
    }
    return engine;
  }

  it("highest-voted candidate is eliminated and marked dead", () => {
    const engine = inDay1Voting();
    // 6 votes for p6, 4 for p8.
    for (let i = 0; i < 6; i++) engine.vote(`p${i}`, "p6");
    for (let i = 6; i < 10; i++) engine.vote(`p${i}`, "p8");

    const res = engine.resolveVoting();
    assert.strictEqual(res.eliminatedId, "p6");
    assert.strictEqual(res.voteCounts.p6, 6);
    assert.strictEqual(res.voteCounts.p8, 4);
    assert.strictEqual(res.totalVotes, 10);

    assert.strictEqual(engine.state.players.get("p6")!.isAlive, false);
    assert.strictEqual(engine.state.players.get("p8")!.isAlive, true);
  });

  it("default vote: non-voters are assigned to the last speaker", () => {
    const engine = inDay1Voting();
    // Speaking order is p0, p1, ..., p9 — last speaker is p9.
    // Only p0 and p1 vote (for p6). The remaining 8 players default to p9.
    engine.vote("p0", "p6");
    engine.vote("p1", "p6");

    const res = engine.resolveVoting();
    assert.strictEqual(res.eliminatedId, "p9", "last speaker p9 wins by default");
    // p9 receives 8 default votes; p6 receives 2 explicit votes.
    assert.strictEqual(res.voteCounts.p9, 8);
    assert.strictEqual(res.voteCounts.p6, 2);
  });

  it("resolveVoting transitions engine to NIGHT (dayCount unchanged)", () => {
    const engine = inDay1Voting();
    for (let i = 0; i < 10; i++) engine.vote(`p${i}`, "p6");
    engine.resolveVoting();
    assert.strictEqual(engine.state.phase, GamePhase.NIGHT);
    assert.strictEqual(engine.state.nightStep, NightStep.MAFIA);
    // dayCount is unchanged — it represents "current day". After voting, we
    // transition to the next night; the next resolveNight will bump dayCount
    // to 2 when Day 2 starts.
    assert.strictEqual(engine.state.dayCount, 1);
  });

  it("onPlayerDied fires with the eliminated sessionId and VOTE_ELIMINATION cause", () => {
    const engine = inDay1Voting();
    let deadId = "";
    let cause: DeathCause | "" = "";
    engine.setOnPlayerDied((sessionId, c) => {
      deadId = sessionId;
      cause = c;
    });

    for (let i = 0; i < 10; i++) engine.vote(`p${i}`, "p8");
    engine.resolveVoting();

    assert.strictEqual(deadId, "p8");
    assert.strictEqual(cause, "VOTE_ELIMINATION");
  });

  it("onPlayerDied does not fire when there are no nominations", () => {
    const state = freshState(10);
    const engine = new Engine(state);
    engine.startGame();
    engine._assignRoleForTest("p3", Role.DOCTOR);
    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p3", "p5");
    engine.resolveNight();
    engine.startSpeeches();
    const order = engine.getSpeakingOrder();
    for (let i = 0; i < order.length; i++) {
      engine.nextSpeaker();
    }
    engine.nextDefense(); // → DAY_VOTING

    let fired = false;
    engine.setOnPlayerDied(() => {
      fired = true;
    });

    const res = engine.resolveVoting();
    assert.strictEqual(res.eliminatedId, "");
    assert.strictEqual(fired, false, "no callback when no one was eliminated");
    // Engine still transitions to NIGHT so the cycle can continue.
    assert.strictEqual(engine.state.phase, GamePhase.NIGHT);
  });

  it("Player.votes is written to the public schema after resolveVoting", () => {
    const engine = inDay1Voting();
    for (let i = 0; i < 7; i++) engine.vote(`p${i}`, "p6");
    for (let i = 7; i < 10; i++) engine.vote(`p${i}`, "p8");
    engine.resolveVoting();
    assert.strictEqual(engine.state.players.get("p6")!.votes, 7);
    assert.strictEqual(engine.state.players.get("p8")!.votes, 3);
  });

  it("resolveVoting clears the engine's per-vote buffer so a new round starts fresh", () => {
    const engine = inDay1Voting();
    for (let i = 0; i < 10; i++) engine.vote(`p${i}`, "p6");
    engine.resolveVoting();
    // After resolution the vote buffer is empty. A new vote would only succeed
    // when DAY_VOTING is reached again — but the engine is now in NIGHT, so
    // it's a phase error.
    assert.throws(() => engine.vote("p0", "p8"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_PHASE;
    });
  });

  it("resolveVoting is rejected outside DAY_VOTING", () => {
    const state = freshState(10);
    const engine = new Engine(state);
    engine.startGame();
    assert.throws(() => engine.resolveVoting(), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_PHASE;
    });
  });
});

// ─── Ticket 04: Phase timers + host overrides ───────────────────────

describe("PhaseTimer (pure)", () => {
  it("starts with the given duration, unpaused, no elapsed time", () => {
    const t = new PhaseTimer("MAFIA_WINDOW", 60_000, [30, 50], 0);
    assert.strictEqual(t.isPaused(), false);
    assert.strictEqual(t.remainingMs(0), 60_000);
    assert.strictEqual(t.elapsedMs(0), 0);
    assert.strictEqual(t.isExpired(0), false);
  });

  it("fires REMINDER events at the configured marks; remainingSeconds reflects time left at the mark", () => {
    const t = new PhaseTimer("MAFIA_WINDOW", 60_000, [30, 50], 0);
    const events = t.tick(30_000);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, "REMINDER");
    assert.strictEqual(events[0].mode, "MAFIA_WINDOW");
    assert.strictEqual(events[0].remainingSeconds, 30, "30s mark → 30s remaining");
  });

  it("fires both reminders in a single tick that crosses both marks", () => {
    const t = new PhaseTimer("MAFIA_WINDOW", 60_000, [30, 50], 0);
    const events = t.tick(50_000);
    assert.strictEqual(events.length, 2);
    assert.deepStrictEqual(events.map((e) => e.type), ["REMINDER", "REMINDER"]);
    assert.strictEqual((events[1] as { remainingSeconds: number }).remainingSeconds, 10);
  });

  it("fires EXPIRED when the timer crosses its duration; no further events fire after", () => {
    const t = new PhaseTimer("MAFIA_WINDOW", 60_000, [30, 50], 0);
    const events = t.tick(60_000);
    // At t=60s, both reminders have already fired and the timer has crossed
    // its 60s mark — 3 events in a single tick.
    assert.strictEqual(events.length, 3);
    assert.strictEqual(events[2].type, "EXPIRED");
    assert.strictEqual(events[2].mode, "MAFIA_WINDOW");
    assert.strictEqual(t.isExpired(60_000), true);

    // Subsequent ticks produce no further events.
    assert.deepStrictEqual(t.tick(120_000), []);
  });

  it("does not re-fire a reminder that has already fired (idempotent across ticks)", () => {
    const t = new PhaseTimer("MAFIA_WINDOW", 60_000, [30, 50], 0);
    const e1 = t.tick(30_000);
    assert.strictEqual(e1.length, 1);
    const e2 = t.tick(45_000);
    assert.strictEqual(e2.length, 0, "no reminder before the 50s mark");
    const e3 = t.tick(50_000);
    assert.strictEqual(e3.length, 1);
    assert.strictEqual(e3[0].type, "REMINDER");
  });

  it("pause freezes elapsed; resume continues counting from where it left off", () => {
    const t = new PhaseTimer("SPEECH_TURN", 60_000, [], 0);
    t.tick(20_000);
    t.pause(20_000);
    assert.strictEqual(t.isPaused(), true);
    assert.strictEqual(t.elapsedMs(20_000), 20_000);
    assert.strictEqual(t.remainingMs(20_000), 40_000);

    // While paused, ticking does not advance elapsed.
    t.tick(45_000);
    assert.strictEqual(t.elapsedMs(45_000), 20_000);

    // Resume picks up from the pause point.
    t.resume(45_000);
    assert.strictEqual(t.isPaused(), false);
    t.tick(60_000); // 15s of new elapsed → total 35s
    assert.strictEqual(t.elapsedMs(60_000), 35_000);
    assert.strictEqual(t.remainingMs(60_000), 25_000);
  });

  it("extend adds seconds to the remaining duration", () => {
    const t = new PhaseTimer("SPEECH_TURN", 60_000, [], 0);
    t.tick(10_000);
    t.extend(30);
    assert.strictEqual(t.remainingMs(10_000), 80_000);
    t.extend(15);
    assert.strictEqual(t.remainingMs(10_000), 95_000);
  });

  it("extend works while paused", () => {
    const t = new PhaseTimer("SPEECH_TURN", 60_000, [], 0);
    t.tick(10_000);
    t.pause(10_000);
    t.extend(30);
    assert.strictEqual(t.remainingMs(10_000), 80_000);
  });

  it("snapshot exposes the current mode, duration, remaining time, paused state", () => {
    const t = new PhaseTimer("DEFENSE_TURN", 30_000, [], 0);
    t.tick(5_000);
    t.pause(5_000);
    const snap = t.snapshot();
    assert.strictEqual(snap.mode, "DEFENSE_TURN");
    assert.strictEqual(snap.durationMs, 30_000);
    assert.strictEqual(snap.remainingMs, 25_000);
    assert.strictEqual(snap.paused, true);
  });

  it("a no-time tick returns no events", () => {
    const t = new PhaseTimer("SPEECH_TURN", 60_000, [], 0);
    assert.deepStrictEqual(t.tick(0), []);
  });
});

describe("Engine — phase-timer lifecycle", () => {
  /** Build an engine with a fake clock so tests can advance time deterministically. */
  function withFakeClock(): { state: MafiaState; engine: Engine; now: { value: number } } {
    const state = freshState(10);
    const now = { value: 0 };
    const engine = new Engine(state, () => now.value);
    return { state, engine, now };
  }

  it("startGame arms the MAFIA_WINDOW timer with 60s and 30s/50s reminders", () => {
    const { engine, now } = withFakeClock();
    engine.startGame();
    const snap = engine.getPhaseTimer();
    assert.ok(snap, "mafia window timer should be active");
    assert.strictEqual(snap!.mode, "MAFIA_WINDOW");
    assert.strictEqual(snap!.durationMs, 60_000);
    assert.strictEqual(snap!.remainingMs, 60_000);
    assert.strictEqual(snap!.paused, false);

    now.value = 30_000;
    const events = engine.tickPhaseTimer();
    const reminders = events.filter((e) => e.type === "REMINDER");
    assert.strictEqual(reminders.length, 1);
    assert.strictEqual(reminders[0].mode, "MAFIA_WINDOW");
    assert.strictEqual(reminders[0].remainingSeconds, 30);
  });

  it("mafiaKill clears the MAFIA_WINDOW timer", () => {
    const { engine } = withFakeClock();
    engine.startGame();
    engine._assignRoleForTest("p3", Role.DOCTOR);
    assert.ok(engine.getPhaseTimer(), "timer started by startGame");
    engine.mafiaKill("host", "p4");
    assert.strictEqual(engine.getPhaseTimer(), null, "timer cleared once a victim is submitted");
  });

  it("resolveNight clears the timer", () => {
    const { engine } = withFakeClock();
    engine.startGame();
    engine._assignRoleForTest("p3", Role.DOCTOR);
    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p3", "p4");
    engine.resolveNight();
    assert.strictEqual(engine.getPhaseTimer(), null, "no timer in DAY_ANNOUNCEMENT");
  });

  it("startSpeeches arms a 60s SPEECH_TURN timer", () => {
    const { engine } = withFakeClock();
    engine.startGame();
    engine._assignRoleForTest("p3", Role.DOCTOR);
    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p3", "p4");
    engine.resolveNight();
    engine.startSpeeches();

    const snap = engine.getPhaseTimer();
    assert.ok(snap);
    assert.strictEqual(snap!.mode, "SPEECH_TURN");
    assert.strictEqual(snap!.durationMs, 60_000);
  });

  it("nextSpeaker restarts the SPEECH_TURN timer for the next speaker", () => {
    const { engine, now } = withFakeClock();
    engine.startGame();
    engine._assignRoleForTest("p3", Role.DOCTOR);
    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p3", "p4");
    engine.resolveNight();
    engine.startSpeeches();
    // Burn 30s of the first speaker's window.
    now.value = 30_000;
    engine.tickPhaseTimer();
    // Advance to the next speaker — timer should restart fresh.
    engine.nextSpeaker();
    const snap = engine.getPhaseTimer();
    assert.strictEqual(snap!.mode, "SPEECH_TURN");
    assert.strictEqual(snap!.remainingMs, 60_000, "next speaker gets a fresh 60s window");
  });

  it("nextSpeaker clears the timer when it auto-transitions to DAY_DEFENSE", () => {
    const { engine } = withFakeClock();
    engine.startGame();
    engine._assignRoleForTest("p3", Role.DOCTOR);
    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p3", "p4");
    engine.resolveNight();
    engine.startSpeeches();
    // Nominate someone so the defense order is non-empty and the defense
    // timer arms on entry.
    engine.nominate("p0", "p6");
    // Drive through every speaker — the last nextSpeaker auto-transitions.
    for (let i = 0; i < 10; i++) engine.nextSpeaker();
    // Defense begins with its own timer; not cleared. Just verify mode flipped.
    const snap = engine.getPhaseTimer();
    assert.ok(snap, "DEFENSE timer armed on entry");
    assert.strictEqual(snap!.mode, "DEFENSE_TURN");
  });

  it("enterDayDefense arms a 30s DEFENSE_TURN timer", () => {
    const { engine } = withFakeClock();
    engine.startGame();
    engine._assignRoleForTest("p3", Role.DOCTOR);
    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p3", "p4");
    engine.resolveNight();
    engine.startSpeeches();
    engine.nominate("p0", "p6");
    engine.nextSpeaker(); // → DAY_DEFENSE via cascade (only 10 speakers; on last call)
    // Drive all the way through to DAY_DEFENSE explicitly:
    while (engine.state.phase !== GamePhase.DAY_DEFENSE) engine.nextSpeaker();

    const snap = engine.getPhaseTimer();
    assert.strictEqual(snap!.mode, "DEFENSE_TURN");
    assert.strictEqual(snap!.durationMs, 30_000);
  });

  it("nextDefense restarts the DEFENSE_TURN timer for the next candidate", () => {
    const { engine, now } = withFakeClock();
    engine.startGame();
    engine._assignRoleForTest("p3", Role.DOCTOR);
    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p3", "p4");
    engine.resolveNight();
    engine.startSpeeches();
    engine.nominate("p0", "p6");
    engine.nominate("p1", "p8");
    while (engine.state.phase !== GamePhase.DAY_DEFENSE) engine.nextSpeaker();

    // Burn 15s of the first defender's window.
    now.value = 15_000;
    engine.tickPhaseTimer();
    engine.nextDefense();
    const snap = engine.getPhaseTimer();
    assert.strictEqual(snap!.mode, "DEFENSE_TURN");
    assert.strictEqual(snap!.remainingMs, 30_000, "next defender gets a fresh 30s window");
  });

  it("DAY_VOTING has no timer", () => {
    const { engine } = withFakeClock();
    engine.startGame();
    engine._assignRoleForTest("p3", Role.DOCTOR);
    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p3", "p4");
    engine.resolveNight();
    engine.startSpeeches();
    engine.nominate("p0", "p6");
    while (engine.state.phase !== GamePhase.DAY_DEFENSE) engine.nextSpeaker();
    while (engine.state.phase !== GamePhase.DAY_VOTING) engine.nextDefense();
    assert.strictEqual(engine.getPhaseTimer(), null, "no timer in DAY_VOTING");
  });
});

describe("Engine — phase-timer expiry reactions", () => {
  /** Drive the engine through the night + day-1 speech round, returning the
   * engine positioned at DAY_SPEECHES with a SPEECH_TURN timer armed. */
  function inDay1Speeches(): { state: MafiaState; engine: Engine; now: { value: number } } {
    const state = freshState(10);
    const now = { value: 0 };
    const engine = new Engine(state, () => now.value);
    engine.startGame();
    engine._assignRoleForTest("p3", Role.DOCTOR);
    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p3", "p4");
    engine.resolveNight();
    engine.startSpeeches();
    return { state, engine, now };
  }

  it("SPEECH_TURN expiry auto-advances to the next speaker via nextSpeaker", () => {
    const { engine, now } = inDay1Speeches();
    const first = engine.getCurrentSpeaker();
    now.value = 60_000;
    const events = engine.tickPhaseTimer();
    assert.ok(events.some((e) => e.type === "EXPIRED" && e.mode === "SPEECH_TURN"));
    assert.notStrictEqual(engine.getCurrentSpeaker(), first, "speaker advanced after expiry");
    assert.strictEqual(engine.getPhaseTimer()!.mode, "SPEECH_TURN", "new speaker gets a fresh timer");
  });

  it("SPEECH_TURN expiry cascades through the round and into DAY_DEFENSE", () => {
    const { engine, now } = inDay1Speeches();
    // Nominate someone so the defense order is non-empty and the defense
    // timer arms when the round auto-transitions.
    engine.nominate("p0", "p6");
    // Each tick fires one EXPIRED (one transition). The room's setInterval
    // drives ticks every 250ms in production; here we drive 10 ticks at
    // 60s+1ms intervals to simulate the cascading through all speakers.
    for (let i = 0; i < 10; i++) {
      now.value = (i + 1) * 60_000 + 1;
      engine.tickPhaseTimer();
    }
    // After 10 ticks, every speaker has advanced; the engine should be in
    // DAY_DEFENSE with the per-turn defense timer armed.
    assert.strictEqual(engine.state.phase, GamePhase.DAY_DEFENSE);
    assert.strictEqual(engine.getPhaseTimer()!.mode, "DEFENSE_TURN");
  });

  it("MAFIA_WINDOW expiry pauses the phase (does NOT auto-advance)", () => {
    const state = freshState(10);
    const now = { value: 0 };
    const engine = new Engine(state, () => now.value);
    engine.startGame();

    now.value = 60_000;
    const events = engine.tickPhaseTimer();
    assert.ok(events.some((e) => e.type === "EXPIRED" && e.mode === "MAFIA_WINDOW"));

    const snap = engine.getPhaseTimer();
    assert.ok(snap, "timer is kept around in paused state");
    assert.strictEqual(snap!.paused, true, "mafia window expired into paused");
    assert.strictEqual(engine.state.phase, GamePhase.NIGHT, "phase did not auto-advance");
    assert.strictEqual(engine.state.nightStep, NightStep.MAFIA);
  });
});

describe("Engine — host phase overrides", () => {
  function startNight(): { state: MafiaState; engine: Engine; now: { value: number } } {
    const state = freshState(10);
    const now = { value: 0 };
    const engine = new Engine(state, () => now.value);
    engine.startGame();
    return { state, engine, now };
  }

  function startDay1Speeches(): { state: MafiaState; engine: Engine; now: { value: number } } {
    const { state } = startNight();
    const now = { value: 0 };
    const engine = new Engine(state, () => now.value);
    // startNight() already called startGame on the first engine — rebuild on
    // a fresh engine so the helper below can drive a full day-1 cycle.
    engine._assignRoleForTest("p3", Role.DOCTOR);
    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p3", "p4");
    engine.resolveNight();
    engine.startSpeeches();
    return { state, engine, now };
  }

  it("pausePhase marks the active timer as paused and logs a PHASE_OVERRIDE entry", () => {
    const { engine, now } = startNight();
    now.value = 10_000;
    engine.pausePhase("host");
    const snap = engine.getPhaseTimer();
    assert.strictEqual(snap!.paused, true);

    const lastLog = engine.getActionLog().at(-1)!;
    assert.strictEqual(lastLog.type, "PHASE_OVERRIDE");
    assert.strictEqual((lastLog.payload as { event: string }).event, "pause");
  });

  it("resumePhase unpauses; resume after mafia-window expiry re-arms a fresh window", () => {
    const { engine, now } = startNight();
    now.value = 60_000;
    engine.tickPhaseTimer(); // expired into paused
    assert.strictEqual(engine.getPhaseTimer()!.paused, true);

    now.value = 60_500;
    engine.resumePhase("host");
    const snap = engine.getPhaseTimer();
    assert.strictEqual(snap!.paused, false);
    assert.strictEqual(snap!.mode, "MAFIA_WINDOW");
    assert.strictEqual(snap!.remainingMs, 60_000, "fresh 60s window after resume");
  });

  it("resumePhase is a no-op when there is no timer", () => {
    const { engine } = startNight();
    // Resolve the night so the mafia window timer clears.
    engine._assignRoleForTest("p3", Role.DOCTOR);
    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p3", "p4");
    engine.resolveNight();
    assert.strictEqual(engine.getPhaseTimer(), null);
    engine.resumePhase("host"); // does not throw
    assert.strictEqual(engine.getPhaseTimer(), null);
  });

  it("skipPhase on SPEECH_TURN advances to the next speaker (same as nextSpeaker)", () => {
    const { engine } = startDay1Speeches();
    const first = engine.getCurrentSpeaker();
    engine.skipPhase("host");
    assert.notStrictEqual(engine.getCurrentSpeaker(), first);
    assert.strictEqual(engine.getPhaseTimer()!.mode, "SPEECH_TURN");

    const lastLog = engine.getActionLog().at(-1)!;
    assert.strictEqual(lastLog.type, "PHASE_OVERRIDE");
    assert.strictEqual((lastLog.payload as { event: string }).event, "skip");
  });

  it("skipPhase on DEFENSE_TURN advances to the next defender", () => {
    const { engine } = startDay1Speeches();
    engine.nominate("p0", "p6");
    engine.nominate("p1", "p8");
    while (engine.state.phase !== GamePhase.DAY_DEFENSE) engine.nextSpeaker();
    const first = engine.getCurrentDefense();
    engine.skipPhase("host");
    assert.notStrictEqual(engine.getCurrentDefense(), first);
    assert.strictEqual(engine.getPhaseTimer()!.mode, "DEFENSE_TURN");
  });

  it("skipPhase on MAFIA_WINDOW is a no-op (there's no phase to jump to inside NIGHT step MAFIA)", () => {
    const { engine } = startNight();
    engine.skipPhase("host");
    assert.strictEqual(engine.state.phase, GamePhase.NIGHT);
    assert.strictEqual(engine.state.nightStep, NightStep.MAFIA);
  });

  it("extendPhase adds N seconds to the active timer", () => {
    const { engine, now } = startDay1Speeches();
    now.value = 10_000;
    engine.tickPhaseTimer();
    const before = engine.getPhaseTimer()!.remainingMs;
    engine.extendPhase("host", 30);
    assert.strictEqual(engine.getPhaseTimer()!.remainingMs, before + 30_000);
  });

  it("extendPhase is a no-op when there is no active timer", () => {
    const { engine } = startNight();
    // No timer in DAY_ANNOUNCEMENT (we don't set one); but right now we're in
    // NIGHT with a mafia window. After we submit a kill, no timer.
    engine._assignRoleForTest("p3", Role.DOCTOR);
    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p3", "p4");
    engine.resolveNight();
    assert.strictEqual(engine.getPhaseTimer(), null);
    engine.extendPhase("host", 30); // does not throw
    assert.strictEqual(engine.getPhaseTimer(), null);
  });

  it("pause / resume / skip / extend all reject a non-host actor", () => {
    const { engine } = startNight();
    assert.throws(() => engine.pausePhase("p0"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.NOT_HOST;
    });
    assert.throws(() => engine.resumePhase("p0"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.NOT_HOST;
    });
    assert.throws(() => engine.skipPhase("p0"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.NOT_HOST;
    });
    assert.throws(() => engine.extendPhase("p0", 10), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.NOT_HOST;
    });
  });

  it("tickPhaseTimer returns an empty array when no timer is active", () => {
    const { engine } = startNight();
    engine._assignRoleForTest("p3", Role.DOCTOR);
    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p3", "p4");
    engine.resolveNight();
    assert.deepStrictEqual(engine.tickPhaseTimer(), []);
  });
});

describe("Engine — disconnect pause + declareDead (ticket 05)", () => {
  /** Start a fresh night so a MAFIA_WINDOW timer is armed. */
  function startNight(): { state: MafiaState; engine: Engine; now: { value: number } } {
    const state = freshState(10);
    const now = { value: 0 };
    const engine = new Engine(state, () => now.value);
    engine.startGame();
    return { state, engine, now };
  }

  /** Drive the engine through a full day cycle so it is at DAY_VOTING with no timer. */
  function inDay1Voting(): { state: MafiaState; engine: Engine; now: { value: number } } {
    const { state } = startNight();
    const now = { value: 0 };
    const engine = new Engine(state, () => now.value);
    engine._assignRoleForTest("p3", Role.DOCTOR);
    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p3", "p4");
    engine.resolveNight();
    engine.startSpeeches();
    engine.nominate("p0", "p6");
    while (engine.state.phase !== GamePhase.DAY_DEFENSE) engine.nextSpeaker();
    while (engine.state.phase !== GamePhase.DAY_VOTING) engine.nextDefense();
    return { state, engine, now };
  }

  it("pauseForMissing marks the player missing and pauses the active timer", () => {
    const { engine, state } = startNight();
    assert.strictEqual(state.players.get("p3")!.isMissing, false);

    const result = engine.pauseForMissing("p3");

    assert.strictEqual(result, true, "first call returns true (state changed)");
    assert.strictEqual(state.players.get("p3")!.isMissing, true, "schema flag flipped");
    assert.strictEqual(engine.getPhaseTimer()!.paused, true, "active timer paused");
    assert.deepStrictEqual(engine.getMissingPlayers(), ["p3"]);
  });

  it("pauseForMissing emits a PLAYER_MISSING entry in the host action log", () => {
    const { engine } = startNight();
    engine.pauseForMissing("p3");

    const lastLog = engine.getActionLog().at(-1)!;
    assert.strictEqual(lastLog.type, "PLAYER_MISSING");
    assert.strictEqual((lastLog.payload as { sessionId: string }).sessionId, "p3");
  });

  it("pauseForMissing is idempotent — second call returns false and does not re-log", () => {
    const { engine } = startNight();
    assert.strictEqual(engine.pauseForMissing("p3"), true);
    const logLenAfterFirst = engine.getActionLog().length;

    assert.strictEqual(engine.pauseForMissing("p3"), false, "second call is a no-op");
    assert.strictEqual(engine.getActionLog().length, logLenAfterFirst, "no duplicate log entry");
  });

  it("pauseForMissing returns false in LOBBY (no live phase to pause)", () => {
    const state = freshState(10);
    const engine = new Engine(state);
    assert.strictEqual(state.phase, GamePhase.LOBBY);

    const result = engine.pauseForMissing("p3");

    assert.strictEqual(result, false);
    assert.strictEqual(state.players.get("p3")!.isMissing, false);
    assert.strictEqual(engine.getMissingPlayers().length, 0);
  });

  it("pauseForMissing returns false for a player who is not at the table", () => {
    const { engine } = startNight();
    assert.strictEqual(engine.pauseForMissing("ghost"), false);
    assert.strictEqual(engine.getMissingPlayers().length, 0);
  });

  it("pauseForMissing returns false for an already-dead player", () => {
    const { engine, state } = startNight();
    state.players.get("p3")!.isAlive = false;
    assert.strictEqual(engine.pauseForMissing("p3"), false);
    assert.strictEqual(state.players.get("p3")!.isMissing, false);
  });

  it("clearMissing clears the flag and resumes the timer (player reconnected within grace)", () => {
    const { engine, state } = startNight();
    engine.pauseForMissing("p3");
    assert.strictEqual(engine.getPhaseTimer()!.paused, true);

    const result = engine.clearMissing("p3");

    assert.strictEqual(result, true);
    assert.strictEqual(state.players.get("p3")!.isMissing, false);
    assert.strictEqual(engine.getMissingPlayers().length, 0);
    // MAFIA_WINDOW resumes into a fresh 60s nudge cycle (matches resumePhase).
    const snap = engine.getPhaseTimer();
    assert.ok(snap, "timer still armed after reconnect");
    assert.strictEqual(snap!.paused, false);
    assert.strictEqual(snap!.mode, "MAFIA_WINDOW");
    assert.strictEqual(snap!.remainingMs, 60_000);
  });

  it("clearMissing emits a PLAYER_RETURNED entry in the host action log", () => {
    const { engine } = startNight();
    engine.pauseForMissing("p3");
    engine.clearMissing("p3");

    const lastLog = engine.getActionLog().at(-1)!;
    assert.strictEqual(lastLog.type, "PLAYER_RETURNED");
    assert.strictEqual((lastLog.payload as { sessionId: string }).sessionId, "p3");
  });

  it("clearMissing is a no-op when the player was never missing", () => {
    const { engine } = startNight();
    assert.strictEqual(engine.clearMissing("p3"), false);
    assert.strictEqual(engine.getMissingPlayers().length, 0);
  });

  it("declareDead requires host", () => {
    const { engine } = startNight();
    engine.pauseForMissing("p3");
    assert.throws(() => engine.declareDead("p0", "p3"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.NOT_HOST;
    });
  });

  it("declareDead rejects a player who is not missing", () => {
    const { engine } = startNight();
    assert.throws(() => engine.declareDead("host", "p3"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_ROLE;
    });
  });

  it("declareDead rejects a player not at the table", () => {
    const { engine } = startNight();
    // Pause for a known missing player first so the missing-set check passes
    // and the engine falls through to the table check.
    engine.pauseForMissing("p3");
    // Remove them from the schema (e.g. onLeave fired first in some edge case).
    engine.state.players.delete("p3");

    assert.throws(() => engine.declareDead("host", "p3"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.PLAYER_MISSING;
    });
  });

  it("declareDead marks the missing player dead and fires onPlayerDied with DECLARED_DEAD", () => {
    const { engine, state } = startNight();
    engine.pauseForMissing("p3");

    let deadId = "";
    let cause: string = "";
    engine.setOnPlayerDied((id, c) => {
      deadId = id;
      cause = c;
    });

    engine.declareDead("host", "p3");

    assert.strictEqual(state.players.get("p3")!.isAlive, false, "schema isAlive = false");
    assert.strictEqual(state.players.get("p3")!.isMissing, false, "isMissing cleared");
    assert.strictEqual(deadId, "p3");
    assert.strictEqual(cause, "DECLARED_DEAD", "seam fired with DECLARED_DEAD cause");
  });

  it("declareDead resumes the MAFIA_WINDOW into a fresh 60s nudge cycle", () => {
    const { engine } = startNight();
    engine.pauseForMissing("p3");
    assert.strictEqual(engine.getPhaseTimer()!.paused, true);

    engine.declareDead("host", "p3");

    const snap = engine.getPhaseTimer();
    assert.ok(snap, "timer re-armed after declareDead");
    assert.strictEqual(snap!.paused, false);
    assert.strictEqual(snap!.mode, "MAFIA_WINDOW");
    assert.strictEqual(snap!.remainingMs, 60_000, "fresh 60s window");
  });

  it("declareDead resumes a SPEECH_TURN timer from the pause point", () => {
    const { engine, now } = startNight();
    engine._assignRoleForTest("p3", Role.DOCTOR);
    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p3", "p4");
    engine.resolveNight();
    engine.startSpeeches();
    // Advance 20s, pause for missing, assert resume picks up where it left off.
    now.value = 20_000;
    engine.tickPhaseTimer();
    const beforePause = engine.getPhaseTimer()!.remainingMs;
    assert.strictEqual(beforePause, 40_000, "20s elapsed of 60s speech");

    engine.pauseForMissing("p5");
    assert.strictEqual(engine.getPhaseTimer()!.paused, true);

    // Time keeps moving while paused — the pause point freezes elapsed, so
    // resume should land at the same remainingMs as beforePause.
    now.value = 25_000;
    engine.declareDead("host", "p5");

    const after = engine.getPhaseTimer();
    assert.ok(after);
    assert.strictEqual(after!.paused, false);
    assert.strictEqual(after!.mode, "SPEECH_TURN");
    assert.strictEqual(after!.remainingMs, beforePause, "resume picks up from pause point");
  });

  it("declareDead removes the player from the missing set so a later clearMissing is a no-op", () => {
    const { engine } = startNight();
    engine.pauseForMissing("p3");
    engine.declareDead("host", "p3");
    assert.strictEqual(engine.getMissingPlayers().length, 0);

    assert.strictEqual(engine.clearMissing("p3"), false, "nothing left to clear");
  });

  it("declareDead emits a DEAD_DECLARED entry in the host action log with the actor", () => {
    const { engine } = startNight();
    engine.pauseForMissing("p3");
    engine.declareDead("host", "p3");

    const lastLog = engine.getActionLog().at(-1)!;
    assert.strictEqual(lastLog.type, "DEAD_DECLARED");
    assert.strictEqual(lastLog.actorSessionId, "host");
    assert.strictEqual((lastLog.payload as { sessionId: string }).sessionId, "p3");
  });

  it("a declared-dead player cannot perform actions (requireAlivePlayer rejects)", () => {
    const { engine, state } = startNight();
    engine.pauseForMissing("p3");
    engine.declareDead("host", "p3");
    assert.strictEqual(state.players.get("p3")!.isAlive, false);

    // Drive into DAY_VOTING where `vote` is the natural action — it already
    // calls `requireAlivePlayer(actorSessionId)`, which is the same dead-guard
    // any post-declareDead action will trip. The Doctor must be someone other
    // than p3: a dead role-holder can no longer heal (ticket 06 actor guard).
    engine._assignRoleForTest("p8", Role.DOCTOR);
    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p8", "p4");
    engine.resolveNight();
    engine.startSpeeches();
    engine.nominate("p0", "p6");
    while (engine.state.phase !== GamePhase.DAY_DEFENSE) engine.nextSpeaker();
    while (engine.state.phase !== GamePhase.DAY_VOTING) engine.nextDefense();
    assert.strictEqual(engine.state.phase, GamePhase.DAY_VOTING);

    assert.throws(() => engine.vote("p3", "p6"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.PLAYER_DEAD;
    });
  });

  it("declareDead fires the seam BEFORE resuming the timer (so victory checks see post-death state)", () => {
    const { engine, state } = startNight();
    engine.pauseForMissing("p3");

    let aliveAtSeamFire: boolean | undefined;
    let timerPausedAtSeamFire: boolean | undefined;
    engine.setOnPlayerDied(() => {
      aliveAtSeamFire = state.players.get("p3")!.isAlive;
      timerPausedAtSeamFire = engine.getPhaseTimer()!.paused;
    });

    engine.declareDead("host", "p3");

    assert.strictEqual(aliveAtSeamFire, false, "isAlive was already cleared at seam time");
    assert.strictEqual(timerPausedAtSeamFire, true, "timer was still paused at seam time");
  });

  it("clearMissing on a non-paused timer is a no-op (do not re-arm an already-running window)", () => {
    // Start night, no one is missing, no timer is paused — clearMissing
    // must not affect the running MAFIA_WINDOW.
    const { engine } = startNight();
    const snapBefore = engine.getPhaseTimer();
    assert.ok(snapBefore && !snapBefore.paused);

    assert.strictEqual(engine.clearMissing("nobody"), false);
    const snapAfter = engine.getPhaseTimer();
    assert.strictEqual(snapAfter!.remainingMs, snapBefore!.remainingMs);
  });

  it("full disconnect-then-declareDead flow during DAY_VOTING (no timer) just marks dead", () => {
    // A drop in DAY_VOTING has no timer to pause/resume, but the dead flag
    // still flips and the seam still fires.
    const { engine, state } = inDay1Voting();
    const before = engine.getPhaseTimer();
    assert.strictEqual(before, null, "no timer in DAY_VOTING");

    let fired = false;
    engine.setOnPlayerDied((id, cause) => {
      fired = true;
      assert.strictEqual(id, "p3");
      assert.strictEqual(cause, "DECLARED_DEAD");
    });

    engine.pauseForMissing("p3");
    engine.declareDead("host", "p3");

    assert.strictEqual(state.players.get("p3")!.isAlive, false);
    assert.strictEqual(fired, true);
    assert.strictEqual(engine.getPhaseTimer(), null, "no timer was armed");
  });
});

// ─── Ticket 06: Kick + foul ─────────────────────────────────────────────

describe("Engine — kick + foul (ticket 06)", () => {
  /** Fresh game in NIGHT with deterministic roles: p0=DON, p1=MAFIA,
   *  p2=SHERIFF, p3=DOCTOR, p4..p9=CIVILIAN. */
  function setupGame(): { state: MafiaState; engine: Engine } {
    const state = freshState(10);
    const engine = new Engine(state);
    engine.startGame();
    engine._assignRoleForTest("p0", Role.DON);
    engine._assignRoleForTest("p1", Role.MAFIA);
    engine._assignRoleForTest("p2", Role.SHERIFF);
    engine._assignRoleForTest("p3", Role.DOCTOR);
    for (let i = 4; i < 10; i++) {
      engine._assignRoleForTest(`p${i}`, Role.CIVILIAN);
    }
    return { state, engine };
  }

  describe("kick", () => {
    it("marks the player dead and holds their seat in state.players", () => {
      const { state, engine } = setupGame();
      const seatBefore = state.players.get("p4")!.seatIndex;

      engine.kick("host", "p4", "showing a role card");

      assert.strictEqual(state.players.get("p4")!.isAlive, false);
      assert.ok(state.players.has("p4"), "kicked player stays in state.players");
      assert.strictEqual(state.players.get("p4")!.seatIndex, seatBefore, "seat is held");
      assert.strictEqual(engine.getRole("p4"), Role.CIVILIAN, "role identity preserved (still sealed)");
    });

    it("fires onPlayerDied with the KICKED cause", () => {
      const { engine } = setupGame();

      let deadId = "";
      let cause: string = "";
      engine.setOnPlayerDied((id, c) => {
        deadId = id;
        cause = c;
      });

      engine.kick("host", "p4", "showing a role card");

      assert.strictEqual(deadId, "p4");
      assert.strictEqual(cause, "KICKED");
    });

    it("logs a KICK entry with actor, target and reason", () => {
      const { engine } = setupGame();
      engine.kick("host", "p4", "showing a role card");

      const lastLog = engine.getActionLog().at(-1)!;
      assert.strictEqual(lastLog.type, "KICK");
      assert.strictEqual(lastLog.actorSessionId, "host");
      assert.strictEqual((lastLog.payload as { sessionId: string }).sessionId, "p4");
      assert.strictEqual((lastLog.payload as { reason: string }).reason, "showing a role card");
    });

    it("kicked player cannot act: donCheck, doctorHeal and ping all rejected with PLAYER_DEAD", () => {
      const { engine } = setupGame();
      engine.kick("host", "p0", "leaving");
      engine.kick("host", "p3", "leaving");

      assert.throws(() => engine.donCheck("p0", "p4"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.PLAYER_DEAD;
      });
      assert.throws(() => engine.doctorHeal("p3", "p5"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.PLAYER_DEAD;
      });
      assert.throws(() => engine.ping("p0", "p1"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.PLAYER_DEAD;
      });
    });

    it("rejects a non-host caller and leaves the target alive", () => {
      const { state, engine } = setupGame();
      assert.throws(() => engine.kick("p0", "p4", "mutiny"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.NOT_HOST;
      });
      assert.strictEqual(state.players.get("p4")!.isAlive, true);
    });

    it("rejects a target that is not at the table", () => {
      const { engine } = setupGame();
      assert.throws(() => engine.kick("host", "ghost", "boo"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.PLAYER_MISSING;
      });
    });

    it("rejects kicking the host", () => {
      const { state, engine } = setupGame();
      assert.throws(() => engine.kick("host", "host", "self-moderation"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.WRONG_ROLE;
      });
      assert.strictEqual(state.players.get("host")!.isAlive, true);
    });

    it("rejects an already-dead target", () => {
      const { engine } = setupGame();
      engine.kick("host", "p4", "first offence");
      assert.throws(() => engine.kick("host", "p4", "second offence"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.PLAYER_DEAD;
      });
    });

    it("is rejected in LOBBY (no game to be ejected from)", () => {
      const state = freshState(10);
      const engine = new Engine(state);
      assert.throws(() => engine.kick("host", "p0", "too early"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.WRONG_PHASE;
      });
      assert.strictEqual(state.players.get("p0")!.isAlive, true);
    });

    it("is rejected in GAME_OVER", () => {
      const { state, engine } = setupGame();
      state.phase = GamePhase.GAME_OVER;
      assert.throws(() => engine.kick("host", "p4", "too late"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.WRONG_PHASE;
      });
      assert.strictEqual(state.players.get("p4")!.isAlive, true);
    });

    it("is moderation, not phase-flow: phase, nightStep and timer are untouched", () => {
      const now = { value: 0 };
      const state = freshState(10);
      const engine = new Engine(state, () => now.value);
      engine.startGame();

      engine.kick("host", "p4", "showing a role card");

      assert.strictEqual(state.phase, GamePhase.NIGHT);
      assert.strictEqual(state.nightStep, NightStep.MAFIA);
      const snap = engine.getPhaseTimer();
      assert.ok(snap, "mafia window still armed");
      assert.strictEqual(snap!.mode, "MAFIA_WINDOW");
      assert.strictEqual(snap!.paused, false, "timer was not paused by the kick");
    });
  });

  describe("foul", () => {
    it("logs a FOUL entry and leaves the player's game state untouched", () => {
      const { state, engine } = setupGame();

      let seamFired = false;
      engine.setOnPlayerDied(() => {
        seamFired = true;
      });

      const before = state.players.get("p4")!;
      engine.foul("host", "p4", "flood-pinging");

      assert.strictEqual(before.isAlive, true, "foul does not kill");
      assert.strictEqual(before.votes, 0, "no state change");
      assert.strictEqual(seamFired, false, "no death seam for a foul");

      const lastLog = engine.getActionLog().at(-1)!;
      assert.strictEqual(lastLog.type, "FOUL");
      assert.strictEqual(lastLog.actorSessionId, "host");
      assert.strictEqual((lastLog.payload as { sessionId: string }).sessionId, "p4");
      assert.strictEqual((lastLog.payload as { reason: string }).reason, "flood-pinging");
    });

    it("can be issued against a dead player (a warning is informational)", () => {
      const { state, engine } = setupGame();
      state.players.get("p4")!.isAlive = false;

      engine.foul("host", "p4", "bad manners after death");

      const lastLog = engine.getActionLog().at(-1)!;
      assert.strictEqual(lastLog.type, "FOUL");
      assert.strictEqual((lastLog.payload as { sessionId: string }).sessionId, "p4");
    });

    it("works in any phase, including LOBBY", () => {
      const state = freshState(10);
      const engine = new Engine(state);
      assert.strictEqual(state.phase, GamePhase.LOBBY);

      engine.foul("host", "p0", "spam before the game");

      const lastLog = engine.getActionLog().at(-1)!;
      assert.strictEqual(lastLog.type, "FOUL");
      assert.strictEqual(lastLog.phase, GamePhase.LOBBY);
    });

    it("rejects a non-host caller", () => {
      const { engine } = setupGame();
      assert.throws(() => engine.foul("p0", "p4", "mutiny"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.NOT_HOST;
      });
    });

    it("rejects a target that is not at the table", () => {
      const { engine } = setupGame();
      assert.throws(() => engine.foul("host", "ghost", "boo"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.PLAYER_MISSING;
      });
    });
  });
});
