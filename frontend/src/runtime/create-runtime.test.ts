import { describe, expect, it, vi } from "vitest";

import { AUTH_SESSION_KEY } from "../auth/queries.ts";
import { GAMES_QUERY_ROOT } from "../games/query-keys.ts";
import type { LiveClientOptions } from "../live/client.ts";
import { PLAYER_DIRECTORY_KEY, PLAYER_QUERY_ROOT } from "../players/query-keys.ts";
import { createFakeClock, createFakeLiveClient, USER_ONE } from "../test/fakes.ts";
import { createAppRuntime } from "./create-runtime.ts";
import { createQueryClient } from "./query-client.ts";

describe("createAppRuntime", () => {
  it("gives each runtime its own query cache", () => {
    const first = createAppRuntime({ createLive: () => createFakeLiveClient() });
    const second = createAppRuntime({ createLive: () => createFakeLiveClient() });

    first.queryClient.setQueryData(AUTH_SESSION_KEY, USER_ONE);

    expect(second.queryClient.getQueryData(AUTH_SESSION_KEY)).toBeUndefined();
  });

  it("routes the socket's suspicion back to the authentication query", () => {
    const queryClient = createQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    const captured: LiveClientOptions[] = [];

    createAppRuntime({
      queryClient,
      createLive: (options) => {
        captured.push(options);
        return createFakeLiveClient();
      },
    });

    expect(captured[0]?.onSessionSuspect).toBeTypeOf("function");
    captured[0]?.onSessionSuspect?.();

    expect(invalidate).toHaveBeenCalledWith({ queryKey: AUTH_SESSION_KEY });
  });

  it("invalidates every public profile after a finished game", () => {
    const queryClient = createQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    const captured: LiveClientOptions[] = [];

    createAppRuntime({
      queryClient,
      createLive: (options) => {
        captured.push(options);
        return createFakeLiveClient();
      },
    });

    captured[0]?.onGameHistoryStale?.(USER_ONE.id);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: PLAYER_QUERY_ROOT });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: GAMES_QUERY_ROOT });
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("invalidates only the directory for a player-change push", () => {
    const queryClient = createQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    const captured: LiveClientOptions[] = [];

    createAppRuntime({
      queryClient,
      createLive: (options) => {
        captured.push(options);
        return createFakeLiveClient();
      },
    });

    captured[0]?.onPlayerDirectoryStale?.();

    expect(invalidate).toHaveBeenCalledWith({ queryKey: PLAYER_DIRECTORY_KEY, exact: true });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("hands the live client its own clock, so there is one timer seam", () => {
    const clock = createFakeClock();
    const captured: LiveClientOptions[] = [];

    const runtime = createAppRuntime({
      clock,
      createLive: (options) => {
        captured.push(options);
        return createFakeLiveClient();
      },
    });

    expect(captured[0]?.clock).toBe(clock);
    expect(runtime.clock).toBe(clock);
  });

  it("reads a motion preference without one having to be supplied", () => {
    const runtime = createAppRuntime({ createLive: () => createFakeLiveClient() });

    expect(runtime.motion.prefersReducedMotion()).toBe(false);
  });
});

describe("createQueryClient", () => {
  it("does not refetch on window focus, so a background tab stays quiet", () => {
    expect(createQueryClient().getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false);
  });
});
