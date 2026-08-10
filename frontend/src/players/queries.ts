import type { GameHistoryPage, PlayerDirectoryEntry, PublicPlayerProfile } from "@poe2/protocol";
import {
  useInfiniteQuery,
  useQuery,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { usePlayersClient } from "../runtime/context.ts";
import type { PlayerRequestError } from "./errors.ts";
import { PLAYER_DIRECTORY_KEY, playerGamesKey, playerProfileKey } from "./query-keys.ts";

export { PLAYER_DIRECTORY_KEY, playerGamesKey, playerProfileKey } from "./query-keys.ts";

export function usePlayerDirectory(): UseQueryResult<
  readonly PlayerDirectoryEntry[],
  PlayerRequestError
> {
  const client = usePlayersClient();
  return useQuery({
    queryKey: PLAYER_DIRECTORY_KEY,
    queryFn: ({ signal }) => client.fetchDirectory(signal),
    staleTime: 30_000,
    retry: false,
  });
}

export function usePlayerProfile(
  username: string,
): UseQueryResult<PublicPlayerProfile, PlayerRequestError> {
  const client = usePlayersClient();
  return useQuery({
    queryKey: playerProfileKey(username),
    queryFn: ({ signal }) => client.fetchProfile(username, signal),
    staleTime: 30_000,
    // The screen renders failures and offers an explicit retry.
    retry: false,
  });
}

export function usePlayerGames(
  username: string,
): UseInfiniteQueryResult<{ readonly pages: readonly GameHistoryPage[] }, PlayerRequestError> {
  const client = usePlayersClient();

  return useInfiniteQuery({
    queryKey: playerGamesKey(username),
    queryFn: ({ pageParam, signal }) =>
      client.fetchGames(username, {
        signal,
        ...(pageParam === null ? {} : { cursor: pageParam }),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: GameHistoryPage) => last.nextCursor,
    staleTime: 30_000,
    retry: false,
  });
}
