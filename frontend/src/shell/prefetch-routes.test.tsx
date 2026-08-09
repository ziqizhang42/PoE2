import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DEFERRED_ROUTE_IMPORTS } from "../app/lazy-routes.ts";
import {
  createFakeAuthClient,
  createTestRuntime,
  USER_ONE,
  type TestRuntime,
} from "../test/fakes.ts";
import { TestProviders } from "../test/providers.tsx";
import { PrefetchRoutes } from "./prefetch-routes.tsx";

function mount(runtime: TestRuntime, imports: readonly (() => Promise<unknown>)[]) {
  return render(
    <TestProviders runtime={runtime}>
      <PrefetchRoutes imports={imports} />
    </TestProviders>,
  );
}

describe("PrefetchRoutes", () => {
  it("warms the deferred screens once a session is confirmed", async () => {
    const load = vi.fn(async () => {});
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => USER_ONE }),
    });

    mount(runtime, [load]);

    await waitFor(() => {
      expect(load).toHaveBeenCalledTimes(1);
    });
  });

  it("fetches nothing for a visitor who cannot open either screen", async () => {
    const load = vi.fn(async () => {});
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => null }),
    });

    mount(runtime, [load]);

    await waitFor(() => {
      expect(runtime.queryClient.isFetching()).toBe(0);
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("fetches nothing while the session is still unresolved", () => {
    const load = vi.fn(async () => {});
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: () => new Promise(() => {}) }),
    });

    mount(runtime, [load]);

    expect(load).not.toHaveBeenCalled();
  });

  it("survives an import that fails, because it is only an optimisation", async () => {
    const load = vi.fn(async () => {
      throw new Error("chunk did not load");
    });
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => USER_ONE }),
    });

    mount(runtime, [load]);

    await waitFor(() => {
      expect(load).toHaveBeenCalled();
    });
  });

  it("warms every deferred screen by default", () => {
    expect(DEFERRED_ROUTE_IMPORTS).toHaveLength(4);
  });
});
