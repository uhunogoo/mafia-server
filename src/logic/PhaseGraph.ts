import { GamePhase } from "../schema/enums";

// 1. Граф переходів: з якої фази в які дозволено йти
export const PHASE_TRANSITIONS: Record<GamePhase, readonly GamePhase[]> = {
  [GamePhase.LOBBY]: [GamePhase.NIGHT_MAFIA],

  // Ніч іде строго послідовно
  [GamePhase.NIGHT_MAFIA]: [GamePhase.NIGHT_DON_CHECK],
  [GamePhase.NIGHT_DON_CHECK]: [GamePhase.NIGHT_SHERIFF_CHECK],
  [GamePhase.NIGHT_SHERIFF_CHECK]: [GamePhase.NIGHT_DOCTOR_HEAL],
  [GamePhase.NIGHT_DOCTOR_HEAL]: [GamePhase.DAY_ANNOUNCE, GamePhase.GAME_OVER], // GAME_OVER якщо mid-day win

  // День
  [GamePhase.DAY_ANNOUNCE]: [GamePhase.DAY_BALAGAN, GamePhase.DAY_SPEECHES],
  [GamePhase.DAY_BALAGAN]: [GamePhase.DAY_SPEECHES, GamePhase.NIGHT_MAFIA], // В ніч, якщо без номінацій
  [GamePhase.DAY_SPEECHES]: [GamePhase.DAY_DEFENSE, GamePhase.DAY_BALAGAN, GamePhase.NIGHT_MAFIA],
  [GamePhase.DAY_DEFENSE]: [GamePhase.DAY_VOTE],

  // Голосування
  [GamePhase.DAY_VOTE]: [GamePhase.DAY_REVOTE, GamePhase.NIGHT_MAFIA, GamePhase.GAME_OVER],
  [GamePhase.DAY_REVOTE]: [GamePhase.NIGHT_MAFIA, GamePhase.GAME_OVER], // auto-pardon або вибування

  [GamePhase.GAME_OVER]: [], // Фінал, виходу немає
} as const;

// 2. Фази, де пінги ЖОРСТКО заборонені
export const PING_DISABLED_PHASES = new Set<GamePhase>([
  GamePhase.NIGHT_DON_CHECK,
  GamePhase.NIGHT_SHERIFF_CHECK,
  GamePhase.NIGHT_DOCTOR_HEAL,
  GamePhase.DAY_DEFENSE,
  GamePhase.DAY_VOTE,
  GamePhase.DAY_REVOTE,
]);

// 3. Хелпер перевірки валідності переходу
export function canTransitionTo(current: GamePhase, next: GamePhase): boolean {
  return PHASE_TRANSITIONS[current]?.includes(next) ?? false;
}
