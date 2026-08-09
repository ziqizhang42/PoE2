/** Rounds both ledger endpoints before subtraction so displayed arithmetic agrees. */

import type { RatingChange } from "@poe2/protocol";

export interface RatingMove {
  readonly before: number;
  readonly after: number;
  readonly delta: number;
  readonly direction: "rose" | "fell" | "unchanged";
  readonly signed: string;
}

export function ratingMove(change: RatingChange): RatingMove {
  const before = Math.round(change.before);
  const after = Math.round(change.after);
  const delta = after - before;
  const direction = delta > 0 ? "rose" : delta < 0 ? "fell" : "unchanged";

  return {
    before,
    after,
    delta,
    direction,
    signed: delta > 0 ? `+${String(delta)}` : String(delta).replace("-", "−"),
  };
}
