/** Policy bounds kept outside the reference Glicko-2 implementation. */

import { type Rating } from "./glicko2.js";

/** Guardrail below the current ~60-point equilibrium; normally does not bind. */
export const MIN_DEVIATION = 45;

/** Keeps an inactive rated player distinguishable from an unknown player at 350. */
export const MAX_DEVIATION = 300;

export function withDeviationFloor(rating: Rating): Rating {
  return rating.deviation >= MIN_DEVIATION ? rating : { ...rating, deviation: MIN_DEVIATION };
}

export function withDeviationCeiling(rating: Rating): Rating {
  return rating.deviation <= MAX_DEVIATION ? rating : { ...rating, deviation: MAX_DEVIATION };
}
