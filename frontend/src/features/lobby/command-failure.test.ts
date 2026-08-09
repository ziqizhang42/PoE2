import { WS_ERROR_CODES, type WsErrorCode } from "@poe2/protocol";
import { describe, expect, it } from "vitest";

import { REQUEST_ID } from "../../test/fakes.ts";
import { describeCommandFailure } from "./command-failure.ts";

function rejection(code: WsErrorCode, message = "server wording") {
  return { ok: false, requestId: REQUEST_ID, failure: "rejected", code, message } as const;
}

function transport(failure: "not_connected" | "connection_lost" | "timed_out"): string {
  return describeCommandFailure({
    ok: false,
    requestId: REQUEST_ID,
    failure,
    code: null,
    message: null,
  });
}

describe("describeCommandFailure", () => {
  it("distinguishes the transport failures", () => {
    const messages = [
      transport("not_connected"),
      transport("connection_lost"),
      transport("timed_out"),
    ];

    expect(new Set(messages).size).toBe(messages.length);
  });

  it("only claims nothing happened when the command was never sent", () => {
    expect(transport("not_connected")).toMatch(/nothing was sent/i);
  });

  it("does not promise an unchanged state when the answer went missing", () => {
    for (const message of [transport("connection_lost"), transport("timed_out")]) {
      expect(message).toMatch(/unknown/i);
      expect(message).not.toMatch(/nothing was (changed|sent)/i);
    }
  });

  it("treats a refusal from the server as final", () => {
    expect(describeCommandFailure(rejection("game_not_waiting"))).not.toMatch(/unknown/i);
  });

  it("explains the lobby rejections in the reader's terms", () => {
    expect(describeCommandFailure(rejection("game_not_waiting"))).toBe(
      "Someone else took that seat first.",
    );
    expect(describeCommandFailure(rejection("not_lobby_owner"))).toBe(
      "Only the player who opened a lobby can withdraw it.",
    );
    expect(describeCommandFailure(rejection("cannot_join_own_game"))).toContain("other seat");
  });

  it("falls back to the server's own wording for the in-game codes", () => {
    expect(describeCommandFailure(rejection("not_your_turn", "It is not your turn"))).toBe(
      "It is not your turn",
    );
  });

  it("says something for every code the protocol allows", () => {
    for (const code of WS_ERROR_CODES) {
      expect(describeCommandFailure(rejection(code)).length).toBeGreaterThan(0);
    }
  });
});
