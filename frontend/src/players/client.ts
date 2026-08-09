import {
  GameHistoryPageSchema,
  PlayerErrorResponseSchema,
  PublicPlayerProfileSchema,
  type GameHistoryPage,
  type PublicPlayerProfile,
} from "@poe2/protocol";

import {
  browserFetch,
  isAbortError,
  jsonHeaders,
  OK,
  readJson,
  type FetchLike,
} from "../http/fetch.ts";
import { PlayerRequestError, playerNetworkError, playerProtocolError } from "./errors.ts";

interface Parser<T> {
  safeParse(
    value: unknown,
  ): { readonly success: true; readonly data: T } | { readonly success: false };
}

export interface PlayerGamesRequest {
  readonly limit?: number;
  readonly cursor?: string;
  readonly signal?: AbortSignal;
}

export interface PlayersClient {
  fetchProfile(username: string, signal?: AbortSignal): Promise<PublicPlayerProfile>;
  fetchGames(username: string, request?: PlayerGamesRequest): Promise<GameHistoryPage>;
}

export function createPlayersClient(options: { readonly fetch?: FetchLike } = {}): PlayersClient {
  const fetchImpl = options.fetch ?? browserFetch;

  const send = async (path: string, signal: AbortSignal | undefined): Promise<Response> => {
    try {
      return await fetchImpl(path, {
        method: "GET",
        credentials: "same-origin",
        headers: jsonHeaders(),
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      // Preserve caller cancellations for TanStack Query.
      if (isAbortError(error)) {
        throw error;
      }
      throw playerNetworkError();
    }
  };

  /** Structural parser avoids a direct validator dependency in this package. */
  const read = async <T>(response: Response, schema: Parser<T>): Promise<T> => {
    const body = await readJson(response);

    if (response.status === OK) {
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        throw playerProtocolError(response.status);
      }
      return parsed.data;
    }

    const failure = PlayerErrorResponseSchema.safeParse(body);
    if (!failure.success) {
      throw playerProtocolError(response.status);
    }
    throw new PlayerRequestError({
      kind: "http",
      status: response.status,
      code: failure.data.code,
      message: failure.data.message,
    });
  };

  return {
    async fetchProfile(username, signal) {
      const response = await send(`/api/players/${encodeURIComponent(username)}`, signal);
      return read(response, PublicPlayerProfileSchema);
    },

    async fetchGames(username, request = {}) {
      const query = new URLSearchParams();
      if (request.limit !== undefined) {
        query.set("limit", String(request.limit));
      }
      if (request.cursor !== undefined) {
        query.set("cursor", request.cursor);
      }

      const suffix = query.size === 0 ? "" : `?${query.toString()}`;
      const response = await send(
        `/api/players/${encodeURIComponent(username)}/games${suffix}`,
        request.signal,
      );
      return read(response, GameHistoryPageSchema);
    },
  };
}
