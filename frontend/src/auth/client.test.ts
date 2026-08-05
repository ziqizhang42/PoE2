import type { AuthUser } from "@poe2/protocol";
import { describe, expect, it, vi } from "vitest";

import { USER_ONE } from "../test/fakes.ts";
import { createAuthClient, parseRetryAfterSeconds, type FetchLike } from "./client.ts";
import { AuthRequestError } from "./errors.ts";

const PASSWORD = "correct horse battery staple";
const CREDENTIALS = { username: USER_ONE.username, password: PASSWORD };

interface Recorded {
  readonly path: string;
  readonly init: RequestInit | undefined;
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function stubFetch(...responses: unknown[]): {
  readonly fetch: FetchLike;
  readonly calls: Recorded[];
} {
  const calls: Recorded[] = [];
  let index = 0;

  const fetch: FetchLike = (path, init) => {
    calls.push({ path, init });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;

    return next instanceof Response ? Promise.resolve(next) : Promise.reject(next);
  };

  return { fetch, calls };
}

async function captureError(operation: Promise<unknown>): Promise<AuthRequestError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(AuthRequestError);
    return error as AuthRequestError;
  }

  throw new Error("expected the operation to reject");
}

describe("fetchSession", () => {
  it("returns the validated user for a live session", async () => {
    const { fetch, calls } = stubFetch(jsonResponse(200, { user: USER_ONE }));

    await expect(createAuthClient({ fetch }).fetchSession()).resolves.toEqual(USER_ONE);

    expect(calls[0]?.path).toBe("/api/auth/session");
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[0]?.init?.credentials).toBe("same-origin");
  });

  it("treats a schema-valid unauthenticated 401 as the ordinary signed-out state", async () => {
    const { fetch } = stubFetch(
      jsonResponse(401, { code: "unauthenticated", message: "Authentication required" }),
    );

    await expect(createAuthClient({ fetch }).fetchSession()).resolves.toBeNull();
  });

  it.each([
    ["an empty body", new Response(null, { status: 401 })],
    ["a body that is not JSON", new Response("Unauthorized", { status: 401 })],
    ["a body missing the code", jsonResponse(401, { message: "Authentication required" })],
    ["an unknown code", jsonResponse(401, { code: "expired", message: "Session expired" })],
  ])("does not report %s on a 401 as signed out", async (_label, response) => {
    const { fetch } = stubFetch(response);

    const error = await captureError(createAuthClient({ fetch }).fetchSession());

    expect(error.kind).toBe("protocol");
    expect(error.status).toBe(401);
  });

  it("raises a schema-valid 401 that is not the signed-out answer", async () => {
    const { fetch } = stubFetch(
      jsonResponse(401, { code: "invalid_credentials", message: "Invalid username or password" }),
    );

    const error = await captureError(createAuthClient({ fetch }).fetchSession());

    expect(error.kind).toBe("http");
    expect(error.code).toBe("invalid_credentials");
  });

  it("forwards an abort signal and rethrows the cancellation unchanged", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("aborted", "AbortError");
    const { fetch, calls } = stubFetch(abortError);
    const client = createAuthClient({ fetch });

    await expect(client.fetchSession(controller.signal)).rejects.toBe(abortError);
    expect(calls[0]?.init?.signal).toBe(controller.signal);
  });

  it("reports an unreachable service as a network failure", async () => {
    const { fetch } = stubFetch(new TypeError("Failed to fetch"));

    const error = await captureError(createAuthClient({ fetch }).fetchSession());

    expect(error.kind).toBe("network");
    expect(error.status).toBeNull();
    expect(error.code).toBeNull();
  });

  it("rejects a success body that does not match the shared schema", async () => {
    const { fetch } = stubFetch(jsonResponse(200, { user: { id: "not-a-uuid", username: "x" } }));

    const error = await captureError(createAuthClient({ fetch }).fetchSession());

    expect(error.kind).toBe("protocol");
    expect(error.status).toBe(200);
  });

  it("rejects a body that is not JSON at all", async () => {
    const { fetch } = stubFetch(new Response("<html>gateway</html>", { status: 200 }));

    const error = await captureError(createAuthClient({ fetch }).fetchSession());

    expect(error.kind).toBe("protocol");
  });
});

describe("register", () => {
  it("returns the user created by a 201", async () => {
    const { fetch, calls } = stubFetch(jsonResponse(201, { user: USER_ONE }));

    await expect(createAuthClient({ fetch }).register(CREDENTIALS)).resolves.toEqual(USER_ONE);

    expect(calls[0]?.path).toBe("/api/auth/register");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(JSON.stringify(CREDENTIALS));
  });

  it("preserves the status, code, and safe message of a taken username", async () => {
    const { fetch } = stubFetch(
      jsonResponse(409, { code: "username_taken", message: "Username is already in use" }),
    );

    const error = await captureError(createAuthClient({ fetch }).register(CREDENTIALS));

    expect(error.kind).toBe("http");
    expect(error.status).toBe(409);
    expect(error.code).toBe("username_taken");
    expect(error.message).toBe("Username is already in use");
  });

  it("preserves Retry-After when the service sheds load", async () => {
    const { fetch } = stubFetch(
      jsonResponse(
        503,
        { code: "temporarily_unavailable", message: "Authentication is temporarily unavailable" },
        { "retry-after": "1" },
      ),
    );

    const error = await captureError(createAuthClient({ fetch }).register(CREDENTIALS));

    expect(error.code).toBe("temporarily_unavailable");
    expect(error.retryAfterSeconds).toBe(1);
  });

  it("never carries the submitted password in the error it raises", async () => {
    const { fetch } = stubFetch(
      jsonResponse(409, { code: "username_taken", message: "Username is already in use" }),
    );

    const error = await captureError(createAuthClient({ fetch }).register(CREDENTIALS));

    expect(JSON.stringify({ ...error, message: error.message, stack: error.stack })).not.toContain(
      PASSWORD,
    );
  });
});

describe("login", () => {
  it("returns the user behind a 200", async () => {
    const { fetch, calls } = stubFetch(jsonResponse(200, { user: USER_ONE }));

    await expect(createAuthClient({ fetch }).login(CREDENTIALS)).resolves.toEqual(USER_ONE);
    expect(calls[0]?.path).toBe("/api/auth/login");
  });

  it("surfaces invalid credentials as an http failure", async () => {
    const { fetch } = stubFetch(
      jsonResponse(401, { code: "invalid_credentials", message: "Invalid username or password" }),
    );

    const error = await captureError(createAuthClient({ fetch }).login(CREDENTIALS));

    expect(error.kind).toBe("http");
    expect(error.status).toBe(401);
    expect(error.code).toBe("invalid_credentials");
  });

  it("preserves the rate-limit hint", async () => {
    const { fetch } = stubFetch(
      jsonResponse(
        429,
        { code: "rate_limited", message: "Too many authentication attempts; try again later" },
        { "retry-after": "300" },
      ),
    );

    const error = await captureError(createAuthClient({ fetch }).login(CREDENTIALS));

    expect(error.code).toBe("rate_limited");
    expect(error.retryAfterSeconds).toBe(300);
  });

  it("keeps Retry-After even when the error body itself is unusable", async () => {
    const { fetch } = stubFetch(
      new Response("too many", { status: 429, headers: { "retry-after": "300" } }),
    );

    const error = await captureError(createAuthClient({ fetch }).login(CREDENTIALS));

    expect(error.kind).toBe("protocol");
    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(300);
  });
});

describe("logout", () => {
  it("sends a DELETE and resolves on 204", async () => {
    const { fetch, calls } = stubFetch(new Response(null, { status: 204 }));

    await expect(createAuthClient({ fetch }).logout()).resolves.toBeUndefined();

    expect(calls[0]?.path).toBe("/api/auth/session");
    expect(calls[0]?.init?.method).toBe("DELETE");
  });

  it("raises the validated failure when the service refuses", async () => {
    const { fetch } = stubFetch(
      jsonResponse(500, { code: "internal_error", message: "Authentication failed unexpectedly" }),
    );

    const error = await captureError(createAuthClient({ fetch }).logout());

    expect(error.status).toBe(500);
    expect(error.code).toBe("internal_error");
  });

  it.each([
    ["200 carrying a session", jsonResponse(200, { user: USER_ONE })],
    ["202 with no body", new Response(null, { status: 202 })],
  ])("does not accept %s as a completed logout", async (_label, response) => {
    const { fetch } = stubFetch(response);

    const error = await captureError(createAuthClient({ fetch }).logout());

    expect(error.kind).toBe("protocol");
  });
});

describe("default transport", () => {
  it("uses the global fetch when none is injected", async () => {
    const globalFetch = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(jsonResponse(200, { user: USER_ONE }));
    vi.stubGlobal("fetch", globalFetch);

    const user: AuthUser | null = await createAuthClient().fetchSession();

    expect(user).toEqual(USER_ONE);
    expect(globalFetch).toHaveBeenCalledWith("/api/auth/session", expect.anything());

    vi.unstubAllGlobals();
  });
});

describe("parseRetryAfterSeconds", () => {
  it.each([
    ["300", 300],
    [" 5 ", 5],
    ["0", 0],
  ])("reads the delta-seconds form %s", (header, expected) => {
    expect(parseRetryAfterSeconds(header)).toBe(expected);
  });

  it.each([null, "", "later", "-1", "1.5", "Wed, 21 Oct 2026 07:28:00 GMT"])(
    "ignores %s",
    (header) => {
      expect(parseRetryAfterSeconds(header)).toBeNull();
    },
  );
});
