import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { networkError } from "../auth/errors.ts";
import { AUTH_SESSION_KEY } from "../auth/queries.ts";
import { createFakeAuthClient, createTestRuntime, USER_ONE } from "../test/fakes.ts";
import { renderApp } from "../test/render.tsx";

describe("SessionNav", () => {
  it("reports that the session is still being checked", () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: () => new Promise(() => {}) }),
    });

    renderApp(runtime, "/");

    expect(screen.getByRole("status")).toHaveTextContent("Checking session…");
  });

  it("offers sign-in to a signed-out visitor", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => null }),
    });

    renderApp(runtime, "/");

    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/signin");
    expect(screen.queryByRole("link", { name: "Lobby" })).not.toBeInTheDocument();
  });

  it("signs out and returns to the landing page", async () => {
    const user = userEvent.setup();
    let signedIn = true;
    const logout = vi.fn(async () => {
      signedIn = false;
    });

    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({
        fetchSession: async () => (signedIn ? USER_ONE : null),
        logout,
      }),
    });

    renderApp(runtime, "/lobby");
    await screen.findByRole("heading", { name: "Open a seat, or take one" });

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(logout).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("link", { name: "Sign in to play" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });

  it("keeps the session when signing out fails", async () => {
    const user = userEvent.setup();
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({
        fetchSession: async () => USER_ONE,
        logout: () => Promise.reject(networkError()),
      }),
    });

    renderApp(runtime, "/lobby");
    await screen.findByRole("heading", { name: "Open a seat, or take one" });

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Sign out failed");
    expect(window.location.pathname).toBe("/lobby");
  });

  describe("the two ways a session can end", () => {
    it("remembers nowhere to return to after a deliberate sign-out", async () => {
      const user = userEvent.setup();
      let signedIn = true;
      const runtime = createTestRuntime({
        authClient: createFakeAuthClient({
          fetchSession: async () => (signedIn ? USER_ONE : null),
          logout: async () => {
            signedIn = false;
          },
        }),
      });

      renderApp(runtime, "/lobby");
      await screen.findByRole("heading", { name: "Open a seat, or take one" });

      await user.click(screen.getByRole("button", { name: "Sign out" }));

      expect(await screen.findByRole("link", { name: "Sign in to play" })).toBeInTheDocument();
      expect(window.location.pathname).toBe("/");
    });

    it("keeps the return destination when a session ends on its own", async () => {
      const runtime = createTestRuntime({
        authClient: createFakeAuthClient({ fetchSession: async () => USER_ONE }),
      });

      renderApp(runtime, "/lobby");
      await screen.findByRole("heading", { name: "Open a seat, or take one" });

      runtime.queryClient.setQueryData(AUTH_SESSION_KEY, null);

      expect(
        await screen.findByRole("heading", { name: "Sign in to play", level: 1 }),
      ).toBeInTheDocument();
      expect(window.location.pathname).toBe("/signin");
    });

    it("clears deliberate sign-out intent before a later session ends", async () => {
      const user = userEvent.setup();
      let signedIn = true;
      const runtime = createTestRuntime({
        authClient: createFakeAuthClient({
          fetchSession: async () => (signedIn ? USER_ONE : null),
          logout: async () => {
            signedIn = false;
          },
          login: async () => {
            signedIn = true;
            return USER_ONE;
          },
        }),
      });

      renderApp(runtime, "/lobby");
      await screen.findByRole("heading", { name: "Open a seat, or take one" });
      await user.click(screen.getByRole("button", { name: "Sign out" }));
      await user.click(await screen.findByRole("link", { name: "Sign in to play" }));

      const form = within(await screen.findByRole("form", { name: "Credentials" }));
      await user.type(form.getByLabelText("Username"), USER_ONE.username);
      await user.type(form.getByLabelText("Password"), "correct horse battery staple");
      await user.click(form.getByRole("button", { name: "Sign in" }));
      await screen.findByRole("heading", { name: "Open a seat, or take one" });

      runtime.queryClient.setQueryData(AUTH_SESSION_KEY, null);

      expect(
        await screen.findByRole("heading", { name: "Sign in to play", level: 1 }),
      ).toBeInTheDocument();
      expect(window.location.pathname).toBe("/signin");
    });
  });
});
