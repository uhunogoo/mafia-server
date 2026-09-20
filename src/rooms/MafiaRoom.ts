import { Room, Client } from "@colyseus/core";
import { MafiaState } from "./schema/MafiaState.js";
import { Auth } from "../config/auth.js";
import { Engine } from "../game/Engine.js";
import type { PhaseTimerEvent } from "../game/PhaseTimer.js";
import {
  DonCheckResult,
  EngineError,
  EngineErrorCode,
  PingRecord,
  SheriffCheckResult,
  TieArbitrationChoice,
  VoteResolution,
} from "../game/types.js";

const INVITE_TTL_MS = 1000 * 60 * 60 * 6;
const PHASE_TIMER_TICK_MS = 250;

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

  /**
   * Server-side timer driver. Calls `engine.tickPhaseTimer()` every
   * `PHASE_TIMER_TICK_MS`; reminders are routed to the host. The handle is
   * cleared on room dispose.
   */
  private phaseTimerHandle: ReturnType<typeof setInterval> | null = null;

  private auth = new Auth(this);

  messages = {
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
      if (!this.requireActiveSender(client)) return;
      if (typeof payload?.targetId !== "string") {
        this.fail(client, "targetId is required");
        return;
      }
      // Capture the return value so the private result can be routed.
      // Using a direct try/catch (like `ping`) instead of `runEngine` —
      // runEngine swallows the return value.
      let result: DonCheckResult;
      try {
        result = this.engine.donCheck(client.sessionId, payload.targetId);
      } catch (e) {
        this.fail(client, this.engineErrorMessage(e));
        return;
      }
      // Per CONTEXT.md "Check delivery": the actor gets the result privately
      // and the host observes the same data in real time for moderation.
      // No other client receives the result.
      client.send("donCheckResult", result);
      this.sendCheckResultToHost("donCheckResult", result);
    },
    sheriffCheck: (client: Client, payload: { targetId: string }) => {
      if (!this.requireActiveSender(client)) return;
      if (typeof payload?.targetId !== "string") {
        this.fail(client, "targetId is required");
        return;
      }
      let result: SheriffCheckResult;
      try {
        result = this.engine.sheriffCheck(client.sessionId, payload.targetId);
      } catch (e) {
        this.fail(client, this.engineErrorMessage(e));
        return;
      }
      // Per CONTEXT.md "Check delivery": actor + host only.
      client.send("sheriffCheckResult", result);
      this.sendCheckResultToHost("sheriffCheckResult", result);
    },
    doctorHeal: (client: Client, payload: { targetId: string }) => {
      if (!this.requireActiveSender(client)) return;
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
    startSpeeches: (client: Client) => {
      if (!this.requireHost(client)) return;
      this.runEngine(() => this.engine.startSpeeches(), client);
    },
    nextSpeaker: (client: Client) => {
      if (!this.requireHost(client)) return;
      this.runEngine(() => this.engine.nextSpeaker(), client);
    },
    nextDefense: (client: Client) => {
      if (!this.requireHost(client)) return;
      this.runEngine(() => this.engine.nextDefense(), client);
    },
    nominate: (client: Client, payload: { targetId: string }) => {
      if (!this.requireActiveSender(client)) return;
      if (typeof payload?.targetId !== "string") {
        this.fail(client, "targetId is required");
        return;
      }
      this.runEngine(() => this.engine.nominate(client.sessionId, payload.targetId), client);
    },
    vote: (client: Client, payload: { targetId: string }) => {
      if (!this.requireActiveSender(client)) return;
      if (typeof payload?.targetId !== "string") {
        this.fail(client, "targetId is required");
        return;
      }
      this.runEngine(() => this.engine.vote(client.sessionId, payload.targetId), client);
    },
    resolveVoting: (client: Client) => {
      if (!this.requireHost(client)) return;
      // Direct try/catch (like donCheck) — runEngine swallows the return
      // value and we need the resolution to detect the revote-cap outcome.
      let resolution: VoteResolution;
      try {
        resolution = this.engine.resolveVoting();
      } catch (e) {
        this.fail(client, this.engineErrorMessage(e));
        return;
      }
      // Ticket 08: when the revote cap is reached the engine pauses and the
      // host gets a real-time decision prompt (on top of the
      // `revote_cap_reached` entry in the action log).
      if (resolution.outcome === "host-decision") {
        const host = this.findHostClient();
        host?.send("revoteCapReached", {
          tiedLeaders: resolution.tiedLeaders ?? [],
          revoteCap: this.state.revoteCap,
        });
      }
    },
    // Ticket 08: the host's answer to the revoteCapReached prompt (ADR 0006).
    arbitrateTie: (
      client: Client,
      payload: { choice: TieArbitrationChoice; targetId?: string; reason?: string },
    ) => {
      if (!this.requireHost(client)) return;
      const choice = payload?.choice;
      if (
        choice !== "auto-pardon" &&
        choice !== "force-candidate" &&
        choice !== "kick-player"
      ) {
        this.fail(client, "choice must be auto-pardon, force-candidate, or kick-player");
        return;
      }
      if (choice !== "auto-pardon" && typeof payload?.targetId !== "string") {
        this.fail(client, "targetId is required for force-candidate and kick-player");
        return;
      }
      const targetId = payload?.targetId ?? "";
      const reason = typeof payload?.reason === "string" ? payload.reason : "";
      this.runEngine(() => {
        if (choice === "auto-pardon") {
          this.engine.resolveTieByPardon(client.sessionId);
        } else if (choice === "force-candidate") {
          this.engine.resolveTieByForce(client.sessionId, targetId);
        } else {
          this.engine.resolveTieByKick(client.sessionId, targetId, reason);
        }
      }, client);
    },
    pausePhase: (client: Client) => {
      if (!this.requireHost(client)) return;
      this.runEngine(() => this.engine.pausePhase(client.sessionId), client);
    },
    resumePhase: (client: Client) => {
      if (!this.requireHost(client)) return;
      this.runEngine(() => this.engine.resumePhase(client.sessionId), client);
    },
    skipPhase: (client: Client) => {
      if (!this.requireHost(client)) return;
      this.runEngine(() => this.engine.skipPhase(client.sessionId), client);
    },
    extendPhase: (client: Client, payload: { seconds: number }) => {
      if (!this.requireHost(client)) return;
      const seconds = Number(payload?.seconds);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        this.fail(client, "seconds must be a positive number");
        return;
      }
      this.runEngine(() => this.engine.extendPhase(client.sessionId, seconds), client);
    },
    declareDead: (client: Client, payload: { sessionId: string }) => {
      if (!this.requireHost(client)) return;
      if (typeof payload?.sessionId !== "string") {
        this.fail(client, "sessionId is required");
        return;
      }
      const targetId = payload.sessionId;
      this.runEngine(() => {
        this.engine.declareDead(client.sessionId, targetId);
        // Notification goes out only after the engine accepts — keeps the
        // host UI in sync with the canonical state.
        this.notifyHostOfDeclaredDead(targetId);
      }, client);
    },
    kick: (client: Client, payload: { sessionId: string; reason?: string }) => {
      if (!this.requireHost(client)) return;
      if (typeof payload?.sessionId !== "string") {
        this.fail(client, "sessionId is required");
        return;
      }
      const reason = typeof payload?.reason === "string" ? payload.reason : "";
      this.runEngine(() => this.engine.kick(client.sessionId, payload.sessionId, reason), client);
    },
    foul: (client: Client, payload: { sessionId: string; reason?: string }) => {
      if (!this.requireHost(client)) return;
      if (typeof payload?.sessionId !== "string") {
        this.fail(client, "sessionId is required");
        return;
      }
      const reason = typeof payload?.reason === "string" ? payload.reason : "";
      this.runEngine(() => this.engine.foul(client.sessionId, payload.sessionId, reason), client);
    },
    ping: (client: Client, payload: { toId: string }) => {
      if (!this.requireActiveSender(client)) return;
      if (typeof payload?.toId !== "string") {
        this.fail(client, "toId is required");
        return;
      }
      let record: PingRecord;
      try {
        record = this.engine.ping(client.sessionId, payload.toId);
      } catch (e) {
        this.fail(client, this.engineErrorMessage(e));
        return;
      }

      // Per ADR 0002: a player only sees pings they sent or received.
      // The host sees every ping regardless of sender or recipient.
      const recipient = this.clients.find((c) => c.sessionId === payload.toId);
      if (recipient) recipient.send("ping", record);
      // The sender already has the engine's record via the return value,
      // but route it through the same private message for symmetry.
      client.send("ping", record);
      this.sendPingToHost(client.sessionId, payload.toId, record);
    },
    getLog: (client: Client, payload: { since?: string }) => {
      if (!this.requireHost(client)) return;
      const since = typeof payload?.since === "string" ? payload.since : "";
      const entries = this.engine.getActionLogSince(since);
      client.send("log", { entries });
    },
  };

  onCreate(options: {
    password?: string;
    revoteCap?: number;
    revoteBehavior?: string;
  }) {
    this.inviteCreatedAt = Date.now();
    if (options.password) {
      this.password = options.password;
      this.setMatchmaking({ unlisted: true });
    }

    // Ticket 08: room-creation voting settings (ADR 0006). Invalid values
    // fail room creation — a room configured differently than requested
    // should not start. Defaults live on the MafiaState schema (cap 3,
    // "host-arbitrates").
    if (options.revoteCap !== undefined) {
      if (!Number.isInteger(options.revoteCap) || options.revoteCap < 1) {
        throw new Error("revoteCap must be a positive integer");
      }
      this.state.revoteCap = options.revoteCap;
    }
    if (options.revoteBehavior !== undefined) {
      if (
        options.revoteBehavior !== "host-arbitrates" &&
        options.revoteBehavior !== "auto-pardon"
      ) {
        throw new Error('revoteBehavior must be "host-arbitrates" or "auto-pardon"');
      }
      this.state.revoteBehavior = options.revoteBehavior;
    }

    // Subscribe to the engine's death seam (ticket 03). Today the seam is a
    // no-op; a follow-up ticket (09) wires it to the victory check so the
    // engine can transition to GAME_OVER when one side is wiped out.
    this.engine.setOnPlayerDied((_sessionId, _cause) => {
      // Intentionally empty for this ticket.
    });

    // Start the phase-timer driver (ticket 04). Calls engine.tickPhaseTimer()
    // on every interval; reminders are forwarded to the host. The handle is
    // released in onDispose.
    this.phaseTimerHandle = setInterval(() => this.drivePhaseTimer(), PHASE_TIMER_TICK_MS);
  }

  async onAuth(client: Client, options: { name?: string }) {
    return this.auth.onAuth(client, options);
  }

  onJoin(client: Client) {
    // `auth.onJoin` is idempotent: on reconnect during the 30s grace window
    // it preserves the existing `Player` (so `isAlive` / `isMissing` / role
    // are not clobbered), and only refreshes the name. The room then clears
    // the missing flag and notifies the host — this is the single,
    // deterministic reconnect-detection path. We intentionally do NOT do a
    // periodic reconciliation in `drivePhaseTimer` because the Colyseus
    // reconnection grace keeps the client in `this.clients` for the full
    // 30 seconds, so a periodic scan would race with the grace window and
    // wrongly clear the missing flag on the original drop.
    //
    // `clearMissing` is itself idempotent and short-circuits when the
    // player isn't in the missing set, so calling it unconditionally and
    // notifying on a `true` return is enough — no need for a pre-check.
    this.auth.onJoin(client);
    if (this.engine.clearMissing(client.sessionId)) {
      this.notifyHostOfPlayerReturned(client.sessionId);
    }
  }

  onDrop(client: Client) {
    this.auth.onDrop(client);
    // Ticket 05: a mid-game drop pauses the phase and notifies the host. The
    // 30-second Colyseus reconnection window is what gives the host the
    // breathing room to call `declareDead`. LOBBY/GAME_OVER drops are no-ops
    // because there is no live phase to pause.
    if (this.engine.pauseForMissing(client.sessionId)) {
      this.notifyHostOfPlayerMissing(client.sessionId);
    }
  }

  onLeave(client: Client) {
    this.auth.onLeave(client);
    // The Colyseus reconnection grace has expired without a reconnect. If
    // the player was still flagged missing, clear the flag now so the phase
    // resumes — the player is gone, but the game must keep moving. The host
    // had a 30s window to call `declareDead` if they wanted the player dead.
    // `clearMissing` is idempotent; no need for a defensive second call.
    if (this.engine.clearMissing(client.sessionId)) {
      this.notifyHostOfPlayerReturned(client.sessionId);
    }
  }

  onDispose() {
    if (this.phaseTimerHandle !== null) {
      clearInterval(this.phaseTimerHandle);
      this.phaseTimerHandle = null;
    }
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

  /**
   * Ticket 06: dead and kicked players are read-only spectators — they stay
   * connected and observe the public state, but cannot send anything. Every
   * player-action handler routes through this gate before touching the
   * engine; host-only handlers skip it (requireHost already guards them and
   * the host is never a game participant).
   *
   * Returns `true` when the sender may act; `false` after sending the
   * player-visible rejection (same wording as the engine's PLAYER_DEAD).
   */
  private requireActiveSender(client: Client): boolean {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.isHost || player.isAlive) return true;
    this.fail(client, "Мертвий гравець не може діяти");
    return false;
  }

  /**
   * Locate the host's connected client (if any). Returns `undefined` when the
   * host seat exists but the client has already dropped.
   */
  private findHostClient(): Client | undefined {
    let hostId = "";
    for (const p of this.state.players.values()) {
      if (p.isHost) {
        hostId = p.sessionId;
        break;
      }
    }
    if (!hostId) return undefined;
    return this.clients.find((c) => c.sessionId === hostId);
  }

  /**
   * Route a ping record to the host's client (if connected). Skip when the
   * host is also the sender or recipient — they already received the record
   * directly.
   */
  private sendPingToHost(fromId: string, toId: string, record: PingRecord): void {
    const host = this.findHostClient();
    if (!host) return;
    if (host.sessionId === fromId || host.sessionId === toId) return;
    host.send("ping", record);
  }

  /**
   * Ticket 07b: per CONTEXT.md "Check delivery", the host observes the same
   * check data in real time for moderation. The actor already received the
   * payload directly from the message handler; we just forward a copy to
   * the host's session if one is connected. The actor is never the host
   * (the host has no role), so no skip-on-actor check is needed.
   */
  private sendCheckResultToHost(type: string, payload: unknown): void {
    const host = this.findHostClient();
    if (!host) return;
    host.send(type, payload);
  }

  /**
   * Ticket 05: notify the host that `sessionId` dropped mid-phase. The host
   * UI uses this to surface a "player missing — declare dead?" affordance.
   * Real-time push, on top of the `PLAYER_MISSING` entry in the action log.
   */
  private notifyHostOfPlayerMissing(sessionId: string): void {
    const host = this.findHostClient();
    if (!host) return;
    host.send("playerMissing", { sessionId });
  }

  /**
   * Ticket 05: notify the host that `sessionId` either reconnected within
   * the grace window OR that the reconnection grace expired without a
   * reconnect (the player has left). In both cases the engine has cleared
   * the missing flag and the phase has resumed; the host UI uses this to
   * dismiss the missing affordance.
   */
  private notifyHostOfPlayerReturned(sessionId: string): void {
    const host = this.findHostClient();
    if (!host) return;
    host.send("playerReturned", { sessionId });
  }

  /**
   * Ticket 05: notify the host that `sessionId` was declared dead. Pairs
   * with the engine's `DEAD_DECLARED` action-log entry; the host UI uses
   * both signals to update the seat badge.
   */
  private notifyHostOfDeclaredDead(sessionId: string): void {
    const host = this.findHostClient();
    if (!host) return;
    host.send("playerDeclaredDead", { sessionId });
  }

  /**
   * Drive the engine's phase timer forward by one wall-clock tick. The
   * engine reacts to EXPIRED events internally (calling nextSpeaker,
   * nextDefense, or pausing the mafia window); the room only needs to route
   * REMINDER events to the host so the UI can surface them. Called by the
   * room's setInterval; also exposed for tests via `_tickPhaseTimerForTest`.
   */
  private drivePhaseTimer(events?: PhaseTimerEvent[]): void {
    const result = events ?? this.engine.tickPhaseTimer();
    for (const event of result) {
      if (event.type === "REMINDER") {
        const host = this.findHostClient();
        host?.send("timerReminder", {
          mode: event.mode,
          remainingSeconds: event.remainingSeconds,
        });
      }
    }
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
        case EngineErrorCode.VOTE_ALREADY_CAST:
          return "Ваш голос уже віддано";
        case EngineErrorCode.GAME_LOCKED:
          return e.message;
      }
    }
    return "Сталася помилка";
  }

  /**
   * Test-only: drive the engine's phase-timer forward by one tick using the
   * current room clock (real Date.now). Mirrors the setInterval callback.
   */
  _tickPhaseTimerForTest(): void {
    this.drivePhaseTimer();
  }

  /**
   * Test-only: drive the phase timer by `deltaMs` past the current wall
   * clock. The room temporarily swaps the engine's clock to `Date.now() +
   * deltaMs`, ticks once, and restores the real-time clock on exit. Use to
   * assert that the room routes reminder/expired events to the host at the
   * right elapsed-second marks without sleeping.
   */
  _driveTimerAtForTest(deltaMs: number): PhaseTimerEvent[] {
    const original = (this.engine as unknown as { clock: () => number }).clock;
    const baseTime = Date.now();
    this.engine._setClockForTest(() => baseTime + deltaMs);
    try {
      const events = this.engine.tickPhaseTimer();
      this.drivePhaseTimer(events);
      return events;
    } finally {
      this.engine._setClockForTest(original);
    }
  }

  /**
   * Test-only (ticket 05): simulate a player dropping by running the same
   * path as the room's `onDrop` handler. This bypasses the Colyseus
   * WebSocket transport so tests don't have to wrestle with closing the
   * underlying connection mid-test. Mirrors `onDrop` exactly so the
   * engine state, action-log entry, and host notification all line up.
   */
  _simulateDropForTest(sessionId: string): void {
    if (this.engine.pauseForMissing(sessionId)) {
      this.notifyHostOfPlayerMissing(sessionId);
    }
  }
}
