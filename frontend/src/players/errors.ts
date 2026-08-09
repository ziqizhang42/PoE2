import type { PlayerErrorCode } from "@poe2/protocol";

export type PlayerErrorKind = "network" | "protocol" | "http";

export class PlayerRequestError extends Error {
  readonly kind: PlayerErrorKind;
  readonly status: number | null;
  readonly code: PlayerErrorCode | null;

  constructor(options: {
    readonly kind: PlayerErrorKind;
    readonly message: string;
    readonly status: number | null;
    readonly code: PlayerErrorCode | null;
  }) {
    super(options.message);
    this.name = "PlayerRequestError";
    this.kind = options.kind;
    this.status = options.status;
    this.code = options.code;
  }
}

export const playerNetworkError = (): PlayerRequestError =>
  new PlayerRequestError({
    kind: "network",
    message: "Could not reach the server.",
    status: null,
    code: null,
  });

export const playerProtocolError = (status: number): PlayerRequestError =>
  new PlayerRequestError({
    kind: "protocol",
    message: "The server sent a profile this page could not read.",
    status,
    code: null,
  });

export function isPlayerNotFound(error: unknown): boolean {
  return error instanceof PlayerRequestError && error.code === "player_not_found";
}
