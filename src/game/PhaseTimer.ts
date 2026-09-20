/**
 * Server-side timer for game phases. Pure data + arithmetic — no I/O, no
 * setTimeout. The room layer is responsible for translating wall-clock
 * intervals into `tick(now)` calls and routing the resulting events to the
 * host client.
 *
 * Lifecycle:
 *   - `start` arms the timer with a duration and an optional set of reminder
 *     marks (seconds elapsed at which to fire a REMINDER event).
 *   - `tick(now)` advances the timer and returns any events that should fire:
 *     REMINDER for each mark now crossed, EXPIRED when duration is crossed.
 *   - `pause(now)` / `resume(now)` stop/restart the clock without losing
 *     accumulated elapsed time.
 *   - `extend(seconds)` adds seconds to the remaining duration.
 *
 * Multiple events may fire from a single tick (e.g., a long pause followed by
 * a fast resume that crosses several reminder marks at once). Events fire in
 * ascending order.
 */
export type PhaseTimerMode =
  | "MAFIA_WINDOW" // 60s, reminders at 30s and 50s elapsed
  | "SPEECH_TURN"  // 60s per turn (resets on each nextSpeaker)
  | "DEFENSE_TURN" // 30s per turn (resets on each nextDefense)
  | "BALAGAN";     // 90s (Day 2+ — owned by ticket 07; the timer exists here for completeness)

export type PhaseTimerEvent =
  | { type: "REMINDER"; mode: PhaseTimerMode; remainingSeconds: number }
  | { type: "EXPIRED"; mode: PhaseTimerMode };

export interface PhaseTimerSnapshot {
  mode: PhaseTimerMode;
  durationMs: number;
  remainingMs: number;
  paused: boolean;
}

export class PhaseTimer {
  readonly mode: PhaseTimerMode;
  private durationMs: number;
  private startedAt: number;
  private elapsedBeforePauseMs: number;
  private paused: boolean;
  private readonly reminders: readonly number[];
  private lastFiredReminder = -1;
  /**
   * Set once EXPIRED has fired. Subsequent ticks return no events so the
   * engine can't re-fire an EXPIRED from a stale wall-clock call. The
   * engine is expected to replace the timer (per-turn phases) or pause it
   * (mafia window) on EXPIRED.
   */
  private consumed = false;

  constructor(
    mode: PhaseTimerMode,
    durationMs: number,
    reminders: readonly number[],
    now: number,
  ) {
    this.mode = mode;
    this.durationMs = durationMs;
    this.reminders = [...reminders].sort((a, b) => a - b);
    this.startedAt = now;
    this.elapsedBeforePauseMs = 0;
    this.paused = false;
  }

  pause(now: number): void {
    if (this.paused) return;
    this.elapsedBeforePauseMs += now - this.startedAt;
    this.paused = true;
  }

  resume(now: number): void {
    if (!this.paused) return;
    this.startedAt = now;
    this.paused = false;
  }

  extend(seconds: number): void {
    this.durationMs += seconds * 1000;
  }

  isPaused(): boolean {
    return this.paused;
  }

  isExpired(now: number): boolean {
    return this.elapsedMs(now) >= this.durationMs;
  }

  elapsedMs(now: number): number {
    if (this.paused) return this.elapsedBeforePauseMs;
    return this.elapsedBeforePauseMs + (now - this.startedAt);
  }

  remainingMs(now: number): number {
    return Math.max(0, this.durationMs - this.elapsedMs(now));
  }

  /**
   * Advance the timer to `now` and return any events that should fire.
   * Returns an empty array when the timer is paused. Multiple events may fire
   * in a single tick — they are returned in ascending elapsed order. Reminders
   * that have already fired are not re-fired on subsequent ticks.
   */
  tick(now: number): PhaseTimerEvent[] {
    if (this.paused || this.consumed) return [];
    const elapsed = this.elapsedMs(now);
    const events: PhaseTimerEvent[] = [];

    for (const r of this.reminders) {
      if (r > this.lastFiredReminder && elapsed >= r * 1000) {
        this.lastFiredReminder = r;
        // The reminder reports the time remaining *at the mark*, not at the
        // current tick — so a tick which crosses multiple marks at once
        // (e.g., a long pause followed by a fast resume) still tells the
        // host "30s remaining" for the 30s mark and "10s remaining" for the
        // 50s mark.
        const remainingAtMark = Math.max(0, Math.ceil((this.durationMs - r * 1000) / 1000));
        events.push({
          type: "REMINDER",
          mode: this.mode,
          remainingSeconds: remainingAtMark,
        });
      }
    }

    if (elapsed >= this.durationMs) {
      events.push({ type: "EXPIRED", mode: this.mode });
      this.consumed = true;
    }

    return events;
  }

  snapshot(now: number): PhaseTimerSnapshot {
    return {
      mode: this.mode,
      durationMs: this.durationMs,
      remainingMs: this.remainingMs(now),
      paused: this.paused,
    };
  }
}
