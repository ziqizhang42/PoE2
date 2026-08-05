/**
 * The UI-facing view of the live connection.
 *
 * Every selector returns a value the store already holds, so nothing here
 * derives, sorts, or recomputes game state on render.
 */

import type { GameSnapshot, LobbyEntry } from "@poe2/protocol";
import { useStore } from "zustand";

import { useLiveClient } from "../runtime/context.ts";
import type { LiveCommands } from "./client.ts";
import type { LiveRejection, LiveState, LiveStatus } from "./store.ts";

function useLiveState<T>(selector: (state: LiveState) => T): T {
  return useStore(useLiveClient().store, selector);
}

export function useLiveStatus(): LiveStatus {
  return useLiveState((state) => state.status);
}

export function useLiveUserId(): string | null {
  return useLiveState((state) => state.userId);
}

export function useLobbies(): readonly LobbyEntry[] {
  return useLiveState((state) => state.lobbies);
}

export function useGames(): readonly GameSnapshot[] {
  return useLiveState((state) => state.games);
}

export function useGame(gameId: string): GameSnapshot | null {
  return useLiveState((state) => state.games.find((game) => game.id === gameId) ?? null);
}

export function useLastLiveRejection(): LiveRejection | null {
  return useLiveState((state) => state.lastRejection);
}

export function useReconnectAttempts(): number {
  return useLiveState((state) => state.reconnectAttempts);
}

export function useLiveCommands(): LiveCommands {
  return useLiveClient();
}
