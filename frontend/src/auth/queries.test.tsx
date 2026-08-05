import type { AuthUser } from "@poe2/protocol";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  createFakeAuthClient,
  createSilentQueryClient,
  createTestRuntime,
  USER_ONE,
  type TestRuntime,
} from "../test/fakes.ts";
import { TestProviders } from "../test/providers.tsx";
import { AuthRequestError } from "./errors.ts";
import { AUTH_SESSION_KEY, useLogin, useLogout, useRegister, useSession } from "./queries.ts";

const PASSWORD = "correct horse battery staple";
const CREDENTIALS = { username: USER_ONE.username, password: PASSWORD };

function wrapperFor(runtime: TestRuntime) {
  return ({ children }: { children: ReactNode }) => (
    <TestProviders runtime={runtime}>{children}</TestProviders>
  );
}

/** Everything TanStack Query is still holding, serialized for inspection. */
function retainedByQueryClient(runtime: TestRuntime): string {
  const mutations = runtime.queryClient.getMutationCache().getAll();
  const queries = runtime.queryClient.getQueryCache().getAll();

  return JSON.stringify([
    ...mutations.map((mutation) => mutation.state),
    ...queries.map((query) => query.state),
  ]);
}

function rejectWith(code: "invalid_credentials" | "network"): () => Promise<never> {
  return () =>
    Promise.reject(
      new AuthRequestError(
        code === "network"
          ? {
              kind: "network",
              message: "The authentication service could not be reached",
              status: null,
              code: null,
              retryAfterSeconds: null,
            }
          : {
              kind: "http",
              message: "Invalid username or password",
              status: 401,
              code: "invalid_credentials",
              retryAfterSeconds: null,
            },
      ),
    );
}

describe("useSession", () => {
  it("reports a signed-out browser as null rather than an error", async () => {
    const runtime = createTestRuntime();
    const { result } = renderHook(() => useSession(), { wrapper: wrapperFor(runtime) });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("loads the signed-in user into the query cache", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => USER_ONE }),
    });
    const { result } = renderHook(() => useSession(), { wrapper: wrapperFor(runtime) });

    await waitFor(() => {
      expect(result.current.data).toEqual(USER_ONE);
    });

    expect(runtime.queryClient.getQueryData(AUTH_SESSION_KEY)).toEqual(USER_ONE);
  });

  it("surfaces a typed failure the UI can inspect", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({
        fetchSession: () =>
          Promise.reject(
            new AuthRequestError({
              kind: "http",
              message: "Too many authentication attempts; try again later",
              status: 429,
              code: "rate_limited",
              retryAfterSeconds: 300,
            }),
          ),
      }),
      queryClient: createSilentQueryClient(),
    });

    const { result } = renderHook(() => useSession(), { wrapper: wrapperFor(runtime) });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.code).toBe("rate_limited");
    expect(result.current.error?.retryAfterSeconds).toBe(300);
  });
});

describe("useRegister", () => {
  it("writes the new user into the session cache", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ register: async () => USER_ONE }),
    });
    const { result } = renderHook(() => useRegister(), { wrapper: wrapperFor(runtime) });

    await result.current.submit(CREDENTIALS);

    expect(runtime.queryClient.getQueryData(AUTH_SESSION_KEY)).toEqual(USER_ONE);
  });
});

describe("useLogin", () => {
  it("writes the authenticated user into the session cache", async () => {
    const login = vi.fn().mockResolvedValue(USER_ONE);
    const runtime = createTestRuntime({ authClient: createFakeAuthClient({ login }) });
    const { result } = renderHook(() => useLogin(), { wrapper: wrapperFor(runtime) });

    await result.current.submit(CREDENTIALS);

    expect(login).toHaveBeenCalledWith(CREDENTIALS);
    expect(runtime.queryClient.getQueryData(AUTH_SESSION_KEY)).toEqual(USER_ONE);
  });

  it("leaves the session cache alone when the credentials are refused", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ login: rejectWith("invalid_credentials") }),
    });
    const { result } = renderHook(() => useLogin(), { wrapper: wrapperFor(runtime) });

    await expect(result.current.submit(CREDENTIALS)).rejects.toBeInstanceOf(AuthRequestError);

    expect(runtime.queryClient.getQueryData(AUTH_SESSION_KEY)).toBeUndefined();
    await waitFor(() => {
      expect(result.current.error?.code).toBe("invalid_credentials");
    });
  });
});

describe("credential handling", () => {
  it("keeps no password in the query client once a login has succeeded", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ login: async () => USER_ONE }),
    });
    const { result } = renderHook(() => useLogin(), { wrapper: wrapperFor(runtime) });

    await result.current.submit(CREDENTIALS);

    // The hook is deliberately still mounted: the mutation and its variables
    // are alive, and must be holding an emptied envelope rather than a password.
    expect(retainedByQueryClient(runtime)).not.toContain(PASSWORD);
    expect(
      runtime.queryClient
        .getMutationCache()
        .getAll()
        .map((mutation) => mutation.state.variables),
    ).toEqual([{ credentials: null }]);
  });

  it("keeps no password in the query client after a login is refused", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ login: rejectWith("invalid_credentials") }),
    });
    const { result } = renderHook(() => useLogin(), { wrapper: wrapperFor(runtime) });

    await expect(result.current.submit(CREDENTIALS)).rejects.toBeInstanceOf(AuthRequestError);

    expect(retainedByQueryClient(runtime)).not.toContain(PASSWORD);
  });

  it("keeps no password in the query client while the request is still in flight", async () => {
    const release: ((user: AuthUser) => void)[] = [];
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({
        login: () =>
          new Promise<AuthUser>((resolve) => {
            release.push(resolve);
          }),
      }),
    });
    const { result } = renderHook(() => useLogin(), { wrapper: wrapperFor(runtime) });

    const submitted = result.current.submit(CREDENTIALS);
    await waitFor(() => {
      expect(result.current.isPending).toBe(true);
    });

    expect(retainedByQueryClient(runtime)).not.toContain(PASSWORD);

    release[0]?.(USER_ONE);
    await submitted;

    expect(retainedByQueryClient(runtime)).not.toContain(PASSWORD);
  });

  it("keeps no password in the query client after registration", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ register: async () => USER_ONE }),
    });
    const { result } = renderHook(() => useRegister(), { wrapper: wrapperFor(runtime) });

    await result.current.submit(CREDENTIALS);

    expect(retainedByQueryClient(runtime)).not.toContain(PASSWORD);
  });

  it("hands the credentials to the client exactly once", async () => {
    const login = vi.fn().mockResolvedValue(USER_ONE);
    const runtime = createTestRuntime({ authClient: createFakeAuthClient({ login }) });
    const { result } = renderHook(() => useLogin(), { wrapper: wrapperFor(runtime) });

    await result.current.submit(CREDENTIALS);
    await result.current.submit(CREDENTIALS);

    expect(login).toHaveBeenNthCalledWith(1, CREDENTIALS);
    expect(login).toHaveBeenNthCalledWith(2, CREDENTIALS);
    expect(login).toHaveBeenCalledTimes(2);
  });
});

describe("useLogout", () => {
  it("clears the session cache once the server has ended the session", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ fetchSession: async () => USER_ONE }),
    });
    runtime.queryClient.setQueryData(AUTH_SESSION_KEY, USER_ONE);

    const { result } = renderHook(() => useLogout(), { wrapper: wrapperFor(runtime) });
    await result.current.submit();

    expect(runtime.queryClient.getQueryData(AUTH_SESSION_KEY)).toBeNull();
  });

  it("keeps the session when logging out failed", async () => {
    const runtime = createTestRuntime({
      authClient: createFakeAuthClient({ logout: rejectWith("network") }),
    });
    runtime.queryClient.setQueryData(AUTH_SESSION_KEY, USER_ONE);

    const { result } = renderHook(() => useLogout(), { wrapper: wrapperFor(runtime) });
    await expect(result.current.submit()).rejects.toBeInstanceOf(AuthRequestError);

    expect(runtime.queryClient.getQueryData(AUTH_SESSION_KEY)).toEqual(USER_ONE);
  });
});
