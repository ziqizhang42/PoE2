import type { AuthErrorCode } from "@poe2/protocol";

/**
 * Why an authentication request failed.
 *
 * `http` is the only kind carrying server-authored detail, and that detail is
 * limited to what the shared schema validated. Nothing else the server sent is
 * ever surfaced, so an unexpected body cannot leak through as a message.
 */
export type AuthErrorKind = "network" | "protocol" | "http";

const NETWORK_MESSAGE = "The authentication service could not be reached";
const PROTOCOL_MESSAGE = "The authentication service returned an unexpected response";

export interface AuthRequestErrorInit {
  readonly kind: AuthErrorKind;
  readonly message: string;
  readonly status: number | null;
  readonly code: AuthErrorCode | null;
  readonly retryAfterSeconds: number | null;
}

export class AuthRequestError extends Error {
  readonly kind: AuthErrorKind;
  readonly status: number | null;
  readonly code: AuthErrorCode | null;
  readonly retryAfterSeconds: number | null;

  constructor(init: AuthRequestErrorInit) {
    super(init.message);
    this.name = "AuthRequestError";
    this.kind = init.kind;
    this.status = init.status;
    this.code = init.code;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }
}

export function networkError(): AuthRequestError {
  return new AuthRequestError({
    kind: "network",
    message: NETWORK_MESSAGE,
    status: null,
    code: null,
    retryAfterSeconds: null,
  });
}

export function protocolError(
  status: number | null,
  retryAfterSeconds: number | null = null,
): AuthRequestError {
  return new AuthRequestError({
    kind: "protocol",
    message: PROTOCOL_MESSAGE,
    status,
    code: null,
    retryAfterSeconds,
  });
}

export function httpError(init: {
  readonly status: number;
  readonly code: AuthErrorCode;
  readonly message: string;
  readonly retryAfterSeconds: number | null;
}): AuthRequestError {
  return new AuthRequestError({ kind: "http", ...init });
}
