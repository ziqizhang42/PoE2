/** Outcome wording that never attributes the board margin to resignation or timeout. */

import type { GameOutcome } from "@poe2/protocol";
import { marginHalfPoints, type ScoreByPlayer } from "@poe2/rules";

import { formatHalfPoints } from "../board/half-points.ts";

export function isDecidedOnPoints(outcome: GameOutcome): boolean {
  return outcome.reason === "board_full";
}

export function describeMargin(outcome: GameOutcome, scores: ScoreByPlayer): string {
  if (isDecidedOnPoints(outcome)) {
    return `by ${formatHalfPoints(marginHalfPoints(scores))}`;
  }
  return outcome.reason === "timeout" ? "on time" : "by resignation";
}
