import {
  READY_CHECK_MS,
  WS_PROTOCOL_VERSION,
  type ActiveGameSnapshot,
  type AuthUser,
  type FinishedGameSnapshot,
  type GameHistoryEntry,
  type GameHistoryPage,
  type GameOutcome,
  type GameReplay,
  type GameSnapshot,
  type LobbyEntry,
  type PlayerDirectoryEntry,
  type PublicPlayerProfile,
  type ReadyCheckGameSnapshot,
  type TimeControl,
  type WaitingGameSnapshot,
  type WsErrorCode,
  type WsServerMessage,
} from "@poe2/protocol";
import {
  allSquares,
  CELL_COUNT,
  formatSquare,
  parseSquare,
  PLAYER_ONE,
  PLAYER_TWO,
  replay,
  resultIfFull,
  scoreBoard,
  sideToMove,
  type Player,
} from "@poe2/rules";
import { QueryClient } from "@tanstack/react-query";
import { vi, type Mock } from "vitest";

import type { AuthClient } from "../auth/client.ts";
import type { GamesClient } from "../games/client.ts";
import { GamesRequestError } from "../games/errors.ts";
import type { PlayerGamesRequest, PlayersClient } from "../players/client.ts";
import type {
  LiveClient,
  LiveCommandResult,
  PlayMoveInput,
  ReadyCheckCommandInput,
  ResignGameInput,
} from "../live/client.ts";
import { createLiveStore } from "../live/store.ts";
import type { Clock } from "../runtime/clock.ts";
import type { AppRuntime } from "../runtime/context.ts";
import { createAppRuntime } from "../runtime/create-runtime.ts";
import type { MotionPreference } from "../theme/motion.ts";
import type { SystemTheme, Theme, ThemeStorage } from "../theme/theme.ts";

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

export const UNTIMED_TIME_CONTROL = {
  kind: "untimed",
  initialMs: null,
  incrementMs: null,
} as const;

export function waitingGame(
  gameId = GAME_ID,
  playerOne: AuthUser = USER_ONE,
  creatorSeat: Player = PLAYER_ONE,
): WaitingGameSnapshot {
  return {
    id: gameId,
    revision: 0,
    rated: false,
    timeControl: UNTIMED_TIME_CONTROL,
    board: EMPTY_BOARD,
    moves: [],
    scores: { playerOne: 0, playerTwo: 0 },
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    status: "waiting",
    players: { playerOne, playerTwo: null },
    creatorSeat,
    sideToMove: null,
    outcome: null,
    clock: null,
    readyCheck: null,
  };
}

export function readyCheckGame(
  overrides: {
    readonly gameId?: string;
    readonly playerOne?: AuthUser;
    readonly playerTwo?: AuthUser;
    readonly playerOneReady?: boolean;
    readonly playerTwoReady?: boolean;
    readonly generation?: number;
    readonly deadline?: string;
    readonly serverNow?: string;
  } = {},
): ReadyCheckGameSnapshot {
  const serverNow = overrides.serverNow ?? CREATED_AT;
  return {
    id: overrides.gameId ?? GAME_ID,
    revision: 1,
    rated: false,
    timeControl: UNTIMED_TIME_CONTROL,
    board: EMPTY_BOARD,
    moves: [],
    scores: { playerOne: 0, playerTwo: 0 },
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    status: "ready_check",
    players: {
      playerOne: overrides.playerOne ?? USER_ONE,
      playerTwo: overrides.playerTwo ?? USER_TWO,
    },
    sideToMove: null,
    outcome: null,
    clock: null,
    readyCheck: {
      generation: overrides.generation ?? 1,
      playerOneReady: overrides.playerOneReady ?? false,
      playerTwoReady: overrides.playerTwoReady ?? false,
      deadline:
        overrides.deadline ?? new Date(Date.parse(serverNow) + READY_CHECK_MS).toISOString(),
      serverNow,
    },
  };
}

export function activeGame(
  gameId = GAME_ID,
  playerOne: AuthUser = USER_ONE,
  playerTwo: AuthUser = USER_TWO,
): ActiveGameSnapshot {
  return {
    id: gameId,
    revision: 1,
    rated: false,
    timeControl: UNTIMED_TIME_CONTROL,
    board: EMPTY_BOARD,
    moves: [],
    scores: { playerOne: 0, playerTwo: 0 },
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    status: "active",
    readyCheck: null,
    players: { playerOne, playerTwo },
    sideToMove: 1,
    outcome: null,
    clock: null,
  };
}

export function timedActiveGame(
  gameId = GAME_ID,
  options: {
    readonly remainingMs?: { readonly playerOne: number; readonly playerTwo: number };
    readonly runningPlayer?: Player;
    readonly serverNow?: string;
  } = {},
): ActiveGameSnapshot {
  const base = activeGame(gameId);
  const serverNow = options.serverNow ?? "2026-08-04T12:00:00.000Z";
  const remainingMs = options.remainingMs ?? { playerOne: 300_000, playerTwo: 300_000 };
  const runningPlayer = options.runningPlayer ?? PLAYER_ONE;
  const runningBalance =
    runningPlayer === PLAYER_ONE ? remainingMs.playerOne : remainingMs.playerTwo;

  return {
    ...base,
    timeControl: { kind: "timed", initialMs: 300_000, incrementMs: 3_000 },
    clock: {
      remainingMs,
      runningPlayer,
      turnStartedAt: serverNow,
      deadline: new Date(Date.parse(serverNow) + runningBalance).toISOString(),
      serverNow,
    },
  };
}

export function timedOutGame(gameId = GAME_ID): FinishedGameSnapshot {
  const base = activeGame(gameId);
  return {
    ...base,
    status: "finished",
    sideToMove: null,
    timeControl: { kind: "timed", initialMs: 300_000, incrementMs: 3_000 },
    outcome: { reason: "timeout", winner: PLAYER_TWO, finishedAt: FINISHED_AT },
    clock: {
      remainingMs: { playerOne: 0, playerTwo: 270_000 },
      stoppedAt: FINISHED_AT,
    },
  };
}

const FINISHED_AT = "2026-08-04T12:30:00.000Z";

export interface PlayedGameOptions {
  readonly gameId?: string;
  readonly playerOne?: AuthUser;
  readonly playerTwo?: AuthUser;
  readonly resignedBy?: Player;
  readonly rated?: boolean;
}

/** Builds internally consistent snapshots through the real rules. */
export function playedGame(
  notation: readonly string[],
  options: PlayedGameOptions = {},
): GameSnapshot {
  const moves = notation.map((text) => {
    const square = parseSquare(text);
    if (square === null) {
      throw new RangeError(`${text} is not a square`);
    }
    return square;
  });

  const replayed = replay(moves);
  if (!replayed.ok) {
    throw new RangeError(`move ${replayed.index} is not legal`);
  }

  const board = replayed.game.board;
  const scores = scoreBoard(board);
  const result = resultIfFull(board);
  const shared = {
    id: options.gameId ?? GAME_ID,
    revision: moves.length + 1,
    rated: options.rated ?? false,
    timeControl: UNTIMED_TIME_CONTROL,
    clock: null,
    readyCheck: null,
    board,
    moves,
    scores,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    players: {
      playerOne: options.playerOne ?? USER_ONE,
      playerTwo: options.playerTwo ?? USER_TWO,
    },
  };

  const resignedBy = options.resignedBy;
  if (resignedBy !== undefined) {
    return {
      ...shared,
      status: "finished",
      sideToMove: null,
      outcome: {
        reason: "resignation",
        winner: resignedBy === PLAYER_ONE ? PLAYER_TWO : PLAYER_ONE,
        finishedAt: FINISHED_AT,
      },
    };
  }

  return result === null
    ? { ...shared, status: "active", sideToMove: sideToMove(replayed.game), outcome: null }
    : {
        ...shared,
        status: "finished",
        sideToMove: null,
        outcome: { reason: "board_full", winner: result.winner, finishedAt: FINISHED_AT },
      };
}

export function finishedGame(
  gameId = GAME_ID,
  playerOne: AuthUser = USER_ONE,
  playerTwo: AuthUser = USER_TWO,
): GameSnapshot {
  return playedGame(allSquares().map(formatSquare), { gameId, playerOne, playerTwo });
}

export function lobbyEntry(
  gameId = GAME_ID,
  owner: AuthUser = USER_ONE,
  rated = false,
  creatorSeat: Player = PLAYER_ONE,
): LobbyEntry {
  return {
    id: gameId,
    owner,
    creatorSeat,
    rated,
    timeControl: UNTIMED_TIME_CONTROL,
    createdAt: CREATED_AT,
  };
}

export function createMemoryThemeStorage(initial: Theme | null = null): ThemeStorage {
  let stored = initial;

  return {
    read: () => stored,
    write: (theme) => {
      stored = theme;
    },
  };
}

export interface FakeSystemTheme extends SystemTheme {
  emit: (prefersDark: boolean) => void;
}

export function createFakeSystemTheme(initial = false): FakeSystemTheme {
  let prefersDark = initial;
  const listeners = new Set<(value: boolean) => void>();

  return {
    prefersDark: () => prefersDark,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: (value) => {
      prefersDark = value;
      for (const listener of listeners) {
        listener(value);
      }
    },
  };
}

export interface FakeMotionPreference extends MotionPreference {
  set: (prefersReduced: boolean) => void;
}

export function createFakeMotionPreference(initial = false): FakeMotionPreference {
  let prefersReduced = initial;

  return {
    prefersReducedMotion: () => prefersReduced,
    set: (value) => {
      prefersReduced = value;
    },
  };
}

export interface FakeTimer {
  readonly callback: () => void;
  readonly delayMs: number;
  cancelled: boolean;
  fired: boolean;
}

export interface FakeClock extends Clock {
  readonly timers: FakeTimer[];
  pending: () => FakeTimer[];
  fire: () => void;
  advance: (milliseconds: number) => void;
}

/** Deterministic recording clock that never sleeps. */
export function createFakeClock(): FakeClock {
  const timers: FakeTimer[] = [];
  let nowMs = 0;
  const pending = (): FakeTimer[] => timers.filter((timer) => !timer.cancelled && !timer.fired);

  return {
    timers,
    pending,
    now: () => nowMs,
    schedule(callback, delayMs) {
      const timer: FakeTimer = { callback, delayMs, cancelled: false, fired: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    fire() {
      for (const timer of pending()) {
        timer.fired = true;
        timer.callback();
      }
    },
    advance(milliseconds) {
      nowMs += milliseconds;
    },
  };
}

export function sessionReady(user: AuthUser = USER_ONE): WsServerMessage {
  return { type: "session.ready", protocolVersion: WS_PROTOCOL_VERSION, user };
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

export const ACCEPTED: LiveCommandResult = { ok: true, requestId: REQUEST_ID };

export function historyPage(
  games: readonly GameHistoryEntry[] = [],
  overrides: Partial<GameHistoryPage> = {},
): GameHistoryPage {
  return {
    games,
    nextCursor: null,
    ...overrides,
  };
}

export interface HistoryEntryOptions {
  readonly gameId?: string;
  readonly seat?: Player;
  readonly opponent?: AuthUser;
  readonly rated?: boolean;
  readonly reason?: GameOutcome["reason"];
  readonly winner?: Player;
  readonly plies?: number;
  readonly scores?: GameHistoryEntry["scores"];
  readonly ratingChange?: GameHistoryEntry["ratingChange"];
}

export function historyEntry(options: HistoryEntryOptions = {}): GameHistoryEntry {
  return {
    id: options.gameId ?? GAME_ID,
    seat: options.seat ?? PLAYER_ONE,
    opponent: options.opponent ?? USER_TWO,
    rated: options.rated ?? false,
    timeControl: UNTIMED_TIME_CONTROL,
    outcome: {
      reason: options.reason ?? "board_full",
      winner: options.winner ?? PLAYER_ONE,
      finishedAt: FINISHED_AT,
    },
    scores: options.scores ?? { playerOne: 102, playerTwo: 96 },
    plies: options.plies ?? 49,
    ratingChange: options.ratingChange ?? null,
    createdAt: CREATED_AT,
  };
}

/** Builds a legal finished replay, defaulting short records to resignation. */
export function gameReplay(
  notation: readonly string[],
  options: {
    readonly gameId?: string;
    readonly rated?: boolean;
    readonly resignedBy?: Player;
  } = {},
): GameReplay {
  const conceded = options.resignedBy ?? (notation.length < CELL_COUNT ? PLAYER_ONE : undefined);

  const snapshot = playedGame(notation, {
    ...(options.gameId === undefined ? {} : { gameId: options.gameId }),
    ...(options.rated === undefined ? {} : { rated: options.rated }),
    ...(conceded === undefined ? {} : { resignedBy: conceded }),
  });

  if (snapshot.status !== "finished" || snapshot.players.playerTwo === null) {
    throw new Error("expected a finished game with both seats filled");
  }

  return {
    id: snapshot.id,
    players: { playerOne: snapshot.players.playerOne, playerTwo: snapshot.players.playerTwo },
    rated: snapshot.rated,
    timeControl: snapshot.timeControl,
    moves: snapshot.moves,
    clockHistory: null,
    outcome: snapshot.outcome,
    createdAt: snapshot.createdAt,
  };
}

export interface FakeGamesClient extends GamesClient {
  readonly fetchReplay: Mock<(gameId: string, signal?: AbortSignal) => Promise<GameReplay>>;
}

export function createFakeGamesClient(): FakeGamesClient {
  return {
    fetchReplay: vi.fn<(gameId: string, signal?: AbortSignal) => Promise<GameReplay>>(async () => {
      throw new GamesRequestError({
        kind: "http",
        message: "No such game",
        status: 404,
        code: "game_not_found",
      });
    }),
  };
}

export interface FakePlayersClient extends PlayersClient {
  readonly fetchDirectory: Mock<(signal?: AbortSignal) => Promise<readonly PlayerDirectoryEntry[]>>;
  readonly fetchProfile: Mock<
    (username: string, signal?: AbortSignal) => Promise<PublicPlayerProfile>
  >;
  readonly fetchGames: Mock<
    (username: string, request?: PlayerGamesRequest) => Promise<GameHistoryPage>
  >;
}

export function createFakePlayersClient(): FakePlayersClient {
  return {
    fetchDirectory: vi.fn(async () => [
      { id: USER_ONE.id, username: USER_ONE.username, rating: 1500, colorPercentile: 50 },
      { id: USER_TWO.id, username: USER_TWO.username, rating: 1500, colorPercentile: 50 },
    ]),
    fetchGames: vi.fn<(username: string, request?: PlayerGamesRequest) => Promise<GameHistoryPage>>(
      async () => historyPage(),
    ),
    fetchProfile: vi.fn(async (username: string) => ({
      username,
      createdAt: CREATED_AT,
      rating: { value: 1500, deviation: 350, percentile: null },
      ratingHistory: [],
      statistics: {
        totalFinishedGames: 0,
        wins: 0,
        losses: 0,
        ratedWins: 0,
        ratedLosses: 0,
        ratedGames: 0,
        casualGames: 0,
        boardFullGames: 0,
        resignationGames: 0,
        timeoutGames: 0,
      },
    })),
  };
}

export function rejectedCommand(
  code: WsErrorCode,
  message = "The server refused it",
): Extract<LiveCommandResult, { ok: false }> {
  return { ok: false, requestId: REQUEST_ID, failure: "rejected", code, message };
}

export interface FakeLiveClient extends LiveClient {
  readonly start: Mock<(userId: string) => void>;
  readonly stop: Mock<() => void>;
  readonly disconnect: Mock<() => void>;
  readonly createLobby: Mock<
    (rated: boolean, timeControl?: TimeControl, creatorSeat?: Player) => Promise<LiveCommandResult>
  >;
  readonly joinLobby: Mock<(gameId: string) => Promise<LiveCommandResult>>;
  readonly cancelLobby: Mock<(gameId: string) => Promise<LiveCommandResult>>;
  readonly readyGame: Mock<(input: ReadyCheckCommandInput) => Promise<LiveCommandResult>>;
  readonly declineGame: Mock<(input: ReadyCheckCommandInput) => Promise<LiveCommandResult>>;
  readonly playMove: Mock<(input: PlayMoveInput) => Promise<LiveCommandResult>>;
  readonly resignGame: Mock<(input: ResignGameInput) => Promise<LiveCommandResult>>;
}

export function createFakeLiveClient(): FakeLiveClient {
  return {
    store: createLiveStore(),
    start: vi.fn<(userId: string) => void>(),
    stop: vi.fn<() => void>(),
    disconnect: vi.fn<() => void>(),
    createLobby: vi.fn<
      (
        rated: boolean,
        timeControl?: TimeControl,
        creatorSeat?: Player,
      ) => Promise<LiveCommandResult>
    >(async () => ACCEPTED),
    joinLobby: vi.fn<(gameId: string) => Promise<LiveCommandResult>>(async () => ACCEPTED),
    cancelLobby: vi.fn<(gameId: string) => Promise<LiveCommandResult>>(async () => ACCEPTED),
    readyGame: vi.fn<(input: ReadyCheckCommandInput) => Promise<LiveCommandResult>>(
      async () => ACCEPTED,
    ),
    declineGame: vi.fn<(input: ReadyCheckCommandInput) => Promise<LiveCommandResult>>(
      async () => ACCEPTED,
    ),
    playMove: vi.fn<(input: PlayMoveInput) => Promise<LiveCommandResult>>(async () => ACCEPTED),
    resignGame: vi.fn<(input: ResignGameInput) => Promise<LiveCommandResult>>(async () => ACCEPTED),
  };
}

export interface TestRuntime extends AppRuntime {
  readonly live: FakeLiveClient;
  readonly gamesClient: FakeGamesClient;
  readonly playersClient: FakePlayersClient;
  readonly clock: FakeClock;
  readonly motion: FakeMotionPreference;
}

export interface TestRuntimeOptions {
  readonly authClient?: AuthClient;
  readonly gamesClient?: FakeGamesClient;
  readonly playersClient?: FakePlayersClient;
  readonly queryClient?: QueryClient;
  readonly clock?: FakeClock;
  readonly motion?: FakeMotionPreference;
}

export function createTestRuntime(options: TestRuntimeOptions = {}): TestRuntime {
  const live = createFakeLiveClient();
  const gamesClient = options.gamesClient ?? createFakeGamesClient();
  const playersClient = options.playersClient ?? createFakePlayersClient();
  const clock = options.clock ?? createFakeClock();
  const motion = options.motion ?? createFakeMotionPreference();
  const runtime = createAppRuntime({
    authClient: options.authClient ?? createFakeAuthClient(),
    gamesClient,
    playersClient,
    ...(options.queryClient === undefined ? {} : { queryClient: options.queryClient }),
    createLive: () => live,
    clock,
    motion,
  });

  return { ...runtime, live, gamesClient, playersClient, clock, motion };
}

/** Retries turned off so a deliberately failing query settles immediately. */
export function createSilentQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
}
