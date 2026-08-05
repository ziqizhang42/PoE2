import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createFakeAuthClient, createTestRuntime, USER_ONE } from "../test/fakes.ts";
import { App } from "./app.tsx";
import { AppProviders } from "./providers.tsx";

describe("AppProviders", () => {
  it("runs the headless runtime and leaves the page visually unchanged", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => USER_ONE }),
    });

    render(
      <AppProviders runtime={runtime}>
        <App />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(runtime.live.start).toHaveBeenCalledWith(USER_ONE.id);
    });

    const main = screen.getByRole("main");
    expect(main).toBeInTheDocument();
    expect(main).toBeEmptyDOMElement();
  });
});
