/**
 * REST client for the same-origin `/api/auth` routes.
 *
 * The session lives entirely in an `httpOnly` cookie the browser attaches
 * itself, so nothing here ever reads, stores, or forwards a session token. A
 * password exists only as an argument that is serialized straight onto the
 * wire; it is never placed in an error, a log, or any other retained value.
 */

import {
  AuthErrorResponseSchema,
  AuthSessionResponseSchema,
  type AuthUser,
  type LoginRequest,
  type RegisterRequest,
} from "@poe2/protocol";

import { AuthRequestError, httpError, networkError, protocolError } from "./errors.ts";

const SESSION_PATH = "/api/auth/session";
const REGISTER_PATH = "/api/auth/register";
const LOGIN_PATH = "/api/auth/login";

const OK = 200;
const CREATED = 201;
const NO_CONTENT = 204;
const UNAUTHORIZED = 401;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AuthClient {
  /** `null` is the ordinary signed-out answer, not a failure. */
  fetchSession(signal?: AbortSignal): Promise<AuthUser | null>;
  register(credentials: RegisterRequest): Promise<AuthUser>;
  login(credentials: LoginRequest): Promise<AuthUser>;
  logout(): Promise<void>;
}

export interface AuthClientOptions {
  readonly fetch?: FetchLike;
}

export function createAuthClient(options: AuthClientOptions = {}): AuthClient {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  const send = async (path: string, init: RequestInit): Promise<Response> => {
    try {
      return await fetchImpl(path, { credentials: "same-origin", ...init });
    } catch (error) {
      // An abort is a caller-initiated cancellation, which TanStack Query has
      // to recognize as such rather than as a failed request.
      if (isAbortError(error)) {
        throw error;
      }
      throw networkError();
    }
  };

  const readUser = async (response: Response, expectedStatus: number): Promise<AuthUser> => {
    if (response.status !== expectedStatus) {
      throw await toRequestError(response);
    }

    const parsed = AuthSessionResponseSchema.safeParse(await readJson(response));
    if (!parsed.success) {
      throw protocolError(response.status);
    }

    return parsed.data.user;
  };

  return {
    async fetchSession(signal) {
      const response = await send(SESSION_PATH, {
        method: "GET",
        headers: { accept: "application/json" },
        ...(signal === undefined ? {} : { signal }),
      });

      if (response.status === UNAUTHORIZED) {
        const failure = await toRequestError(response);

        // Signed out is a specific answer the shared schema describes, not
        // merely a status. A 401 that does not carry it is a broken service,
        // and reporting that as an empty session would hide the difference.
        if (failure.code === "unauthenticated") {
          return null;
        }

        throw failure;
      }

      return readUser(response, OK);
    },

    async register(credentials) {
      return readUser(await send(REGISTER_PATH, jsonRequest(credentials)), CREATED);
    },

    async login(credentials) {
      return readUser(await send(LOGIN_PATH, jsonRequest(credentials)), OK);
    },

    async logout() {
      const response = await send(SESSION_PATH, {
        method: "DELETE",
        headers: { accept: "application/json" },
      });

      // The route answers `204` and nothing else, so any other status - even a
      // successful one - means this is not the endpoint it was aimed at.
      if (response.status !== NO_CONTENT) {
        throw await toRequestError(response);
      }
    },
  };
}

/**
 * Only the delta-seconds form is honoured. These routes never send the
 * HTTP-date form, and guessing across clock skew would be worse than no hint.
 */
export function parseRetryAfterSeconds(header: string | null): number | null {
  if (header === null) {
    return null;
  }

  const trimmed = header.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const seconds = Number(trimmed);
  return Number.isInteger(seconds) && seconds >= 0 ? seconds : null;
}

function jsonRequest(body: RegisterRequest | LoginRequest): RequestInit {
  return {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function toRequestError(response: Response): Promise<AuthRequestError> {
  const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get("retry-after"));
  const parsed = AuthErrorResponseSchema.safeParse(await readJson(response));

  if (!parsed.success) {
    return protocolError(response.status, retryAfterSeconds);
  }

  return httpError({
    status: response.status,
    code: parsed.data.code,
    message: parsed.data.message,
    retryAfterSeconds,
  });
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Checked structurally: `fetch` rejects an abort with a `DOMException`, which
 * does not derive from `Error` in every environment this code is tested in.
 */
function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return false;
  }

  const { name } = error;
  return name === "AbortError";
}
