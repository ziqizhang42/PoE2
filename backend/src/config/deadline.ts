import { z } from "zod";

import { boundedInteger } from "./bounded-integer.js";

export const DEFAULT_DEADLINE_MAX_ACTIVE_GAMES = 20_000;
export const MAX_DEADLINE_MAX_ACTIVE_GAMES = 1_000_000;

const environmentSchema = z.object({
  DEADLINE_MAX_ACTIVE_GAMES: boundedInteger(
    1,
    MAX_DEADLINE_MAX_ACTIVE_GAMES,
    DEFAULT_DEADLINE_MAX_ACTIVE_GAMES,
  ),
});

export interface DeadlineConfig {
  readonly maxActiveGames: number;
}

export function readDeadlineConfig(
  environment: Readonly<Record<string, string | undefined>>,
): DeadlineConfig {
  return { maxActiveGames: environmentSchema.parse(environment).DEADLINE_MAX_ACTIVE_GAMES };
}
