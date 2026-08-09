import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import type { GameReplay } from "@poe2/protocol";

import { useGamesClient } from "../runtime/context.ts";
import type { GamesRequestError } from "./errors.ts";
import { gameReplayKey } from "./query-keys.ts";

export { gameReplayKey } from "./query-keys.ts";

export function useGameReplay(gameId: string): UseQueryResult<GameReplay, GamesRequestError> {
  const client = useGamesClient();

  return useQuery({
    queryKey: gameReplayKey(gameId),
    queryFn: ({ signal }) => client.fetchReplay(gameId, signal),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}
