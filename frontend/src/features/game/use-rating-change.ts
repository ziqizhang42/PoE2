/** Pages the immutable public ledger history to find one game's rating change. */

import { MAX_HISTORY_PAGE_LIMIT, type RatingChange } from "@poe2/protocol";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import type { PlayerRequestError } from "../../players/errors.ts";
import { playerGamesKey } from "../../players/query-keys.ts";
import { usePlayersClient } from "../../runtime/context.ts";

export function gameRatingChangeKey(username: string, gameId: string): readonly unknown[] {
  return [...playerGamesKey(username), "rating-change", gameId];
}

export function useRatingChange(
  username: string,
  gameId: string,
): UseQueryResult<RatingChange | null, PlayerRequestError> {
  const client = usePlayersClient();

  return useQuery({
    queryKey: gameRatingChangeKey(username, gameId),
    queryFn: async ({ signal }) => {
      let cursor: string | undefined;

      for (;;) {
        const page = await client.fetchGames(username, {
          limit: MAX_HISTORY_PAGE_LIMIT,
          signal,
          ...(cursor === undefined ? {} : { cursor }),
        });
        const entry = page.games.find((candidate) => candidate.id === gameId);
        if (entry !== undefined) {
          return entry.ratingChange;
        }
        if (page.nextCursor === null) {
          return null;
        }
        cursor = page.nextCursor;
      }
    },
    // Cache only the result of a complete search or a found immutable event.
    staleTime: Infinity,
    retry: false,
  });
}
