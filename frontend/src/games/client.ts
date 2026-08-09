import { GameReplaySchema, GamesErrorResponseSchema, type GameReplay } from "@poe2/protocol";

import {
  browserFetch,
  isAbortError,
  jsonHeaders,
  OK,
  readJson,
  type FetchLike,
} from "../http/fetch.ts";
import { httpError, networkError, protocolError, type GamesRequestError } from "./errors.ts";

function replayPath(gameId: string): string {
  return `/api/games/${encodeURIComponent(gameId)}`;
}

export interface GamesClient {
  fetchReplay(gameId: string, signal?: AbortSignal): Promise<GameReplay>;
}

export interface GamesClientOptions {
  readonly fetch?: FetchLike;
}

export function createGamesClient(options: GamesClientOptions = {}): GamesClient {
  const fetchImpl: FetchLike = options.fetch ?? browserFetch;

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
      throw networkError();
    }
  };

  return {
    async fetchReplay(gameId, signal) {
      const response = await send(replayPath(gameId), signal);

      if (response.status !== OK) {
        throw await toRequestError(response);
      }

      const parsed = GameReplaySchema.safeParse(await readJson(response));
      if (!parsed.success) {
        throw protocolError(response.status);
      }

      return parsed.data;
    },
  };
}

async function toRequestError(response: Response): Promise<GamesRequestError> {
  const parsed = GamesErrorResponseSchema.safeParse(await readJson(response));

  if (!parsed.success) {
    return protocolError(response.status);
  }

  return httpError({
    status: response.status,
    code: parsed.data.code,
    message: parsed.data.message,
  });
}
