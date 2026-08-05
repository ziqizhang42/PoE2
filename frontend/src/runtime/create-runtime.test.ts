import { describe, expect, it, vi } from "vitest";

import { AUTH_SESSION_KEY } from "../auth/queries.ts";
import type { LiveClientOptions } from "../live/client.ts";
import { createFakeLiveClient, USER_ONE } from "../test/fakes.ts";
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
});

describe("createQueryClient", () => {
  it("does not refetch on window focus, so a background tab stays quiet", () => {
    expect(createQueryClient().getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false);
  });
});
