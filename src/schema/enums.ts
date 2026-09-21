export enum GamePhase {
  LOBBY = "LOBBY",

  // *** begin game loop cycle
  NIGHT = "NIGHT",
  DAY_ANNOUNCEMENT = "DAY_ANNOUNCEMENT", // Оголошення жертв
  DAY_BALAGAN = "DAY_BALAGAN",           // Вільні суперечки
  DAY_SPEECHES = "DAY_SPEECHES",         // Промови
  DAY_DEFENSE = "DAY_DEFENSE",           // Захист кандидатів
  DAY_VOTING = "DAY_VOTING",             // Голосування
  // *** end game loop cycle

  GAME_OVER = "GAME_OVER"
}

export enum Role {
  CIVILIAN = "CIVILIAN",
  SHERIFF = "SHERIFF",
  DOCTOR = "DOCTOR",
  MAFIA = "MAFIA",
  DON = "DON"
}

export enum Team {
  RED = "RED",
  BLACK = "BLACK"
}
