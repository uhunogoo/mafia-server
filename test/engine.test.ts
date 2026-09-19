import assert from "assert";
import { MafiaState, Player } from "../src/rooms/schema/MafiaState.js";
import { GamePhase, NightStep, Role, Team } from "../src/rooms/schema/enums.js";
import { Engine } from "../src/game/Engine.js";
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

    // Night 2 starts (test-only: reset action buffer so we can submit again).
    // Engine doesn't expose a night reset yet, so we simulate it by clearing
    // internal state via resolveNight (already called above) and start a new
    // night by clearing the action buffer manually.
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
