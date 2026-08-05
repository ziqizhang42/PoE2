import type { AuthUser, GameSnapshot, LobbyEntry, WsServerMessage } from "@poe2/protocol";
import { QueryClient } from "@tanstack/react-query";
import { vi, type Mock } from "vitest";

import type { AuthClient } from "../auth/client.ts";
import type { LiveClient, LiveCommandResult } from "../live/client.ts";
import { createLiveStore } from "../live/store.ts";
import type { AppRuntime } from "../runtime/context.ts";
import { createAppRuntime } from "../runtime/create-runtime.ts";

export const USER_ONE: AuthUser = {
  id: "e4aa457e-7620-4f14-ae26-6c20f3995ee1",
  username: "Player_One",
};

export const USER_TWO: AuthUser = {
  id: "9b5b3f42-9f3f-4a4e-9c1f-5d3a2c1b0e77",
  username: "Player_Two",
};

export const GAME_ID = "6f1f4a52-3d6a-4a37-8f0d-1f1a0bb6b6c1";
export const OTHER_GAME_ID = "2c9f0e1d-4a3b-4c5d-8e6f-7a8b9c0d1e2f";
export const REQUEST_ID = "0f2b6b2a-3d70-4ad6-b34e-2d34e8f1e0d5";

const CREATED_AT = "2026-08-04T12:00:00.000Z";

const EMPTY_BOARD: GameSnapshot["board"] = Array.from({ length: 49 }, () => 0 as const);

export function waitingGame(gameId = GAME_ID, playerOne: AuthUser = USER_ONE): GameSnapshot {
  return {
    id: gameId,
    revision: 0,
    board: EMPTY_BOARD,
    moves: [],
    scores: { playerOne: 0, playerTwo: 0 },
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    status: "waiting",
    players: { playerOne, playerTwo: null },
    sideToMove: null,
    result: null,
  };
}

export function lobbyEntry(gameId = GAME_ID, playerOne: AuthUser = USER_ONE): LobbyEntry {
  return { id: gameId, playerOne, createdAt: CREATED_AT };
}

export function sessionReady(user: AuthUser = USER_ONE): WsServerMessage {
  return { type: "session.ready", protocolVersion: 1, user };
}

export function createFakeAuthClient(overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    fetchSession: async () => null,
    register: async () => USER_ONE,
    login: async () => USER_ONE,
    logout: async () => {},
    ...overrides,
  };
}

export interface FakeLiveClient extends LiveClient {
  readonly start: Mock<(userId: string) => void>;
  readonly stop: Mock<() => void>;
  readonly disconnect: Mock<() => void>;
}

export function createFakeLiveClient(): FakeLiveClient {
  const disconnected: LiveCommandResult = {
    ok: false,
    requestId: REQUEST_ID,
    failure: "not_connected",
    code: null,
    message: null,
  };

  return {
    store: createLiveStore(),
    start: vi.fn<(userId: string) => void>(),
    stop: vi.fn<() => void>(),
    disconnect: vi.fn<() => void>(),
    createLobby: async () => disconnected,
    joinLobby: async () => disconnected,
    cancelLobby: async () => disconnected,
    playMove: async () => disconnected,
  };
}

export interface TestRuntime extends AppRuntime {
  readonly live: FakeLiveClient;
}

export interface TestRuntimeOptions {
  readonly authClient?: AuthClient;
  readonly queryClient?: QueryClient;
}

export function createTestRuntime(options: TestRuntimeOptions = {}): TestRuntime {
  const live = createFakeLiveClient();
  const runtime = createAppRuntime({
    authClient: options.authClient ?? createFakeAuthClient(),
    ...(options.queryClient === undefined ? {} : { queryClient: options.queryClient }),
    createLive: () => live,
  });

  return { ...runtime, live };
}

/** Retries turned off so a deliberately failing query settles immediately. */
export function createSilentQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
}
