import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  createTestRuntime,
  GAME_ID,
  lobbyEntry,
  OTHER_GAME_ID,
  USER_ONE,
  waitingGame,
  type TestRuntime,
} from "../test/fakes.ts";
import { TestProviders } from "../test/providers.tsx";
import {
  useGame,
  useGames,
  useLastLiveRejection,
  useLiveCommands,
  useLiveStatus,
  useLiveUserId,
  useLobbies,
  usePlayerStatuses,
  useReconnectAttempts,
} from "./hooks.ts";

function wrapperFor(runtime: TestRuntime) {
  return ({ children }: { children: ReactNode }) => (
    <TestProviders runtime={runtime}>{children}</TestProviders>
  );
}

describe("live hooks", () => {
  it("expose the connection state the store holds", () => {
    const runtime = createTestRuntime();
    const { result } = renderHook(
      () => ({
        status: useLiveStatus(),
        userId: useLiveUserId(),
        attempts: useReconnectAttempts(),
      }),
      { wrapper: wrapperFor(runtime) },
    );

    expect(result.current).toEqual({ status: "idle", userId: null, attempts: 0 });

    act(() => {
      runtime.live.store.setState({
        status: "reconnecting",
        userId: USER_ONE.id,
        reconnectAttempts: 2,
      });
    });

    expect(result.current).toEqual({
      status: "reconnecting",
      userId: USER_ONE.id,
      attempts: 2,
    });
  });

  it("expose lobbies, games, and uncorrelated rejections", () => {
    const runtime = createTestRuntime();
    const { result } = renderHook(
      () => ({
        lobbies: useLobbies(),
        games: useGames(),
        players: usePlayerStatuses(),
        rejection: useLastLiveRejection(),
      }),
      { wrapper: wrapperFor(runtime) },
    );

    act(() => {
      runtime.live.store.setState({
        lobbies: [lobbyEntry()],
        games: [waitingGame()],
        playerStatuses: [{ id: USER_ONE.id, online: true, activity: "open_room" }],
        lastRejection: { requestId: null, code: "invalid_message", message: "bad frame" },
      });
    });

    expect(result.current.lobbies).toEqual([lobbyEntry()]);
    expect(result.current.games).toEqual([waitingGame()]);
    expect(result.current.players).toEqual([
      { id: USER_ONE.id, online: true, activity: "open_room" },
    ]);
    expect(result.current.rejection?.code).toBe("invalid_message");
  });

  it("selects one game by id and keeps the reference stable across renders", () => {
    const runtime = createTestRuntime();
    const game = waitingGame();
    runtime.live.store.setState({ games: [game] });

    const { result, rerender } = renderHook(() => useGame(GAME_ID), {
      wrapper: wrapperFor(runtime),
    });

    const first = result.current;
    rerender();

    expect(first).toBe(game);
    expect(result.current).toBe(game);
  });

  it("returns null for a game the browser does not hold", () => {
    const runtime = createTestRuntime();
    const { result } = renderHook(() => useGame(OTHER_GAME_ID), { wrapper: wrapperFor(runtime) });

    expect(result.current).toBeNull();
  });

  it("hand out the command facade itself, so it never changes identity", () => {
    const runtime = createTestRuntime();
    const { result, rerender } = renderHook(() => useLiveCommands(), {
      wrapper: wrapperFor(runtime),
    });

    const first = result.current;
    rerender();

    expect(result.current).toBe(first);
    expect(typeof first.playMove).toBe("function");
  });
});
