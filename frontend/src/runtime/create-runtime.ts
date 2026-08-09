import type { QueryClient } from "@tanstack/react-query";

import type { AuthClient } from "../auth/client.ts";
import { createAuthClient } from "../auth/client.ts";
import { AUTH_SESSION_KEY } from "../auth/queries.ts";
import { createGamesClient, type GamesClient } from "../games/client.ts";
import { GAMES_QUERY_ROOT } from "../games/query-keys.ts";
import { createLiveClient, type LiveClientFactory } from "../live/client.ts";
import { createPlayersClient, type PlayersClient } from "../players/client.ts";
import { PLAYER_QUERY_ROOT } from "../players/query-keys.ts";
import { browserMotionPreference, type MotionPreference } from "../theme/motion.ts";
import { browserClock, type Clock } from "./clock.ts";
import type { AppRuntime } from "./context.ts";
import { createQueryClient } from "./query-client.ts";

export interface AppRuntimeOptions {
  readonly queryClient?: QueryClient;
  readonly authClient?: AuthClient;
  readonly gamesClient?: GamesClient;
  readonly playersClient?: PlayersClient;
  readonly createLive?: LiveClientFactory;
  readonly clock?: Clock;
  readonly motion?: MotionPreference;
}

export function createAppRuntime(options: AppRuntimeOptions = {}): AppRuntime {
  const queryClient = options.queryClient ?? createQueryClient();
  const authClient = options.authClient ?? createAuthClient();
  const gamesClient = options.gamesClient ?? createGamesClient();
  const playersClient = options.playersClient ?? createPlayersClient();
  const createLive = options.createLive ?? createLiveClient;
  const clock = options.clock ?? browserClock;
  const motion = options.motion ?? browserMotionPreference();

  // Only the session query decides whether a failed socket means signed out.
  const live = createLive({
    clock,
    onSessionSuspect: () => {
      void queryClient.invalidateQueries({ queryKey: AUTH_SESSION_KEY });
    },
    onGameHistoryStale: () => {
      // A rated finish can also change every ranked player's percentile.
      void queryClient.invalidateQueries({ queryKey: PLAYER_QUERY_ROOT });
      // A live replay lookup may currently hold the expected pre-finish 404.
      void queryClient.invalidateQueries({ queryKey: GAMES_QUERY_ROOT });
    },
  });

  return { queryClient, authClient, gamesClient, playersClient, live, clock, motion };
}
