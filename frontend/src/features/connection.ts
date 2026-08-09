import type { LiveStatus } from "../live/store.ts";
import type { StatusTone } from "../ui/status-tone.ts";
import type { FailureScope } from "./command-failure.ts";

export interface ConnectionDescription {
  readonly tone: StatusTone;
  readonly title: string;
  readonly detail: string;
  /** Commands are only worth offering once the server has answered. */
  readonly canCommand: boolean;
}

const OPENING: Record<FailureScope, string> = {
  lobby: "Lobbies and games appear as soon as the connection is open.",
  game: "The board appears as soon as the connection is open.",
};

const PUSHED: Record<FailureScope, string> = {
  lobby: "Every lobby and game below is the server's own state, pushed as it changes.",
  game: "The board below is the server's own state, pushed as it changes.",
};

export function describeConnection(
  status: LiveStatus,
  reconnectAttempts: number,
  scope: FailureScope = "lobby",
): ConnectionDescription {
  switch (status) {
    case "idle":
    case "connecting":
      return {
        tone: "wait",
        title: "Connecting to the game server",
        detail: OPENING[scope],
        canCommand: false,
      };

    case "ready":
      return {
        tone: "info",
        title: "Connected",
        detail: PUSHED[scope],
        canCommand: true,
      };

    case "reconnecting":
      return {
        tone: "alarm",
        title: "Reconnecting",
        detail: `Attempt ${reconnectAttempts}. Nothing can be sent until the connection is back, and no command was half-applied.`,
        canCommand: false,
      };

    case "disconnected":
      return {
        tone: "alarm",
        title: "Disconnected",
        detail: "The live connection is closed. Reload the page to open it again.",
        canCommand: false,
      };

    case "unauthenticated":
      return {
        tone: "alarm",
        title: "This session has ended",
        detail: "The server no longer accepts this session. Sign in again to continue.",
        canCommand: false,
      };
  }
}
