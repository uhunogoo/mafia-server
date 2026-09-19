export enum GamePhase {
  LOBBY = "LOBBY",

  // *** begin game loop cycle
  NIGHT = "NIGHT",
  DAY_ANNOUNCEMENT = "DAY_ANNOUNCEMENT", // Оголошення жертв
  DAY_SPEECHES = "DAY_SPEECHES",         // Промови (1 хв кожен)
  DAY_BALAGAN = "DAY_BALAGAN",           // Вільні суперечки (1-2 хв); пропускається у День 1
  DAY_DEFENSE = "DAY_DEFENSE",           // Захист кандидатів (30 с)
  DAY_VOTING = "DAY_VOTING",             // Голосування
  // *** end game loop cycle

  GAME_OVER = "GAME_OVER",
}

export enum Role {
  CIVILIAN = "CIVILIAN",
  SHERIFF = "SHERIFF",
  DOCTOR = "DOCTOR",
  MAFIA = "MAFIA",
  DON = "DON",
}

export enum Team {
  RED = "RED",
  BLACK = "BLACK",
}

/**
 * Active sub-step inside the NIGHT phase.
 * Night 1 (test night) walks through all four INTRO steps without collecting actions.
 * Night 2+ collects one action per step in order: MAFIA → DON → SHERIFF → DOCTOR.
 */
export enum NightStep {
  MAFIA = "MAFIA",
  DON = "DON",
  SHERIFF = "SHERIFF",
  DOCTOR = "DOCTOR",
  RESOLVE = "RESOLVE",
}