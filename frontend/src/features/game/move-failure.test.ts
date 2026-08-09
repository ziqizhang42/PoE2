import { describe, expect, it } from "vitest";

import { rejectedCommand, REQUEST_ID } from "../../test/fakes.ts";
import type { FailedCommand } from "../command-failure.ts";
import {
  describeMoveFailure,
  describeReadyConfirmationFailure,
  describeWithdrawalFailure,
} from "./move-failure.ts";

function transport(failure: FailedCommand["failure"]): FailedCommand {
  return { ok: false, requestId: REQUEST_ID, failure, code: null, message: null };
}

describe("describeMoveFailure", () => {
  it("explains each way the server can refuse a move", () => {
    expect(describeMoveFailure(rejectedCommand("stale_game"))).toContain("already moved on");
    expect(describeMoveFailure(rejectedCommand("occupied"))).toContain("was taken");
    expect(describeMoveFailure(rejectedCommand("not_your_turn"))).toContain("not your turn");
    expect(describeMoveFailure(rejectedCommand("game_over"))).toContain("already finished");
    expect(describeMoveFailure(rejectedCommand("not_a_player"))).toContain("no seat");
  });

  it("says a refused move was not played, because the server decided that", () => {
    for (const code of ["stale_game", "occupied", "not_your_turn", "game_over"] as const) {
      expect(describeMoveFailure(rejectedCommand(code))).toMatch(/not played|nothing was played/);
    }
  });

  it("only promises nothing happened when nothing was sent", () => {
    expect(describeMoveFailure(transport("not_connected"))).toContain("nothing was sent");
  });

  it("leaves a lost answer or a timeout unknown rather than claiming a no-op", () => {
    for (const failure of ["connection_lost", "timed_out"] as const) {
      const message = describeMoveFailure(transport(failure));

      expect(message).toContain("unknown");
      expect(message).toContain("The board below");
      expect(message).not.toMatch(/nothing was (played|changed|sent)/);
    }
  });
});

describe("non-move game commands", () => {
  it("names the action a rate limit actually refused", () => {
    expect(describeWithdrawalFailure(rejectedCommand("rate_limited"))).toContain(
      "lobby was not withdrawn",
    );
    expect(describeReadyConfirmationFailure(rejectedCommand("rate_limited"))).toContain(
      "not marked ready",
    );
    expect(describeWithdrawalFailure(rejectedCommand("rate_limited"))).not.toMatch(/played/u);
  });

  it("describes a stale confirmation as an old ready check", () => {
    expect(describeReadyConfirmationFailure(rejectedCommand("stale_game"))).toContain(
      "replaced by a newer one",
    );
    expect(describeReadyConfirmationFailure(rejectedCommand("stale_game"))).toContain(
      "not marked ready",
    );
  });
});
