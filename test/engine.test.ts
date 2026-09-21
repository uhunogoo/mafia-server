import assert from "assert";
import { MafiaState, Player } from "../src/rooms/schema/MafiaState.js";
import { GamePhase, NightStep, Role, Team } from "../src/rooms/schema/enums.js";
import { Engine } from "../src/game/Engine.js";
import { PhaseTimer } from "../src/game/PhaseTimer.js";
import { EngineErrorCode, type DeathCause, type GameOverResult } from "../src/game/types.js";

/**
 * Helper: build a fresh MafiaState populated with `count` non-host players
 * (plus an optional host) and return both. Players are keyed by deterministic
 * sessionIds "p0"…"pN-1" so tests can target them directly.
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

describe("Engine — role assignment", () => {
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

describe("Engine — public schema secrecy", () => {
  it("Player schema has no role/team fields", () => {
    const p = new Player();
    // Public Player exposes: sessionId, seatIndex, name, isAlive, isHost,
    // isNominated, votes — and crucially NOT role/team.
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

describe("Engine — night actions", () => {
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

describe("Engine — phase guards", () => {
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

describe("Engine — night resolution", () => {
  function setup10(): { state: MafiaState; engine: Engine } {
    const state = freshState(10);
    const engine = new Engine(state);
    engine.startGame();
    engine._assignRoleForTest("p3", Role.DOCTOR);
    return { state, engine };
  }

  it("doctor matches mafia victim → state.died is empty", () => {
    const { state, engine } = setup10();
    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p3", "p4");
    const res = engine.resolveNight();

    assert.strictEqual(res.died, "");
    assert.strictEqual(res.mafiaVictimId, "p4");
    assert.strictEqual(res.doctorHealId, "p4");
    assert.strictEqual(state.died, "");
  });

  it("doctor does not match mafia victim → state.died equals the victim", () => {
    const { state, engine } = setup10();
    engine.mafiaKill("host", "p4");
    // Doctor heals someone else.
    engine.doctorHeal("p3", "p5");
    const res = engine.resolveNight();

    assert.strictEqual(res.died, "p4");
    assert.strictEqual(state.died, "p4");
  });

  it("no mafia victim submitted → state.died stays empty", () => {
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

describe("Engine — action log", () => {
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

  it("votes are immutable: a second vote from the same actor is rejected", () => {
    const engine = inDay1Voting();
    engine.vote("p0", "p6");
    assert.throws(() => engine.vote("p0", "p8"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.VOTE_ALREADY_CAST;
    });
    // The original vote stands.
    assert.strictEqual(engine.getVote("p0"), "p6");
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

// ─── Ticket 08: voting ties, revote loop, host arbitration ──────────

describe("Engine — voting ties + revote (ticket 08)", () => {
  /**
   * Reach DAY_VOTING with all 10 players alive (the mafia victim is saved
   * by the doctor) and `nominated` on the ballot.
   */
  function inDay1VotingWith(nominated: string[]): Engine {
    const state = freshState(10);
    const engine = new Engine(state);
    engine.startGame();
    engine._assignRoleForTest("p3", Role.DOCTOR);
    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p3", "p4");
    engine.resolveNight();
    engine.startSpeeches();
    for (const target of nominated) {
      engine.nominate("p0", target);
    }
    const order = engine.getSpeakingOrder();
    for (let i = 0; i < order.length; i++) engine.nextSpeaker();
    const dOrder = engine.getDefenseOrder();
    for (let i = 0; i < dOrder.length; i++) engine.nextDefense();
    return engine;
  }

  /**
   * Split the first 9 voters 3/3/3 across p6/p7/p8; p9 stays silent, so
   * their default vote goes to the last speaker (themselves) — who is off
   * the ballot — and lands on nobody, leaving a 3-way tie.
   */
  function castThreeWayTie(engine: Engine): void {
    engine.vote("p0", "p6");
    engine.vote("p1", "p6");
    engine.vote("p2", "p6");
    engine.vote("p3", "p7");
    engine.vote("p4", "p7");
    engine.vote("p5", "p7");
    engine.vote("p6", "p8");
    engine.vote("p7", "p8");
    engine.vote("p8", "p8");
  }

  it("a 2-way tie auto-pardons: nobody dies, the day ends, night falls", () => {
    const engine = inDay1VotingWith(["p6", "p7"]);
    // 5 votes for p6, 5 for p7 — exactly 2 tied leaders.
    for (let i = 0; i < 5; i++) engine.vote(`p${i}`, "p6");
    for (let i = 5; i < 10; i++) engine.vote(`p${i}`, "p7");

    const res = engine.resolveVoting();
    assert.strictEqual(res.outcome, "auto-pardon");
    assert.strictEqual(res.eliminatedId, "");
    assert.strictEqual(res.voteCounts.p6, 5);
    assert.strictEqual(res.voteCounts.p7, 5);
    assert.strictEqual(engine.state.phase, GamePhase.NIGHT);
    assert.strictEqual(engine.state.nightStep, NightStep.MAFIA);
    assert.strictEqual(engine.state.players.get("p6")!.isAlive, true);
    assert.strictEqual(engine.state.players.get("p7")!.isAlive, true);
  });

  it("a 3-way tie starts a revote among the tied leaders and narrows the ballot", () => {
    const engine = inDay1VotingWith(["p5", "p6", "p7", "p8"]);
    castThreeWayTie(engine);

    const res = engine.resolveVoting();
    assert.strictEqual(res.outcome, "revote");
    assert.strictEqual(res.eliminatedId, "");
    assert.deepStrictEqual(res.tiedLeaders, ["p6", "p7", "p8"]);
    assert.strictEqual(res.revoteNumber, 1);
    assert.strictEqual(res.totalVotes, 10);

    // Phase stays DAY_VOTING for the revote round.
    assert.strictEqual(engine.state.phase, GamePhase.DAY_VOTING);
    assert.strictEqual(engine.getRevoteCount(), 1);

    // The public ballot narrowed to the tied leaders; p5 (0 votes) is off it.
    assert.deepStrictEqual([...engine.state.nominations], ["p6", "p7", "p8"]);
    assert.strictEqual(engine.state.players.get("p5")!.isNominated, false);
    assert.strictEqual(engine.state.players.get("p6")!.isNominated, true);

    // Nobody died on the tie.
    assert.strictEqual(engine.state.players.get("p6")!.isAlive, true);

    // Round 2: fresh votes (p0 voted in round 1 — voting again proves the
    // buffer was cleared). 5/3/2 → p6 is the single winner.
    for (let i = 0; i < 5; i++) engine.vote(`p${i}`, "p6");
    for (let i = 5; i < 8; i++) engine.vote(`p${i}`, "p7");
    for (let i = 8; i < 10; i++) engine.vote(`p${i}`, "p8");
    const res2 = engine.resolveVoting();
    assert.strictEqual(res2.outcome, "eliminated");
    assert.strictEqual(res2.eliminatedId, "p6");
    assert.strictEqual(engine.state.phase, GamePhase.NIGHT);
    assert.strictEqual(engine.state.players.get("p6")!.isAlive, false);
    assert.strictEqual(engine.state.players.get("p7")!.isAlive, true);
  });

  it("a revote that ends in a 2-way tie auto-pardons (ADR 0003)", () => {
    const engine = inDay1VotingWith(["p6", "p7", "p8"]);
    castThreeWayTie(engine);
    assert.strictEqual(engine.resolveVoting().outcome, "revote");

    // Round 2: 5/5/0 — exactly 2 tied leaders → auto-pardon.
    for (let i = 0; i < 5; i++) engine.vote(`p${i}`, "p6");
    for (let i = 5; i < 10; i++) engine.vote(`p${i}`, "p7");

    const res2 = engine.resolveVoting();
    assert.strictEqual(res2.outcome, "auto-pardon");
    assert.strictEqual(res2.eliminatedId, "");
    assert.strictEqual(engine.state.phase, GamePhase.NIGHT);
    assert.strictEqual(engine.state.players.get("p6")!.isAlive, true);
    assert.strictEqual(engine.state.players.get("p7")!.isAlive, true);
    assert.strictEqual(engine.state.players.get("p8")!.isAlive, true);
  });

  it("in a revote round a default vote for an off-ballot last speaker lands on nobody", () => {
    const engine = inDay1VotingWith(["p6", "p7", "p8"]);
    castThreeWayTie(engine);
    const res1 = engine.resolveVoting();
    assert.strictEqual(res1.outcome, "revote");
    assert.strictEqual(res1.voteCounts.p6, 3);

    // Round 2: nobody votes — all 10 defaults go to the off-ballot last
    // speaker, every candidate stays at 0, and the 3-way tie repeats.
    const res2 = engine.resolveVoting();
    assert.strictEqual(res2.outcome, "revote");
    assert.strictEqual(res2.revoteNumber, 2);
    assert.strictEqual(res2.voteCounts.p6, 0);
  });

  it("pauses for a host decision after revoteCap consecutive 3+ way revotes", () => {
    const engine = inDay1VotingWith(["p6", "p7", "p8"]); // default revoteCap = 3

    // Rounds 1–3: each 3-way tie starts another revote.
    for (let round = 1; round <= 3; round++) {
      castThreeWayTie(engine);
      const res = engine.resolveVoting();
      assert.strictEqual(res.outcome, "revote", `round ${round}`);
      assert.strictEqual(res.revoteNumber, round, `round ${round}`);
    }
    assert.strictEqual(engine.getRevoteCount(), 3);

    // Round 4: another 3-way tie — the cap is exhausted, the engine pauses
    // in DAY_VOTING with a pending host decision.
    castThreeWayTie(engine);
    const res4 = engine.resolveVoting();
    assert.strictEqual(res4.outcome, "host-decision");
    assert.deepStrictEqual(res4.tiedLeaders, ["p6", "p7", "p8"]);
    assert.strictEqual(engine.state.phase, GamePhase.DAY_VOTING);
    assert.deepStrictEqual(engine.getPendingTieDecision(), {
      tiedLeaders: ["p6", "p7", "p8"],
    });
    assert.strictEqual(engine.getRevoteCount(), 3, "no new revote started");

    // While paused, votes and re-resolution are rejected.
    assert.throws(() => engine.vote("p9", "p6"), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_PHASE;
    });
    assert.throws(() => engine.resolveVoting(), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.WRONG_PHASE;
    });
  });

  it("a lower revoteCap reaches the host decision sooner", () => {
    const engine = inDay1VotingWith(["p6", "p7", "p8"]);
    engine.state.revoteCap = 1;

    castThreeWayTie(engine);
    assert.strictEqual(engine.resolveVoting().outcome, "revote");

    castThreeWayTie(engine);
    assert.strictEqual(engine.resolveVoting().outcome, "host-decision");
  });

  it("revoteBehavior auto-pardon short-circuits a 3+ way tie with no host step", () => {
    const engine = inDay1VotingWith(["p6", "p7", "p8"]);
    engine.state.revoteBehavior = "auto-pardon";

    castThreeWayTie(engine);
    const res = engine.resolveVoting();
    assert.strictEqual(res.outcome, "auto-pardon");
    assert.strictEqual(engine.state.phase, GamePhase.NIGHT);
    assert.strictEqual(engine.getRevoteCount(), 0);
    assert.strictEqual(engine.getPendingTieDecision(), null);
    assert.strictEqual(engine.state.players.get("p6")!.isAlive, true);
  });

  describe("host arbitration (ADR 0006)", () => {
    /**
     * A room with revoteCap = 1 driven one revote past the cap: the engine
     * is paused in DAY_VOTING with a pending decision among p6/p7/p8.
     */
    function withPendingDecision(): Engine {
      const engine = inDay1VotingWith(["p6", "p7", "p8"]);
      engine.state.revoteCap = 1;
      castThreeWayTie(engine);
      assert.strictEqual(engine.resolveVoting().outcome, "revote");
      castThreeWayTie(engine);
      assert.strictEqual(engine.resolveVoting().outcome, "host-decision");
      return engine;
    }

    it("auto-pardon choice ends the day with nobody eliminated", () => {
      const engine = withPendingDecision();
      let deaths = 0;
      engine.setOnPlayerDied(() => {
        deaths += 1;
      });

      engine.resolveTieByPardon("host");

      assert.strictEqual(engine.state.phase, GamePhase.NIGHT);
      assert.strictEqual(engine.getPendingTieDecision(), null);
      for (let i = 0; i < 10; i++) {
        assert.strictEqual(engine.state.players.get(`p${i}`)!.isAlive, true);
      }
      assert.strictEqual(deaths, 0);
    });

    it("force-candidate eliminates one of the tied leaders through the vote path", () => {
      const engine = withPendingDecision();
      const deaths: { id: string; cause: DeathCause }[] = [];
      engine.setOnPlayerDied((id, cause) => deaths.push({ id, cause }));

      engine.resolveTieByForce("host", "p7");

      assert.strictEqual(engine.state.phase, GamePhase.NIGHT);
      assert.strictEqual(engine.state.players.get("p7")!.isAlive, false);
      assert.strictEqual(engine.state.players.get("p6")!.isAlive, true);
      assert.strictEqual(engine.state.players.get("p8")!.isAlive, true);
      assert.deepStrictEqual(deaths, [{ id: "p7", cause: "VOTE_ELIMINATION" }]);
      assert.strictEqual(engine.getPendingTieDecision(), null);
    });

    it("force-candidate rejects a target that is not a tied leader", () => {
      const engine = withPendingDecision();
      assert.throws(() => engine.resolveTieByForce("host", "p2"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.WRONG_ROLE;
      });
      assert.strictEqual(engine.state.phase, GamePhase.DAY_VOTING);
    });

    it("kick-player ejects a non-tied player and restarts the revote with one fewer voter", () => {
      const engine = withPendingDecision();
      const deaths: { id: string; cause: DeathCause }[] = [];
      engine.setOnPlayerDied((id, cause) => deaths.push({ id, cause }));

      engine.resolveTieByKick("host", "p2", "stalling the vote");

      // p2 was ejected through ticket 06's kick path.
      assert.strictEqual(engine.state.players.get("p2")!.isAlive, false);
      assert.ok(
        deaths.some((d) => d.id === "p2" && d.cause === "KICKED"),
        "kick seam fires with KICKED",
      );

      // Still DAY_VOTING: the tied leaders revote with one fewer voter.
      assert.strictEqual(engine.state.phase, GamePhase.DAY_VOTING);
      assert.strictEqual(engine.getPendingTieDecision(), null);
      assert.deepStrictEqual([...engine.state.nominations], ["p6", "p7", "p8"]);

      // 9 voters remain (p2 is dead): 4/3/2 → p6 is the single winner.
      engine.vote("p0", "p6");
      engine.vote("p1", "p6");
      engine.vote("p3", "p6");
      engine.vote("p4", "p6");
      engine.vote("p5", "p7");
      engine.vote("p6", "p7");
      engine.vote("p9", "p7");
      engine.vote("p7", "p8");
      engine.vote("p8", "p8");

      const res = engine.resolveVoting();
      assert.strictEqual(res.outcome, "eliminated");
      assert.strictEqual(res.eliminatedId, "p6");
      assert.strictEqual(res.totalVotes, 9);
      assert.strictEqual(engine.state.phase, GamePhase.NIGHT);
      assert.strictEqual(engine.state.players.get("p6")!.isAlive, false);
    });

    it("kick-player rejects a tied leader (use force-candidate instead)", () => {
      const engine = withPendingDecision();
      assert.throws(() => engine.resolveTieByKick("host", "p6", "reason"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.WRONG_ROLE;
      });
      // Nothing changed: no one dead, still paused.
      assert.strictEqual(engine.state.players.get("p6")!.isAlive, true);
      assert.ok(engine.getPendingTieDecision());
    });

    it("arbitration is rejected when no decision is pending", () => {
      const engine = inDay1VotingWith(["p6", "p7", "p8"]);
      assert.throws(() => engine.resolveTieByPardon("host"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.WRONG_PHASE;
      });
      assert.throws(() => engine.resolveTieByForce("host", "p6"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.WRONG_PHASE;
      });
      assert.throws(() => engine.resolveTieByKick("host", "p0", "reason"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.WRONG_PHASE;
      });
    });

    it("arbitration requires the host", () => {
      const engine = withPendingDecision();
      assert.throws(() => engine.resolveTieByPardon("p0"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.NOT_HOST;
      });
      assert.ok(engine.getPendingTieDecision(), "still pending after a non-host attempt");
    });

    it("a new day resets the revote counter so fresh revotes are granted", () => {
      const engine = withPendingDecision(); // revoteCap = 1, cap exhausted on day 1
      engine.resolveTieByPardon("host");

      // Walk day 2 back into DAY_VOTING: kill p4 (the doctor must pick a
      // different target this time), then BALAGAN → speeches → defense →
      // voting (ADR 0007 order).
      engine.mafiaKill("host", "p4");
      engine.doctorHeal("p3", "p5");
      engine.resolveNight();
      engine.startSpeeches();
      engine.skipPhase("host"); // ADR 0007: skip the debate to open speeches
      // Day 2's first speaker is p1 (the seat after day 1's p0); the
      // first-word rule requires them to nominate.
      engine.nominate("p1", "p6");
      engine.nominate("p1", "p7");
      engine.nominate("p1", "p8");
      const order = engine.getSpeakingOrder();
      for (let i = 0; i < order.length; i++) engine.nextSpeaker();
      // The last speech advances directly to defense on every day (ADR 0007).
      assert.strictEqual(engine.state.phase, GamePhase.DAY_DEFENSE);
      const dOrder = engine.getDefenseOrder();
      for (let i = 0; i < dOrder.length; i++) engine.nextDefense();
      assert.strictEqual(engine.state.phase, GamePhase.DAY_VOTING);

      assert.strictEqual(engine.getRevoteCount(), 0);
      assert.strictEqual(engine.getPendingTieDecision(), null);

      // 9 voters remain (p4 is dead): a 3-way tie starts revote #1 again
      // instead of going straight back to the host.
      engine.vote("p0", "p6");
      engine.vote("p1", "p6");
      engine.vote("p2", "p6");
      engine.vote("p3", "p7");
      engine.vote("p5", "p7");
      engine.vote("p6", "p7");
      engine.vote("p7", "p8");
      engine.vote("p8", "p8");
      engine.vote("p9", "p8");
      const res = engine.resolveVoting();
      assert.strictEqual(res.outcome, "revote");
      assert.strictEqual(res.revoteNumber, 1);
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
    const snap = t.snapshot(5_000);
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
    while ((engine.state.phase as GamePhase) !== GamePhase.DAY_VOTING) engine.nextDefense();
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
    while ((engine.state.phase as GamePhase) !== GamePhase.DAY_VOTING) engine.nextDefense();
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
    while ((engine.state.phase as GamePhase) !== GamePhase.DAY_VOTING) engine.nextDefense();
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

describe("Engine — Day 2+ BALAGAN + first-word rule (ticket 07)", () => {
  /**
   * Drive the engine from LOBBY through a complete Day 1 cycle (mafia kill
   * with save, speeches, defense, voting, resolveVoting) ending in NIGHT
   * with dayCount still 1. Helper for tests that want a fresh Day 2 morning.
   */
  function driveDay1(): Engine {
    const state = freshState(10);
    const engine = new Engine(state);
    engine.startGame();
    engine._assignRoleForTest("p3", Role.DOCTOR);
    // Mafia kills p4; Doctor saves p4 so all 10 players remain alive for the
    // speaking-order / first-word rotation tests.
    engine.mafiaKill("host", "p4");
    engine.doctorHeal("p3", "p4");
    engine.resolveNight();
    // Day 1 cycle: nominate p6 so defense has one candidate, drive through
    // every speaker, every defender, then resolve voting.
    engine.startSpeeches();
    engine.nominate("p0", "p6");
    const order = engine.getSpeakingOrder();
    for (let i = 0; i < order.length; i++) {
      engine.nextSpeaker();
    }
    const dOrder = engine.getDefenseOrder();
    for (let i = 0; i < dOrder.length; i++) {
      engine.nextDefense();
    }
    engine.resolveVoting();
    // After resolveVoting: phase = NIGHT, dayCount = 1 (unchanged until the
    // next resolveNight).
    return engine;
  }

  /**
   * From a NIGHT (post-vote) engine, drive Night 2 with a save so all 10
   * players remain alive. Leaves the engine in DAY_ANNOUNCEMENT with
   * `dayCount = 2` — ready for `startSpeeches()` on Day 2.
   */
  function driveNight2(engine: Engine): void {
    engine.mafiaKill("host", "p5");
    engine.doctorHeal("p3", "p5");
    engine.resolveNight();
  }

  /**
   * Drive the engine all the way through Day 2 (BALAGAN → SPEECHES → DEFENSE
   * → VOTING → resolveVoting) so the next `startSpeeches` lands on Day 3.
   * The first-word rule is satisfied (first speaker nominates), BALAGAN is
   * skipped with `skipPhase` to avoid driving the clock, and resolveVoting
   * ends the day.
   *
   * Note: the resolved elimination target is the implicit last speaker
   * (p0, the seat that wraps around the rotation), NOT the nominated p6
   * — all default votes go to the last speaker, who isn't on the
   * nomination list. p6 stays alive, p0 dies. We pin p0=CIVILIAN here so
   * the Day 2 vote cannot trigger civilian victory by accidentally
   * eliminating a BLACK anchor under random role assignment (driveDay1
   * stays untouched per ticket 02 / decision 11 — this pin lives here
   * because driveDay2 is the only helper whose resolveVoting kills p0).
   */
  function driveDay2(engine: Engine): void {
    engine._assignRoleForTest("p0", Role.CIVILIAN);
    // ADR 0007: on Day 2+ startSpeeches opens BALAGAN; skipping it opens the
    // speech round and freezes the roster.
    engine.startSpeeches();
    engine.skipPhase("host");
    engine.nominate("p1", "p6");
    const order = engine.getSpeakingOrder();
    for (let i = 0; i < order.length; i++) {
      engine.nextSpeaker();
    }
    // The last speech advances directly to DAY_DEFENSE on every day
    // (ADR 0007 — BALAGAN precedes speeches, so last speech → DEFENSE).
    const dOrder = engine.getDefenseOrder();
    for (let i = 0; i < dOrder.length; i++) {
      engine.nextDefense();
    }
    engine.resolveVoting();
  }

  describe("Day 2+ speaking-order rotation", () => {
    it("Day 1 first speaker is the lowest seatIndex alive non-host", () => {
      const state = freshState(10);
      const engine = new Engine(state);
      engine.startGame();
      engine._assignRoleForTest("p3", Role.DOCTOR);
      engine.mafiaKill("host", "p4");
      engine.doctorHeal("p3", "p4");
      engine.resolveNight();
      // Now: DAY_ANNOUNCEMENT, dayCount = 1.
      engine.startSpeeches();
      assert.strictEqual(engine.getCurrentSpeaker(), "p0");
      assert.deepStrictEqual(engine.getSpeakingOrder()[0], "p0");
    });

    it("Day 2 first speaker is the seat immediately clockwise from Day 1's first speaker", () => {
      const engine = driveDay1();
      driveNight2(engine);
      // ADR 0007: startSpeeches opens BALAGAN on Day 2+; skipping it opens
      // the speech round and freezes the roster.
      engine.startSpeeches();
      engine.skipPhase("host");
      assert.strictEqual(engine.getCurrentSpeaker(), "p1");
      assert.deepStrictEqual(engine.getSpeakingOrder()[0], "p1");
    });

    it("Day 3 first speaker is the seat immediately clockwise from Day 2's first speaker", () => {
      const engine = driveDay1();
      driveNight2(engine);
      driveDay2(engine);
      // driveDay2 stops at DAY_VOTING with all 10 players still alive (p6
      // is nominated but the vote isn't resolved). Drive Night 3: mafia
      // tries to kill p6, doctor saves.
      engine.mafiaKill("host", "p6");
      engine.doctorHeal("p3", "p6");
      engine.resolveNight();
      // Now: DAY_ANNOUNCEMENT, dayCount = 3.
      engine.startSpeeches();
      engine.skipPhase("host");
      assert.strictEqual(engine.getCurrentSpeaker(), "p2");
      assert.deepStrictEqual(engine.getSpeakingOrder()[0], "p2");
    });

    it("rotation wraps when the previous first speaker was at the highest seat", () => {
      // Drive to DAY_ANNOUNCEMENT for Day 3 (dayCount = 3) with all 10
      // players alive and `firstSpeakerId` seeded to p9 (the highest seat).
      // Calling `startSpeeches` should wrap to the lowest seat — p0.
      const state = freshState(10);
      const engine = new Engine(state);
      engine.startGame();
      engine._assignRoleForTest("p3", Role.DOCTOR);

      // Manually advance the day counter to 3 (simulating three resolved
      // nights) and pin `firstSpeakerId` to p9. We bypass resolveNight for
      // brevity — the rotation only depends on `state.dayCount` and
      // `firstSpeakerId`, not on the in-between night flow. The phase must
      // also be DAY_ANNOUNCEMENT because startSpeeches guards on it.
      state.dayCount = 3;
      state.phase = GamePhase.DAY_ANNOUNCEMENT;
      engine._setFirstSpeakerIdForTest("p9");

      engine.startSpeeches();
      engine.skipPhase("host");
      // Day 4's first speaker must wrap from p9 (seat 9, the highest) to
      // the lowest seat alive — p0.
      assert.strictEqual(engine.getCurrentSpeaker(), "p0");
      assert.deepStrictEqual(engine.getSpeakingOrder()[0], "p0");
    });
  });

  describe("first-word rule (Day 2+ first speaker must nominate)", () => {
    it("Day 1 first speaker may end their speech without nominating", () => {
      const state = freshState(10);
      const engine = new Engine(state);
      engine.startGame();
      engine._assignRoleForTest("p3", Role.DOCTOR);
      engine.mafiaKill("host", "p4");
      engine.doctorHeal("p3", "p4");
      engine.resolveNight();
      engine.startSpeeches();
      // No nomination. nextSpeaker should succeed on Day 1.
      engine.nextSpeaker();
      // Engine should now be on the second speaker (p1).
      assert.strictEqual(engine.state.phase, GamePhase.DAY_SPEECHES);
      assert.strictEqual(engine.getCurrentSpeaker(), "p1");
    });

    it("Day 2 first speaker ending their speech without a nomination is rejected", () => {
      const engine = driveDay1();
      driveNight2(engine);
      engine.startSpeeches();
      engine.skipPhase("host"); // ADR 0007: skip the debate to open speeches
      // First speaker is p1; they have not nominated. nextSpeaker rejects.
      assert.strictEqual(engine.getCurrentSpeaker(), "p1");
      assert.throws(
        () => engine.nextSpeaker(),
        (err: unknown) => (err as { code: string }).code === EngineErrorCode.WRONG_PHASE,
      );
      // State is unchanged — phase is still DAY_SPEECHES, still p1.
      assert.strictEqual(engine.state.phase, GamePhase.DAY_SPEECHES);
      assert.strictEqual(engine.getCurrentSpeaker(), "p1");
    });

    it("Day 2 first speaker nominating themselves satisfies the first-word rule", () => {
      const engine = driveDay1();
      driveNight2(engine);
      engine.startSpeeches();
      engine.skipPhase("host"); // ADR 0007: skip the debate to open speeches
      engine.nominate("p1", "p1"); // self-nomination is allowed
      // nextSpeaker should now succeed.
      engine.nextSpeaker();
      assert.strictEqual(engine.state.phase, GamePhase.DAY_SPEECHES);
      assert.strictEqual(engine.getCurrentSpeaker(), "p2");
    });

    it("Day 2 first speaker nominating another player satisfies the first-word rule", () => {
      const engine = driveDay1();
      driveNight2(engine);
      engine.startSpeeches();
      engine.skipPhase("host"); // ADR 0007: skip the debate to open speeches
      engine.nominate("p1", "p6");
      engine.nextSpeaker();
      assert.strictEqual(engine.state.phase, GamePhase.DAY_SPEECHES);
      assert.strictEqual(engine.getCurrentSpeaker(), "p2");
    });

    it("the first-word flag is reset at the start of each new day", () => {
      const engine = driveDay1();
      driveNight2(engine);
      driveDay2(engine);
      // Drive Night 3 (no deaths).
      engine.mafiaKill("host", "p7");
      engine.doctorHeal("p3", "p7");
      engine.resolveNight();
      // Day 3 starts. firstSpeakerId was p1; rotation puts p2 first.
      engine.startSpeeches();
      engine.skipPhase("host");
      assert.strictEqual(engine.getCurrentSpeaker(), "p2");
      // p2 has not nominated yet. Without a nomination, nextSpeaker must
      // reject — confirms the flag was reset (not carried over from Day 2
      // where p1 nominated).
      assert.throws(
        () => engine.nextSpeaker(),
        (err: unknown) => (err as { code: string }).code === EngineErrorCode.WRONG_PHASE,
      );
    });

    it("the first-word rule only fires for the first speaker, not for subsequent speakers", () => {
      const engine = driveDay1();
      driveNight2(engine);
      engine.startSpeeches();
      engine.skipPhase("host"); // ADR 0007: skip the debate to open speeches
      engine.nominate("p1", "p6");
      engine.nextSpeaker();
      // p2 (second speaker) has not nominated. nextSpeaker should still
      // succeed — the rule applies only to the first speaker.
      assert.strictEqual(engine.getCurrentSpeaker(), "p2");
      engine.nextSpeaker();
      assert.strictEqual(engine.getCurrentSpeaker(), "p3");
    });

    it("the first-word rule is not triggered by nominations from non-first-speaker players", () => {
      const engine = driveDay1();
      driveNight2(engine);
      engine.startSpeeches();
      engine.skipPhase("host"); // ADR 0007: skip the debate to open speeches
      // p2 (NOT the first speaker) nominates first.
      engine.nominate("p2", "p7");
      // The first speaker (p1) still has not nominated, so nextSpeaker must
      // reject.
      assert.throws(
        () => engine.nextSpeaker(),
        (err: unknown) => (err as { code: string }).code === EngineErrorCode.WRONG_PHASE,
      );
    });
  });

  describe("Day 2+ phase sequence (BALAGAN precedes speeches)", () => {
    it("Day 2 startSpeeches enters DAY_BALAGAN (not DAY_SPEECHES)", () => {
      const engine = driveDay1();
      driveNight2(engine);
      // ADR 0007: on Day 2+ the host's start-speeches press opens BALAGAN —
      // the free debate runs before any speech.
      engine.startSpeeches();
      assert.strictEqual(engine.state.phase, GamePhase.DAY_BALAGAN);
      // And a 90s BALAGAN timer should be armed.
      const snap = engine.getPhaseTimer();
      assert.ok(snap, "BALAGAN timer should be armed");
      assert.strictEqual(snap!.mode, "BALAGAN");
      assert.strictEqual(snap!.durationMs, 90_000);
      // The roster freezes when speeches begin, not when the day opens.
      assert.deepStrictEqual(engine.getSpeakingOrder(), []);
    });

    it("BALAGAN timer expiry auto-transitions to DAY_SPEECHES and freezes the roster", () => {
      const engine = driveDay1();
      driveNight2(engine);
      // Inject fake clock BEFORE startSpeeches so the BALAGAN timer is
      // armed at our controlled time, not at wall-clock now.
      const now = { value: 0 };
      engine._setClockForTest(() => now.value);
      engine.startSpeeches();
      assert.strictEqual(engine.state.phase, GamePhase.DAY_BALAGAN);

      // Jump to t=91s — past the 90s BALAGAN window.
      now.value = 91_000;
      const events = engine.tickPhaseTimer();
      // Should have produced an EXPIRED event for BALAGAN.
      assert.ok(
        events.some((e) => e.type === "EXPIRED" && e.mode === "BALAGAN"),
        "EXPIRED BALAGAN event should fire",
      );
      // The debate flows into the speech round; the roster freezes now.
      assert.strictEqual(engine.state.phase, GamePhase.DAY_SPEECHES);
      assert.strictEqual(engine.getSpeakingOrder()[0], "p1");
      assert.strictEqual(engine.getCurrentSpeaker(), "p1");
      const snap = engine.getPhaseTimer();
      assert.ok(snap, "SPEECH_TURN timer should be armed");
      assert.strictEqual(snap!.mode, "SPEECH_TURN");
    });

    it("host skipPhase during BALAGAN advances to DAY_SPEECHES", () => {
      const engine = driveDay1();
      driveNight2(engine);
      engine.startSpeeches();
      assert.strictEqual(engine.state.phase, GamePhase.DAY_BALAGAN);

      engine.skipPhase("host");
      assert.strictEqual(engine.state.phase, GamePhase.DAY_SPEECHES);
      assert.strictEqual(engine.getCurrentSpeaker(), "p1");
      // A SPEECH_TURN timer should now be armed.
      const snap = engine.getPhaseTimer();
      assert.ok(snap);
      assert.strictEqual(snap!.mode, "SPEECH_TURN");
    });

    it("Day 1 still skips BALAGAN: final nextSpeaker auto-transitions directly to DAY_DEFENSE", () => {
      // Sanity check that Day 1's behavior is unchanged. Use the
      // `driveNightThenDay` shape (Night 1 → DAY_ANNOUNCEMENT) so we
      // can immediately call startSpeeches on Day 1.
      const state = freshState(10);
      const engine = new Engine(state);
      engine.startGame();
      engine._assignRoleForTest("p3", Role.DOCTOR);
      engine.mafiaKill("host", "p4");
      engine.doctorHeal("p3", "p4");
      engine.resolveNight();
      engine.startSpeeches();
      engine.nominate("p0", "p6");
      const order = engine.getSpeakingOrder();
      for (let i = 0; i < order.length; i++) {
        engine.nextSpeaker();
      }
      // Day 1: directly into DAY_DEFENSE, no BALAGAN.
      assert.strictEqual(engine.state.phase, GamePhase.DAY_DEFENSE);
    });

    it("nominate is rejected during DAY_BALAGAN (ADR 0007 — speeches only)", () => {
      const engine = driveDay1();
      driveNight2(engine);
      engine.startSpeeches();
      assert.strictEqual(engine.state.phase, GamePhase.DAY_BALAGAN);
      // Nominations are valid during DAY_SPEECHES only, on all days.
      assert.throws(
        () => engine.nominate("p3", "p8"),
        (err: unknown) => {
          const e = err as { code: string; message: string };
          return (
            e.code === EngineErrorCode.WRONG_PHASE &&
            e.message.includes("nominate requires phase DAY_SPEECHES") &&
            !e.message.includes("or DAY_BALAGAN")
          );
        },
      );
      // State is unchanged.
      assert.deepStrictEqual([...engine.state.nominations], []);
      assert.strictEqual(engine.state.phase, GamePhase.DAY_BALAGAN);
    });

    it("a full Day 2 cycle ends in NIGHT (BALAGAN → SPEECHES → DEFENSE → VOTING → NIGHT)", () => {
      const engine = driveDay1();
      driveNight2(engine);
      // ADR 0007: the day opens with BALAGAN...
      engine.startSpeeches();
      assert.strictEqual(engine.state.phase, GamePhase.DAY_BALAGAN);
      // ...skipped manually so the test doesn't have to advance the clock —
      // the skip opens the speech round.
      engine.skipPhase("host");
      assert.strictEqual(engine.state.phase, GamePhase.DAY_SPEECHES);
      // The first speaker (p1) nominates, then the speeches run; the last
      // speech advances directly to defense on every day.
      engine.nominate("p1", "p6");
      const order = engine.getSpeakingOrder();
      for (let i = 0; i < order.length; i++) {
        engine.nextSpeaker();
      }
      assert.strictEqual(engine.state.phase, GamePhase.DAY_DEFENSE);
      const dOrder = engine.getDefenseOrder();
      for (let i = 0; i < dOrder.length; i++) {
        engine.nextDefense();
      }
      assert.strictEqual(engine.state.phase, GamePhase.DAY_VOTING);
      engine.resolveVoting();
      assert.strictEqual(engine.state.phase, GamePhase.NIGHT);
      assert.strictEqual(engine.state.dayCount, 2);
    });

    it("kick during BALAGAN leaves the speaking roster (late freeze) — opener death", () => {
      const engine = driveDay1();
      driveNight2(engine);
      // The Day 2 opener would be p1 (the seat after Day 1's first speaker
      // p0), but the roster is not frozen during BALAGAN.
      engine.startSpeeches();
      assert.strictEqual(engine.state.phase, GamePhase.DAY_BALAGAN);
      assert.deepStrictEqual(engine.getSpeakingOrder(), []);

      // p1 is kicked mid-debate — before the freeze.
      engine.kick("host", "p1", "foul");
      engine.skipPhase("host");

      // The freeze happens now: p1 is off the roster and the first alive
      // seat clockwise from the anchor (p2) opens the day.
      assert.strictEqual(engine.state.phase, GamePhase.DAY_SPEECHES);
      const order = engine.getSpeakingOrder();
      assert.strictEqual(order[0], "p2");
      assert.ok(!order.includes("p1"), "kicked player must not be in the roster");
      assert.strictEqual(engine.getCurrentSpeaker(), "p2");

      // The first-word duty binds to the actual opener: p2 cannot end their
      // speech without nominating.
      assert.throws(
        () => engine.nextSpeaker(),
        (err: unknown) => (err as { code: string }).code === EngineErrorCode.WRONG_PHASE,
      );
      engine.nominate("p2", "p6");
      engine.nextSpeaker();
      assert.strictEqual(engine.getCurrentSpeaker(), "p3");
    });

    it("kick during BALAGAN keeps the rotation anchored on the actual opener", () => {
      const engine = driveDay1();
      driveNight2(engine);
      engine.startSpeeches();
      assert.strictEqual(engine.state.phase, GamePhase.DAY_BALAGAN);

      // The anchor-seat player (p0, Day 1's first speaker) is kicked
      // mid-debate. The rotation anchors on p0's held seatIndex, so the
      // opener is still p1 — and p1 becomes the recorded anchor at the
      // freeze.
      engine.kick("host", "p0", "foul");
      engine.skipPhase("host");
      assert.strictEqual(engine.state.phase, GamePhase.DAY_SPEECHES);
      assert.strictEqual(engine.getSpeakingOrder()[0], "p1");
      assert.strictEqual(engine.getCurrentSpeaker(), "p1");

      // Drive Day 2: the opener nominates, the speeches run, the last speech
      // advances to defense, and the default votes (last speaker) end the day.
      engine.nominate("p1", "p6");
      const order = engine.getSpeakingOrder();
      for (let i = 0; i < order.length; i++) engine.nextSpeaker();
      const dOrder = engine.getDefenseOrder();
      for (let i = 0; i < dOrder.length; i++) engine.nextDefense();
      engine.resolveVoting();
      assert.strictEqual(engine.state.phase, GamePhase.NIGHT);

      // Night 3 (a save) → Day 3.
      engine.mafiaKill("host", "p7");
      engine.doctorHeal("p3", "p7");
      engine.resolveNight();

      // Day 3's rotation anchors on p1 — Day 2's actual opener.
      engine.startSpeeches();
      engine.skipPhase("host");
      assert.strictEqual(engine.getCurrentSpeaker(), "p2");
      assert.deepStrictEqual(engine.getSpeakingOrder()[0], "p2");
    });

    it("declareDead during BALAGAN leaves the speaking roster (late freeze)", () => {
      const engine = driveDay1();
      driveNight2(engine);
      engine.startSpeeches();
      assert.strictEqual(engine.state.phase, GamePhase.DAY_BALAGAN);

      // p2 drops mid-debate and the host declares them dead (ticket 05
      // path: pauseForMissing → declareDead).
      engine.pauseForMissing("p2");
      engine.declareDead("host", "p2");
      engine.skipPhase("host");

      // The freeze computes the order without the declared-dead player.
      assert.strictEqual(engine.state.phase, GamePhase.DAY_SPEECHES);
      const order = engine.getSpeakingOrder();
      assert.ok(!order.includes("p2"), "declared-dead player must not be in the roster");
      assert.strictEqual(order[0], "p1");
      assert.strictEqual(engine.getCurrentSpeaker(), "p1");
    });
  });
});

// ─── Ticket 07b: Private check delivery ─────────────────────────────────

describe("Engine — private check delivery (ticket 07b)", () => {
  /**
   * Fresh game in NIGHT with deterministic roles:
   *   p0=DON, p1=MAFIA, p2=SHERIFF, p3=DOCTOR, p4..p9=CIVILIAN.
   */
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

  describe("donCheck return value", () => {
    it("returns isSheriff: true when the target is the Sheriff", () => {
      const { engine } = setupGame();
      const result = engine.donCheck("p0", "p2");
      assert.deepStrictEqual(result, { targetId: "p2", isSheriff: true });
    });

    it("returns isSheriff: false when the target is a Civilian", () => {
      const { engine } = setupGame();
      const result = engine.donCheck("p0", "p4");
      assert.deepStrictEqual(result, { targetId: "p4", isSheriff: false });
    });

    it("returns isSheriff: false when the target is the Doctor", () => {
      const { engine } = setupGame();
      const result = engine.donCheck("p0", "p3");
      assert.deepStrictEqual(result, { targetId: "p3", isSheriff: false });
    });

    it("returns isSheriff: false when the target is a Mafia member", () => {
      const { engine } = setupGame();
      const result = engine.donCheck("p0", "p1");
      assert.deepStrictEqual(result, { targetId: "p1", isSheriff: false });
    });

    it("records the action in the action log for downstream consumption", () => {
      const { engine } = setupGame();
      engine.donCheck("p0", "p2");
      const lastLog = engine.getActionLog().at(-1)!;
      assert.strictEqual(lastLog.type, "DON_CHECK");
      assert.strictEqual(lastLog.actorSessionId, "p0");
      assert.strictEqual((lastLog.payload as { targetId: string }).targetId, "p2");
    });

    it("writes a DON_CHECK log entry without leaking the result", () => {
      const { engine } = setupGame();
      engine.donCheck("p0", "p2");
      const lastLog = engine.getActionLog().at(-1)!;
      assert.strictEqual(lastLog.type, "DON_CHECK");
      assert.strictEqual(lastLog.actorSessionId, "p0");
      assert.strictEqual((lastLog.payload as { targetId: string }).targetId, "p2");
      // The result is never written into the log payload.
      assert.strictEqual(
        (lastLog.payload as Record<string, unknown>).isSheriff,
        undefined,
        "isSheriff must not appear in the public action log",
      );
      assert.strictEqual(
        (lastLog.payload as Record<string, unknown>).result,
        undefined,
      );
    });

    it("does not mutate the public Player schema (no lastCheckedId, no check history)", () => {
      const { state, engine } = setupGame();
      const playerBefore = JSON.parse(JSON.stringify(state.players.get("p2")));
      engine.donCheck("p0", "p2");
      const playerAfter = state.players.get("p2")!;
      // The only fields on Player are: sessionId, name, seatIndex, isAlive,
      // isHost, isMissing, votes. Nothing about checks.
      const allowedKeys = new Set([
        "sessionId",
        "name",
        "seatIndex",
        "isAlive",
        "isHost",
        "isMissing",
        "votes",
      ]);
      for (const key of Object.keys(playerAfter)) {
        assert.ok(
          allowedKeys.has(key),
          `unexpected field on Player: ${key}`,
        );
      }
      assert.strictEqual(
        (playerAfter as unknown as Record<string, unknown>).lastCheckedId,
        undefined,
        "no lastCheckedId field",
      );
      assert.deepStrictEqual(
        JSON.parse(JSON.stringify(playerAfter)),
        playerBefore,
        "player schema is byte-for-byte unchanged",
      );
    });

    it("does not write the result into any state field", () => {
      const { state, engine } = setupGame();
      // Capture pre-call snapshot for comparison.
      const before = JSON.parse(JSON.stringify(state));
      engine.donCheck("p0", "p2");
      // The mafiaTargetId / doctorTargetId / died / dayCount fields are the
      // legitimate state fields; everything else must be byte-identical.
      const after = JSON.parse(JSON.stringify(state));
      const mutableKeys = new Set([
        "mafiaTargetId",
        "doctorTargetId",
        "died",
        "dayCount",
        "phase",
        "nightStep",
      ]);
      for (const k of Object.keys(after)) {
        if (mutableKeys.has(k)) continue;
        assert.deepStrictEqual(
          after[k],
          before[k],
          `state.${k} should be unchanged after donCheck`,
        );
      }
      // And the schema-level public state has nothing about checks either.
      assert.ok(
        !/donCheck|sheriffCheck|isSheriff|checkResult/i.test(
          JSON.stringify(state),
        ),
        "no check-related keys leaked into the public state",
      );
    });
  });

  describe("sheriffCheck return value", () => {
    it("returns team: RED when the target is a Civilian", () => {
      const { engine } = setupGame();
      const result = engine.sheriffCheck("p2", "p4");
      assert.deepStrictEqual(result, { targetId: "p4", team: Team.RED });
    });

    it("returns team: RED when the target is the Doctor", () => {
      const { engine } = setupGame();
      const result = engine.sheriffCheck("p2", "p3");
      assert.deepStrictEqual(result, { targetId: "p3", team: Team.RED });
    });

    it("returns team: BLACK when the target is a Mafia member", () => {
      const { engine } = setupGame();
      const result = engine.sheriffCheck("p2", "p1");
      assert.deepStrictEqual(result, { targetId: "p1", team: Team.BLACK });
    });

    it("returns team: BLACK when the target is the Don (the override)", () => {
      const { engine } = setupGame();
      const result = engine.sheriffCheck("p2", "p0");
      assert.deepStrictEqual(result, { targetId: "p0", team: Team.BLACK });
    });

    it("records the action in the action log for downstream consumption", () => {
      const { engine } = setupGame();
      engine.sheriffCheck("p2", "p0");
      const lastLog = engine.getActionLog().at(-1)!;
      assert.strictEqual(lastLog.type, "SHERIFF_CHECK");
      assert.strictEqual(lastLog.actorSessionId, "p2");
      assert.strictEqual((lastLog.payload as { targetId: string }).targetId, "p0");
    });

    it("writes a SHERIFF_CHECK log entry without leaking the result", () => {
      const { engine } = setupGame();
      engine.sheriffCheck("p2", "p0");
      const lastLog = engine.getActionLog().at(-1)!;
      assert.strictEqual(lastLog.type, "SHERIFF_CHECK");
      assert.strictEqual(lastLog.actorSessionId, "p2");
      assert.strictEqual((lastLog.payload as { targetId: string }).targetId, "p0");
      // The result is never written into the log payload.
      assert.strictEqual(
        (lastLog.payload as Record<string, unknown>).team,
        undefined,
        "team must not appear in the public action log",
      );
      assert.strictEqual(
        (lastLog.payload as Record<string, unknown>).result,
        undefined,
      );
    });
  });

  describe("donCheck / sheriffCheck error paths still hold", () => {
    it("donCheck rejects a non-Don actor", () => {
      const { engine } = setupGame();
      assert.throws(() => engine.donCheck("p1", "p2"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.WRONG_ROLE;
      });
    });

    it("sheriffCheck rejects a non-Sheriff actor", () => {
      const { engine } = setupGame();
      assert.throws(() => engine.sheriffCheck("p1", "p2"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.WRONG_ROLE;
      });
    });

    it("donCheck rejects the Don checking themselves", () => {
      const { engine } = setupGame();
      assert.throws(() => engine.donCheck("p0", "p0"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.WRONG_ROLE;
      });
    });

    it("sheriffCheck rejects the Sheriff checking themselves", () => {
      const { engine } = setupGame();
      assert.throws(() => engine.sheriffCheck("p2", "p2"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.WRONG_ROLE;
      });
    });

    it("donCheck rejects a target not at the table", () => {
      const { engine } = setupGame();
      assert.throws(() => engine.donCheck("p0", "ghost"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.PLAYER_MISSING;
      });
    });

    it("sheriffCheck rejects a target not at the table", () => {
      const { engine } = setupGame();
      assert.throws(() => engine.sheriffCheck("p2", "ghost"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.PLAYER_MISSING;
      });
    });

    it("donCheck rejects a dead target", () => {
      const { state, engine } = setupGame();
      state.players.get("p2")!.isAlive = false;
      assert.throws(() => engine.donCheck("p0", "p2"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.PLAYER_DEAD;
      });
    });

    it("sheriffCheck rejects a dead target", () => {
      const { state, engine } = setupGame();
      state.players.get("p2")!.isAlive = false;
      assert.throws(() => engine.sheriffCheck("p2", "p0"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.PLAYER_DEAD;
      });
    });

    it("donCheck rejects a dead actor", () => {
      const { state, engine } = setupGame();
      state.players.get("p0")!.isAlive = false;
      assert.throws(() => engine.donCheck("p0", "p2"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.PLAYER_DEAD;
      });
    });

    it("donCheck rejects checking the host (no identity)", () => {
      // The host is in state.players (isAlive=true) but has no role, so the
      // engine must refuse — a "half-defined" identity lookup would leak
      // weird states into the result.
      const { engine } = setupGame();
      assert.throws(() => engine.donCheck("p0", "host"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.WRONG_ROLE;
      });
    });

    it("sheriffCheck rejects checking the host (no identity)", () => {
      const { engine } = setupGame();
      assert.throws(() => engine.sheriffCheck("p2", "host"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.WRONG_ROLE;
      });
    });

    it("donCheck rejects a check outside the NIGHT phase", () => {
      const state = freshState(10);
      const engine = new Engine(state);
      // Don't startGame: phase is LOBBY.
      engine._assignRoleForTest("p0", Role.DON);
      engine._assignRoleForTest("p2", Role.SHERIFF);
      assert.throws(() => engine.donCheck("p0", "p2"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.WRONG_PHASE;
      });
    });

    it("sheriffCheck rejects a check outside the NIGHT phase", () => {
      const state = freshState(10);
      const engine = new Engine(state);
      engine._assignRoleForTest("p0", Role.DON);
      engine._assignRoleForTest("p2", Role.SHERIFF);
      assert.throws(() => engine.sheriffCheck("p2", "p0"), (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.WRONG_PHASE;
      });
    });

    it("donCheck on the previous target still throws — the old stub never returned, but it never leaked either", () => {
      // A second check on the same night must overwrite (not append) per the
      // existing engine semantics, and the most recent result is what the
      // caller sees. The previous result is not retained anywhere.
      const { engine } = setupGame();
      const r1 = engine.donCheck("p0", "p4");
      const r2 = engine.donCheck("p0", "p2");
      assert.deepStrictEqual(r1, { targetId: "p4", isSheriff: false });
      assert.deepStrictEqual(r2, { targetId: "p2", isSheriff: true });
      // Only the most recent action is recorded (last entry is the second check).
      const lastLog = engine.getActionLog().at(-1)!;
      assert.strictEqual(lastLog.type, "DON_CHECK");
      assert.strictEqual(lastLog.actorSessionId, "p0");
      assert.strictEqual((lastLog.payload as { targetId: string }).targetId, "p2");
    });

    it("a failed donCheck throws and does not record the action", () => {
      const { engine } = setupGame();
      const logLenBefore = engine.getActionLog().length;
      // Wrong actor (Sheriff trying to donCheck).
      assert.throws(() => engine.donCheck("p2", "p4"));
      // No new log entry should have been written.
      assert.strictEqual(engine.getActionLog().length, logLenBefore);
    });

    it("a failed sheriffCheck throws and does not record the action", () => {
      const { engine } = setupGame();
      const logLenBefore = engine.getActionLog().length;
      assert.throws(() => engine.sheriffCheck("p0", "p4"));
      assert.strictEqual(engine.getActionLog().length, logLenBefore);
    });
  });

  describe("isolation between actors and targets", () => {
    it("Don's check result is independent of any prior Sheriff check on the same target", () => {
      const { engine } = setupGame();
      // Sheriff checks the Sheriff role holder first — gets RED.
      const r1 = engine.sheriffCheck("p2", "p3"); // p3 = Doctor = RED
      // Then the Don checks the same target — gets isSheriff: false (Doctor is not Sheriff).
      const r2 = engine.donCheck("p0", "p3");
      assert.deepStrictEqual(r1, { targetId: "p3", team: Team.RED });
      assert.deepStrictEqual(r2, { targetId: "p3", isSheriff: false });
    });

    it("the Don-override for the Sheriff is independent of the Don's own check", () => {
      const { engine } = setupGame();
      // Sheriff checks the Don — should report BLACK (the override).
      const r1 = engine.sheriffCheck("p2", "p0");
      // The Don's own check on someone else is unaffected.
      const r2 = engine.donCheck("p0", "p4");
      assert.deepStrictEqual(r1, { targetId: "p0", team: Team.BLACK });
      assert.deepStrictEqual(r2, { targetId: "p4", isSheriff: false });
    });
  });
});

// ─── Ticket 09: victory + reveal ─────────────────────────────────────────

describe("Engine — victory + reveal (ticket 09)", () => {
  /**
   * Fresh 9-player game with deterministic roles:
   * p0=DON, p1=MAFIA, p2=SHERIFF, p3=DOCTOR, p4..p8=CIVILIAN.
   * Blacks: p0, p1 (2). Reds: p2..p8 (7).
   */
  function setupGame(): { state: MafiaState; engine: Engine } {
    const state = freshState(9);
    const engine = new Engine(state);
    engine.startGame();
    engine._assignRoleForTest("p0", Role.DON);
    engine._assignRoleForTest("p1", Role.MAFIA);
    engine._assignRoleForTest("p2", Role.SHERIFF);
    engine._assignRoleForTest("p3", Role.DOCTOR);
    for (let i = 4; i < 9; i++) {
      engine._assignRoleForTest(`p${i}`, Role.CIVILIAN);
    }
    return { state, engine };
  }

  /** Declare `ids` dead via the disconnect path (missing → declareDead). */
  function declareDead(engine: Engine, ids: string[]): void {
    for (const id of ids) {
      engine.pauseForMissing(id);
      engine.declareDead("host", id);
    }
  }

  it("checkVictory returns null while both teams have living members", () => {
    const { engine } = setupGame();
    assert.strictEqual(engine.checkVictory(), null);
    assert.strictEqual(engine.getGameOverResult(), null);
  });

  it("checkVictory returns null before roles are assigned", () => {
    const state = freshState(9);
    const engine = new Engine(state);
    assert.strictEqual(engine.checkVictory(), null);
  });

  it("civilian victory: ejecting every black ends the game immediately", () => {
    const { state, engine } = setupGame();
    const gameOver: GameOverResult[] = [];
    engine.setOnGameOver((r) => gameOver.push(r));

    engine.kick("host", "p0", "role card");
    assert.strictEqual(state.phase, GamePhase.NIGHT, "one black left — the game continues");
    assert.strictEqual(engine.getGameOverResult(), null);

    engine.kick("host", "p1", "role card");
    assert.strictEqual(state.phase, GamePhase.GAME_OVER);
    assert.deepStrictEqual(engine.getGameOverResult(), {
      winner: Team.RED,
      reason: "CIVILIAN_VICTORY",
    });
    assert.strictEqual(gameOver.length, 1, "onGameOver fired exactly once");
    assert.deepStrictEqual(gameOver[0], { winner: Team.RED, reason: "CIVILIAN_VICTORY" });
  });

  it("civilian victory via vote eliminations across two days (the 'kill all mafia' path)", () => {
    const { state, engine } = setupGame();
    const gameOver: GameOverResult[] = [];
    engine.setOnGameOver((r) => gameOver.push(r));

    // Night 1 passes with no kill; the day cycle begins.
    engine.resolveNight();

    // Day 1: the Don (p0, first speaker) self-nominates; everyone votes p0.
    engine.startSpeeches();
    engine.nominate("p0", "p0");
    const order1 = engine.getSpeakingOrder();
    for (let i = 0; i < order1.length; i++) engine.nextSpeaker();
    const dOrder1 = engine.getDefenseOrder();
    for (let i = 0; i < dOrder1.length; i++) engine.nextDefense();
    for (const id of order1) engine.vote(id, "p0");
    engine.resolveVoting();
    assert.strictEqual(state.phase, GamePhase.NIGHT);
    assert.strictEqual(state.players.get("p0")!.isAlive, false);
    assert.strictEqual(engine.getGameOverResult(), null, "one black left — no victory yet");

    // Night 2: the mafia kills p8; no heal.
    engine.mafiaKill("host", "p8");
    engine.resolveNight();
    assert.strictEqual(state.phase, GamePhase.DAY_ANNOUNCEMENT);
    assert.strictEqual(state.dayCount, 2);
    assert.strictEqual(state.died, "p8");

    // Day 2: the first speaker is p1 (seat after day 1's p0); the first-word
    // rule requires them to nominate — they nominate themselves. Everyone
    // alive votes p1, the last black.
    engine.startSpeeches();
    assert.strictEqual(state.phase, GamePhase.DAY_BALAGAN, "day 2 opens BALAGAN (ADR 0007)");
    engine.skipPhase("host"); // skip the debate → the speech round opens
    engine.nominate("p1", "p1");
    const order2 = engine.getSpeakingOrder();
    for (let i = 0; i < order2.length; i++) engine.nextSpeaker();
    // The last speech advances directly to defense on every day (ADR 0007).
    assert.strictEqual(state.phase, GamePhase.DAY_DEFENSE);
    const dOrder2 = engine.getDefenseOrder();
    for (let i = 0; i < dOrder2.length; i++) engine.nextDefense();
    for (const id of order2) engine.vote(id, "p1");
    engine.resolveVoting();

    assert.strictEqual(state.phase, GamePhase.GAME_OVER, "civilian victory ends the game mid-vote");
    assert.deepStrictEqual(engine.getGameOverResult(), {
      winner: Team.RED,
      reason: "CIVILIAN_VICTORY",
    });
    assert.strictEqual(gameOver.length, 1);
    assert.strictEqual(state.players.get("p1")!.isAlive, false);
    assert.strictEqual(engine.getPhaseTimer(), null, "no mafia window armed after game over");
  });

  it("mafia victory at parity fires immediately, mid-day (vote elimination)", () => {
    const { state, engine } = setupGame();
    const gameOver: GameOverResult[] = [];
    engine.setOnGameOver((r) => gameOver.push(r));

    // Four reds declared dead during Night 1: reds drop from 7 to 3.
    // Blacks 2, reds 3 — still no victory.
    declareDead(engine, ["p2", "p3", "p4", "p5"]);
    assert.strictEqual(engine.getGameOverResult(), null);

    // Night 1 passes with no kill; the day cycle begins.
    engine.resolveNight();

    // Day 1: p0 (first speaker) nominates p6 (red); everyone alive votes p6.
    engine.startSpeeches();
    engine.nominate("p0", "p6");
    const order = engine.getSpeakingOrder(); // p0, p1, p6, p7, p8
    assert.strictEqual(order.length, 5);
    for (let i = 0; i < order.length; i++) engine.nextSpeaker();
    const dOrder = engine.getDefenseOrder();
    for (let i = 0; i < dOrder.length; i++) engine.nextDefense();
    for (const id of order) engine.vote(id, "p6");
    engine.resolveVoting();

    // p6 was red → reds drop to 2, blacks 2 → parity → mafia victory, and
    // the game does NOT fall through to NIGHT.
    assert.strictEqual(state.phase, GamePhase.GAME_OVER);
    assert.deepStrictEqual(engine.getGameOverResult(), {
      winner: Team.BLACK,
      reason: "MAFIA_VICTORY",
    });
    assert.strictEqual(gameOver.length, 1);
    assert.strictEqual(state.players.get("p6")!.isAlive, false);
    assert.strictEqual(engine.getPhaseTimer(), null, "no mafia window armed after a mid-day game over");
  });

  it("a night kill that reaches parity ends the game without entering DAY_ANNOUNCEMENT", () => {
    const { state, engine } = setupGame();

    // Four reds declared dead: blacks 2, reds 3.
    declareDead(engine, ["p2", "p3", "p4", "p5"]);

    // The mafia kills a fifth red. Resolution runs the victory check:
    // reds drop to 2 → parity → GAME_OVER right here.
    engine.mafiaKill("host", "p6");
    const res = engine.resolveNight();

    assert.strictEqual(res.died, "p6");
    assert.strictEqual(state.died, "p6");
    assert.strictEqual(state.phase, GamePhase.GAME_OVER, "no DAY_ANNOUNCEMENT after a game-ending night");
    assert.strictEqual(state.dayCount, 0, "dayCount never bumped — the day never started");
    assert.deepStrictEqual(engine.getGameOverResult(), {
      winner: Team.BLACK,
      reason: "MAFIA_VICTORY",
    });
  });

  it("a tie-arbitration kick that ejects the last black ends the game instead of restarting the revote", () => {
    const { state, engine } = setupGame();
    engine.state.revoteCap = 1;

    // The Don is declared dead during the night: p1 (Mafia) is the last black.
    declareDead(engine, ["p0"]);

    // Night 1 passes with no kill; the day cycle begins.
    engine.resolveNight();

    // Day 1 → 4-way tie among p5..p8 (2 votes each), round 2 repeats it, the
    // cap (1) is exhausted → the host must arbitrate.
    engine.startSpeeches();
    for (const target of ["p5", "p6", "p7", "p8"]) engine.nominate("p1", target);
    const order = engine.getSpeakingOrder();
    for (let i = 0; i < order.length; i++) engine.nextSpeaker();
    const dOrder = engine.getDefenseOrder();
    for (let i = 0; i < dOrder.length; i++) engine.nextDefense();
    const castTie = () => {
      engine.vote("p1", "p5");
      engine.vote("p2", "p5");
      engine.vote("p3", "p6");
      engine.vote("p4", "p6");
      engine.vote("p5", "p7");
      engine.vote("p6", "p7");
      engine.vote("p7", "p8");
      engine.vote("p8", "p8");
    };
    castTie();
    assert.strictEqual(engine.resolveVoting().outcome, "revote");
    castTie();
    assert.strictEqual(engine.resolveVoting().outcome, "host-decision");
    assert.strictEqual(engine.getRevoteCount(), 1);

    // The host kicks p1 — the last black, not a tied leader. Civilian
    // victory fires inside the kick's death funnel; the engine must NOT
    // restart the revote afterwards.
    engine.resolveTieByKick("host", "p1", "suspected stall");

    assert.strictEqual(state.phase, GamePhase.GAME_OVER);
    assert.deepStrictEqual(engine.getGameOverResult(), {
      winner: Team.RED,
      reason: "CIVILIAN_VICTORY",
    });
    assert.strictEqual(engine.getPendingTieDecision(), null, "arbitration cleared by game over");
    assert.strictEqual(engine.getRevoteCount(), 1, "no new revote started after game over");
  });

  it("the GAME_OVER reveal carries every player's role while the schema stays role-free", () => {
    const { state, engine } = setupGame();
    engine.kick("host", "p0", "role card");
    engine.kick("host", "p1", "role card");
    assert.strictEqual(state.phase, GamePhase.GAME_OVER);

    const reveal = engine.getRoleReveal();
    assert.strictEqual(reveal.length, 9, "every non-host player is revealed (the host has no role)");
    const byId = new Map(reveal.map((r) => [r.sessionId, r]));
    assert.deepStrictEqual(byId.get("p0"), { sessionId: "p0", role: Role.DON, team: Team.BLACK });
    assert.deepStrictEqual(byId.get("p1"), { sessionId: "p1", role: Role.MAFIA, team: Team.BLACK });
    assert.deepStrictEqual(byId.get("p2"), { sessionId: "p2", role: Role.SHERIFF, team: Team.RED });
    assert.deepStrictEqual(byId.get("p3"), { sessionId: "p3", role: Role.DOCTOR, team: Team.RED });
    assert.deepStrictEqual(byId.get("p4"), { sessionId: "p4", role: Role.CIVILIAN, team: Team.RED });

    // ADR 0004 holds even after GAME_OVER: the public schema never carries
    // roles — the reveal travels as a private message.
    for (const p of state.players.values()) {
      assert.strictEqual((p as unknown as { role?: unknown }).role, undefined);
      assert.strictEqual((p as unknown as { team?: unknown }).team, undefined);
    }
  });

  it("the state locks after GAME_OVER — no further actions accepted", () => {
    const { state, engine } = setupGame();
    engine.kick("host", "p0", "role card");
    engine.kick("host", "p1", "role card");
    assert.strictEqual(state.phase, GamePhase.GAME_OVER);

    const expectWrongPhase = (fn: () => void) => {
      assert.throws(fn, (err: unknown) => {
        return (err as { code: string }).code === EngineErrorCode.WRONG_PHASE;
      });
    };

    // Night actions.
    expectWrongPhase(() => engine.mafiaKill("host", "p4"));
    expectWrongPhase(() => engine.donCheck("p0", "p4"));
    expectWrongPhase(() => engine.sheriffCheck("p2", "p4"));
    expectWrongPhase(() => engine.doctorHeal("p3", "p4"));
    expectWrongPhase(() => engine.resolveNight());

    // Day actions.
    expectWrongPhase(() => engine.startSpeeches());
    expectWrongPhase(() => engine.nextSpeaker());
    expectWrongPhase(() => engine.nextDefense());
    expectWrongPhase(() => engine.nominate("p4", "p5"));
    expectWrongPhase(() => engine.vote("p4", "p5"));
    expectWrongPhase(() => engine.resolveVoting());

    // Host moderation and the death funnel are locked too.
    expectWrongPhase(() => engine.kick("host", "p4", "late kick"));
    expectWrongPhase(() => engine.declareDead("host", "p4"));

    // Pings are rejected by their own GAME_OVER guard.
    expectWrongPhase(() => engine.ping("p4", "p5"));

    // The game cannot be restarted.
    assert.throws(() => engine.startGame(), (err: unknown) => {
      return (err as { code: string }).code === EngineErrorCode.GAME_LOCKED;
    });

    // Foul remains available by design (a warning after the game is still a
    // warning) and changes no game state.
    engine.foul("host", "p4", "post-game etiquette");
    assert.strictEqual(state.phase, GamePhase.GAME_OVER);
  });

  it("onGameOver fires exactly once even when the winning death and a subsequent lock-bypass coincide", () => {
    const { engine } = setupGame();
    let count = 0;
    engine.setOnGameOver(() => {
      count += 1;
    });
    engine.kick("host", "p0", "one");
    engine.kick("host", "p1", "two");
    assert.strictEqual(count, 1);
  });

  it("the death seam still fires for every death, alongside the victory seam", () => {
    const { engine } = setupGame();
    const deaths: { id: string; cause: DeathCause }[] = [];
    engine.setOnPlayerDied((id, cause) => deaths.push({ id, cause }));
    let gameOverCount = 0;
    engine.setOnGameOver(() => {
      gameOverCount += 1;
    });

    engine.kick("host", "p0", "one");
    engine.kick("host", "p1", "two");

    assert.deepStrictEqual(deaths, [
      { id: "p0", cause: "KICKED" },
      { id: "p1", cause: "KICKED" },
    ]);
    assert.strictEqual(gameOverCount, 1);
  });

  it("endGame dismisses a pending missing-player pause so GAME_OVER state is clean", () => {
    const { state, engine } = setupGame();
    // p3 (a red) drops mid-phase; the host instead kicks both blacks — the
    // game ends while p3 is still flagged missing.
    engine.pauseForMissing("p3");
    assert.strictEqual(state.players.get("p3")!.isMissing, true);

    engine.kick("host", "p0", "role card");
    assert.strictEqual(state.phase, GamePhase.NIGHT, "the Don is dead but the Mafia lives on");
    assert.strictEqual(state.players.get("p3")!.isMissing, true, "missing flag survives a non-final death");

    engine.kick("host", "p1", "role card");
    assert.strictEqual(state.phase, GamePhase.GAME_OVER);
    assert.strictEqual(state.players.get("p3")!.isMissing, false, "missing flag cleared at game over");
    assert.deepStrictEqual(engine.getMissingPlayers(), []);
  });

  it("the game_over event lands in the host action log with winner and reason", () => {
    const { engine } = setupGame();
    engine.kick("host", "p0", "one");
    engine.kick("host", "p1", "two");

    const last = engine.getActionLog().at(-1)!;
    assert.strictEqual(last.type, "PHASE_ADVANCE");
    assert.strictEqual((last.payload as { event: string }).event, "game_over");
    assert.strictEqual((last.payload as { winner: Team }).winner, Team.RED);
    assert.strictEqual((last.payload as { reason: string }).reason, "CIVILIAN_VICTORY");
    assert.strictEqual(last.phase, GamePhase.GAME_OVER);
  });
});
