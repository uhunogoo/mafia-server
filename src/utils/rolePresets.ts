import { ServerError } from "colyseus";
import { Role } from "../schema/PlayerState.js";

// count: Mafia | Don | Sheriff | Doctor | Civilian
export const ROLE_PRESETS = {
  8:  { mafia: 2, don: 1, sheriff: 1, doc: 1, civ: 3 },
  9:  { mafia: 2, don: 1, sheriff: 1, doc: 1, civ: 4 },
  10: { mafia: 2, don: 1, sheriff: 1, doc: 1, civ: 5 },
  11: { mafia: 3, don: 1, sheriff: 1, doc: 1, civ: 5 },
  12: { mafia: 3, don: 1, sheriff: 1, doc: 1, civ: 6 },
} as const;

// Player count
export type SupportedPlayerCount = keyof typeof ROLE_PRESETS;
export const SUPPORTED_PLAYER_COUNTS = [8, 9, 10, 11, 12] as const;

// Check if count is valid
export function isSupportedPlayerCount(count: number): count is SupportedPlayerCount {
  return count in ROLE_PRESETS;
}

// Role preset
export function getRolePreset(playerCount: number): Role[] {
  const preset = ROLE_PRESETS[playerCount as SupportedPlayerCount];

  if (!preset) {
    const message = playerCount < 8 ? "lobby_too_small" : "lobby_too_full"
    throw new ServerError( 400, message );
  }

  return [
    ...Array(preset.don).fill(Role.DON),
    ...Array(preset.mafia).fill(Role.MAFIA),
    ...Array(preset.sheriff).fill(Role.SHERIFF),
    ...Array(preset.doc).fill(Role.DOCTOR),
    ...Array(preset.civ).fill(Role.CIVILIAN),
  ];
}
