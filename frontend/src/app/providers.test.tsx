import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createFakeAuthClient, createTestRuntime, USER_ONE } from "../test/fakes.ts";
import { renderApp } from "../test/render.tsx";

describe("AppProviders", () => {
  it("runs the headless runtime beside the application shell", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => USER_ONE }),
    });

    renderApp(runtime, "/");

    await waitFor(() => {
      expect(runtime.live.start).toHaveBeenCalledWith(USER_ONE.id);
    });

    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Dark theme" })).toBeInTheDocument();
  });

  it("stops the live client when the session ends", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => null }),
    });

    renderApp(runtime, "/");

    await waitFor(() => {
      expect(runtime.live.stop).toHaveBeenCalled();
    });
    expect(runtime.live.start).not.toHaveBeenCalled();
  });
});
