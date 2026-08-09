/** Viewer-independent keys for public finished games. */
export const GAMES_QUERY_ROOT = ["games"] as const;

export function gameReplayKey(gameId: string) {
  return [...GAMES_QUERY_ROOT, "replay", gameId] as const;
}
