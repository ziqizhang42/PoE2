import type { AuthUser } from "@poe2/protocol";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { httpError, networkError } from "../../auth/errors.ts";
import { createFakeAuthClient, createTestRuntime, USER_ONE } from "../../test/fakes.ts";
import { renderApp } from "../../test/render.tsx";

const PASSWORD = "correct horse battery staple";

function submitButton(name: string): HTMLElement {
  return within(screen.getByRole("form", { name: "Credentials" })).getByRole("button", { name });
}

async function fillCredentials(
  user: ReturnType<typeof userEvent.setup>,
  username = USER_ONE.username,
  password = PASSWORD,
): Promise<void> {
  await user.type(screen.getByLabelText("Username"), username);
  await user.type(screen.getByLabelText("Password"), password);
}

describe("AuthPage", () => {
  it("signs in and returns to the page that asked for a session", async () => {
    const user = userEvent.setup();
    let signedIn = false;
    const login = vi.fn(async (): Promise<AuthUser> => USER_ONE);

    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({
        fetchSession: async () => (signedIn ? USER_ONE : null),
        login,
      }),
    });

    renderApp(runtime, "/lobby");
    await screen.findByRole("heading", { name: "Sign in to play" });

    await fillCredentials(user);
    signedIn = true;
    await user.click(submitButton("Sign in"));

    expect(
      await screen.findByRole("heading", { name: "Create a game or take a seat" }),
    ).toBeInTheDocument();
    expect(login).toHaveBeenCalledWith({ username: USER_ONE.username, password: PASSWORD });
    expect(window.location.pathname).toBe("/lobby");
  });

  it("announces a rejected sign-in without leaving the form", async () => {
    const user = userEvent.setup();
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({
        fetchSession: async () => null,
        login: () =>
          Promise.reject(
            httpError({
              status: 401,
              code: "invalid_credentials",
              message: "Invalid username or password",
              retryAfterSeconds: null,
            }),
          ),
      }),
    });

    renderApp(runtime, "/signin");
    await screen.findByRole("heading", { name: "Sign in to play" });

    await fillCredentials(user);
    await user.click(submitButton("Sign in"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That username and password do not match an account.",
    );
    expect(window.location.pathname).toBe("/signin");
  });

  it("reports an unreachable service in its own words", async () => {
    const user = userEvent.setup();
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({
        fetchSession: async () => null,
        login: () => Promise.reject(networkError()),
      }),
    });

    renderApp(runtime, "/signin");
    await screen.findByRole("heading", { name: "Sign in to play" });

    await fillCredentials(user);
    await user.click(submitButton("Sign in"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The authentication service could not be reached",
    );
  });

  it("registers from the create-account tab", async () => {
    const user = userEvent.setup();
    let signedIn = false;
    const register = vi.fn(async (): Promise<AuthUser> => USER_ONE);

    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({
        fetchSession: async () => (signedIn ? USER_ONE : null),
        register,
      }),
    });

    renderApp(runtime, "/signin?mode=register");
    await screen.findByRole("heading", { name: "Sign in to play" });

    expect(
      screen.getByRole("button", { name: "Create account", pressed: true }),
    ).toBeInTheDocument();

    await fillCredentials(user, "New_Player");
    signedIn = true;
    await user.click(submitButton("Create account"));

    expect(register).toHaveBeenCalledWith({ username: "New_Player", password: PASSWORD });
    expect(
      await screen.findByRole("heading", { name: "Create a game or take a seat" }),
    ).toBeInTheDocument();
  });

  it("names the username the server rejected as taken", async () => {
    const user = userEvent.setup();
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({
        fetchSession: async () => null,
        register: () =>
          Promise.reject(
            httpError({
              status: 409,
              code: "username_taken",
              message: "Username is already taken",
              retryAfterSeconds: null,
            }),
          ),
      }),
    });

    renderApp(runtime, "/signin?mode=register");
    await screen.findByRole("heading", { name: "Sign in to play" });

    await fillCredentials(user);
    await user.click(submitButton("Create account"));

    expect(await screen.findByRole("alert")).toHaveTextContent("That username is taken");
  });

  it("clears a failed attempt when the other tab is chosen", async () => {
    const user = userEvent.setup();
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({
        fetchSession: async () => null,
        login: () => Promise.reject(networkError()),
      }),
    });

    renderApp(runtime, "/signin");
    await screen.findByRole("heading", { name: "Sign in to play" });

    await fillCredentials(user);
    await user.click(submitButton("Sign in"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create account", pressed: false }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toHaveValue("");
  });

  it("checks the shared credential rules before sending anything", async () => {
    const user = userEvent.setup();
    const login = vi.fn(async (): Promise<AuthUser> => USER_ONE);
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => null, login }),
    });

    renderApp(runtime, "/signin");
    await screen.findByRole("heading", { name: "Sign in to play" });

    await fillCredentials(user, "no spaces allowed", "short");
    await user.click(submitButton("Sign in"));

    expect(login).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Username")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
  });

  it("moves focus to the first invalid field, so its message is announced", async () => {
    const user = userEvent.setup();
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => null }),
    });

    renderApp(runtime, "/signin");
    await screen.findByRole("heading", { name: "Sign in to play" });

    await fillCredentials(user, "ab", "short");
    await user.click(submitButton("Sign in"));
    const username = screen.getByLabelText("Username");
    expect(username).toHaveFocus();
    expect(username).toHaveAccessibleDescription(expect.stringContaining("3–32 characters"));

    await user.clear(username);
    await user.type(username, "Player_One");
    await user.click(submitButton("Sign in"));
    expect(screen.getByLabelText("Password")).toHaveFocus();
  });

  it("holds the form back until the session is settled", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: () => new Promise(() => {}) }),
    });

    renderApp(runtime, "/signin");

    expect(await screen.findByText("Restoring your session…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("sends one request however often the form is submitted", async () => {
    const user = userEvent.setup();
    let release = (): void => {};
    const login = vi.fn(
      () =>
        new Promise<AuthUser>((resolve) => {
          release = () => {
            resolve(USER_ONE);
          };
        }),
    );

    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => null, login }),
    });

    renderApp(runtime, "/signin");
    await screen.findByRole("heading", { name: "Sign in to play" });

    await fillCredentials(user);
    await user.click(submitButton("Sign in"));

    const pending = await screen.findByRole("button", { name: "Sign in…" });
    expect(pending).toBeDisabled();
    await user.click(pending);

    expect(login).toHaveBeenCalledTimes(1);
    release();
  });
});
