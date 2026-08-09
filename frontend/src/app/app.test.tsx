import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  activeGame,
  createFakeAuthClient,
  createSilentQueryClient,
  createTestRuntime,
  GAME_ID,
  USER_ONE,
} from "../test/fakes.ts";
import { renderApp } from "../test/render.tsx";
import { titleFor } from "./document-title.ts";
import { gamePath } from "./routes.ts";

describe("App routing", () => {
  it("waits rather than redirecting while the session is unresolved", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: () => new Promise(() => {}) }),
    });

    renderApp(runtime, "/lobby");

    expect(await screen.findByText("Restoring your session…")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in to play" })).not.toBeInTheDocument();
  });

  it("sends a signed-out visitor to the sign-in page", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => null }),
    });

    renderApp(runtime, "/lobby");

    expect(await screen.findByRole("heading", { name: "Sign in to play" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/signin");
  });

  it("renders the landing page for a signed-out visitor", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => null }),
    });

    renderApp(runtime, "/");

    expect(await screen.findByRole("link", { name: "Sign in to play" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Enter the lobby" })).not.toBeInTheDocument();
  });

  it("offers no call to action until the session is settled", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: () => new Promise(() => {}) }),
    });

    renderApp(runtime, "/");

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Seven by seven.");
    expect(screen.queryByRole("link", { name: "Sign in to play" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Enter the lobby" })).not.toBeInTheDocument();
  });

  it("offers the lobby to a signed-in visitor", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => USER_ONE }),
    });

    renderApp(runtime, "/");

    expect(await screen.findByRole("link", { name: "Enter the lobby" })).toBeInTheDocument();
    await waitFor(() => {
      expect(runtime.live.start).toHaveBeenCalledWith(USER_ONE.id);
    });
  });

  it("renders the lobby for a signed-in visitor", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => USER_ONE }),
    });

    renderApp(runtime, "/lobby");

    expect(
      await screen.findByRole("heading", { name: "Open a seat, or take one" }),
    ).toBeInTheDocument();
  });

  it("reports a session that could not be checked rather than signing the visitor out", async () => {
    const runtime = createTestRuntime({
      queryClient: createSilentQueryClient(),
      authClient: createFakeAuthClient({
        fetchSession: () => Promise.reject(new Error("offline")),
      }),
    });

    renderApp(runtime, "/lobby");

    expect(
      await screen.findByRole("heading", { name: "Your session could not be checked" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/lobby");
  });

  it("sends an unknown path home", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => null }),
    });

    renderApp(runtime, "/tournaments");

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Seven by seven.");
    expect(window.location.pathname).toBe("/");
  });
});

describe("deferred screens", () => {
  /** Direct load exposes the fallback; transitioned navigation keeps prior content painted. */
  it("keeps the shell painted while a deferred screen is still arriving", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => USER_ONE }),
    });

    renderApp(runtime, "/lobby");

    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Skip to content" })).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();

    expect(
      await screen.findByRole("heading", { name: "Open a seat, or take one" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });

  it("reaches a deferred game screen from a cold load of its own URL", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => USER_ONE }),
    });
    runtime.live.store.setState({
      status: "ready",
      userId: USER_ONE.id,
      games: [activeGame()],
      synced: true,
    });

    renderApp(runtime, gamePath(GAME_ID));

    expect(await screen.findByRole("grid")).toBeInTheDocument();
  });
});

describe("document titles", () => {
  it("names the landing page", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => null }),
    });

    renderApp(runtime, "/");

    await screen.findByRole("link", { name: "Sign in to play" });
    expect(document.title).toBe(titleFor("/"));
  });

  it("names the sign-in page", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => null }),
    });

    renderApp(runtime, "/signin");

    await screen.findByRole("heading", { name: "Sign in to play" });
    expect(document.title).toBe(titleFor("/signin"));
  });

  it("names the lobby", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => USER_ONE }),
    });

    renderApp(runtime, "/lobby");

    await screen.findByRole("heading", { name: "Open a seat, or take one" });
    expect(document.title).toBe(titleFor("/lobby"));
  });

  it("names the game without naming the game", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => USER_ONE }),
    });
    runtime.live.store.setState({
      status: "ready",
      userId: USER_ONE.id,
      games: [activeGame()],
      synced: true,
    });

    renderApp(runtime, gamePath(GAME_ID));

    await screen.findByRole("grid");
    expect(document.title).toBe(titleFor(gamePath(GAME_ID)));
    expect(document.title).not.toContain(GAME_ID);
    expect(document.title).not.toContain(USER_ONE.username);
  });

  it("retitles the tab when the visitor moves between screens", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => null }),
    });

    renderApp(runtime, "/");
    await screen.findByRole("link", { name: "Sign in to play" });
    expect(document.title).toBe(titleFor("/"));

    await userEvent.click(screen.getByRole("link", { name: "Sign in to play" }));

    await screen.findByRole("heading", { name: "Sign in to play" });
    expect(document.title).toBe(titleFor("/signin"));
  });
});
