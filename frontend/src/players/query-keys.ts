import { normalizeUsername } from "@poe2/protocol";

/** Viewer-independent keys for public player data. */
export const PLAYER_QUERY_ROOT = ["players"] as const;

export function playerProfileKey(username: string) {
  return [...PLAYER_QUERY_ROOT, normalizeUsername(username), "profile"] as const;
}

export function playerGamesKey(username: string) {
  return [...PLAYER_QUERY_ROOT, normalizeUsername(username), "games"] as const;
}
