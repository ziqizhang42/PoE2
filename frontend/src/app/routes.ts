export const HOME_PATH = "/";
export const SIGN_IN_PATH = "/signin";
export const LOBBY_PATH = "/lobby";
export const GAME_ROUTE = "/game/:gameId";
export const REPLAY_ROUTE = "/replay/:gameId";
export const PLAYER_ROUTE = "/player/:username";

export function gamePath(gameId: string): string {
  return `/game/${encodeURIComponent(gameId)}`;
}

export function replayPath(gameId: string): string {
  return `/replay/${encodeURIComponent(gameId)}`;
}

export function playerPath(username: string): string {
  return `/player/${encodeURIComponent(username)}`;
}

/** Accepts only same-origin absolute return paths, excluding protocol-relative URLs. */
export function returnPath(state: unknown): string {
  if (typeof state !== "object" || state === null || !("from" in state)) {
    return LOBBY_PATH;
  }

  const { from } = state as { from: unknown };

  if (typeof from !== "string" || !from.startsWith("/") || from.startsWith("//")) {
    return LOBBY_PATH;
  }

  return from;
}
