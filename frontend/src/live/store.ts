/**
 * Live connection, lobby, and game state.
 *
 * It holds only what the server pushed. No rule is evaluated here: a snapshot
 * is copied in as it arrived, and authentication state stays in TanStack Query.
 */

import type { GameSnapshot, LobbyEntry, WsErrorCode } from "@poe2/protocol";
import { createStore, type StoreApi } from "zustand/vanilla";

export type LiveStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "reconnecting"
  | "disconnected"
  | "unauthenticated";

export interface LiveRejection {
  readonly requestId: string | null;
  readonly code: WsErrorCode;
  readonly message: string;
}

export interface LiveState {
  readonly status: LiveStatus;
  /** Whose live state this is; cleared whenever the connection is given up. */
  readonly userId: string | null;
  readonly lobbies: readonly LobbyEntry[];
  readonly games: readonly GameSnapshot[];
  /** Only rejections that could not be handed back to a caller land here. */
  readonly lastRejection: LiveRejection | null;
  readonly reconnectAttempts: number;
}

export type LiveStore = StoreApi<LiveState>;

export const INITIAL_LIVE_STATE: LiveState = {
  status: "idle",
  userId: null,
  lobbies: [],
  games: [],
  lastRejection: null,
  reconnectAttempts: 0,
};

export function createLiveStore(): LiveStore {
  return createStore<LiveState>(() => ({ ...INITIAL_LIVE_STATE }));
}

export function upsertGame(
  games: readonly GameSnapshot[],
  game: GameSnapshot,
): readonly GameSnapshot[] {
  const index = games.findIndex((candidate) => candidate.id === game.id);

  if (index === -1) {
    return [...games, game];
  }

  const next = games.slice();
  next[index] = game;
  return next;
}

/** Returns the same array when nothing matched, so selectors stay stable. */
export function removeGame(
  games: readonly GameSnapshot[],
  gameId: string,
): readonly GameSnapshot[] {
  const next = games.filter((game) => game.id !== gameId);
  return next.length === games.length ? games : next;
}
