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
    // startGame, mafiaKill, doctorHeal, resolveNight в†’ 4 entries
    assert.strictEqual(log.length, 4);
    assert.strictEqual(log[0].phase, GamePhase.NIGHT);
    assert.strictEqual(log[0].type, "PHASE_ADVANCE");
  });
});
