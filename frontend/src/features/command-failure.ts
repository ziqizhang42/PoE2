/** Distinguishes definite rejection from an unknown post-send transport outcome. */

import type { LiveCommandFailure, LiveCommandResult } from "../live/client.ts";

export type FailedCommand = Extract<LiveCommandResult, { ok: false }>;

export type FailureScope = "lobby" | "game";

const WITNESS: Record<FailureScope, string> = {
  lobby: "The lists below will show what the server actually did.",
  game: "The board below will show what the server actually did.",
};

export const UNEXPECTED_FAILURE =
  "That command failed for an unknown reason, so whether the server applied it is unknown. What it actually did will show below.";

export function describeTransportFailure(
  failure: LiveCommandFailure,
  scope: FailureScope,
): string | null {
  switch (failure) {
    case "not_connected":
      return "Not connected to the game server, so nothing was sent.";
    case "connection_lost":
      return `The connection dropped before the server answered, so whether it was applied is unknown. ${WITNESS[scope]}`;
    case "timed_out":
      return `The server did not answer in time, so whether it was applied is unknown. ${WITNESS[scope]}`;
    case "rejected":
      return null;
  }
}
