import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { AUTH_SESSION_KEY, useLogin, useLogout } from "../auth/queries.ts";
import {
  createFakeAuthClient,
  createSilentQueryClient,
  createTestRuntime,
  GAME_ID,
  gameReplay,
  USER_ONE,
  USER_TWO,
  type TestRuntime,
} from "../test/fakes.ts";
import { TestProviders } from "../test/providers.tsx";
import { gameReplayKey } from "./query-keys.ts";
import { useGameReplay } from "./queries.ts";

const PASSWORD = "correct horse battery staple";

function wrapperFor(runtime: TestRuntime) {
  return ({ children }: { children: ReactNode }) => (
    <TestProviders runtime={runtime}>{children}</TestProviders>
  );
}

describe("replay query state", () => {
  it("keys a replay by game alone, with no viewer segment", () => {
    expect(gameReplayKey(GAME_ID)).not.toContain(USER_ONE.id);
    expect(gameReplayKey(GAME_ID)).toEqual(gameReplayKey(GAME_ID));
  });

  it("keeps a cached replay across a logout and a different login", async () => {
    const replay = gameReplay(["d4"]);
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({
        fetchSession: async () => USER_ONE,
        login: async () => USER_TWO,
      }),
      queryClient: createSilentQueryClient(),
    });
    runtime.gamesClient.fetchReplay.mockResolvedValue(replay);

    runtime.queryClient.setQueryData(AUTH_SESSION_KEY, USER_ONE);
    runtime.queryClient.setQueryData(gameReplayKey(GAME_ID), replay);

    const actions = renderHook(() => ({ login: useLogin(), logout: useLogout() }), {
      wrapper: wrapperFor(runtime),
    });

    await actions.result.current.logout.submit();
    await actions.result.current.login.submit({ username: USER_TWO.username, password: PASSWORD });
    expect(runtime.queryClient.getQueryData(AUTH_SESSION_KEY)).toEqual(USER_TWO);

    const games = renderHook(() => useGameReplay(GAME_ID), { wrapper: wrapperFor(runtime) });

    expect(games.result.current.data).toEqual(replay);
    expect(runtime.gamesClient.fetchReplay).not.toHaveBeenCalled();
  });

  it("reports a game that is not there rather than retrying it", async () => {
    const runtime = createTestRuntime({ queryClient: createSilentQueryClient() });

    const games = renderHook(() => useGameReplay(GAME_ID), { wrapper: wrapperFor(runtime) });

    await waitFor(() => {
      expect(games.result.current.isError).toBe(true);
    });
    expect(games.result.current.error?.code).toBe("game_not_found");
    expect(runtime.gamesClient.fetchReplay).toHaveBeenCalledTimes(1);
  });
});
