import type { GamesErrorCode } from "@poe2/protocol";

export type GamesErrorKind = "network" | "protocol" | "http";

export class GamesRequestError extends Error {
  readonly kind: GamesErrorKind;
  readonly status: number | null;
  readonly code: GamesErrorCode | null;

  constructor(options: {
    readonly kind: GamesErrorKind;
    readonly message: string;
    readonly status: number | null;
    readonly code: GamesErrorCode | null;
  }) {
    super(options.message);
    this.name = "GamesRequestError";
    this.kind = options.kind;
    this.status = options.status;
    this.code = options.code;
  }
}

export function networkError(): GamesRequestError {
  return new GamesRequestError({
    kind: "network",
    message: "Could not reach the server.",
    status: null,
    code: null,
  });
}

export function protocolError(status: number): GamesRequestError {
  return new GamesRequestError({
    kind: "protocol",
    message: "The server sent something this page could not read.",
    status,
    code: null,
  });
}

export function httpError(options: {
  readonly status: number;
  readonly code: GamesErrorCode;
  readonly message: string;
}): GamesRequestError {
  return new GamesRequestError({ kind: "http", ...options });
}

export function isNotFound(error: unknown): boolean {
  return error instanceof GamesRequestError && error.code === "game_not_found";
}
