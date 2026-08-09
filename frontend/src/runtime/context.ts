import type { QueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";

import type { AuthClient } from "../auth/client.ts";
import type { GamesClient } from "../games/client.ts";
import type { LiveClient } from "../live/client.ts";
import type { PlayersClient } from "../players/client.ts";
import type { MotionPreference } from "../theme/motion.ts";
import type { Clock } from "./clock.ts";

/** Injectable browser runtime shared by the application and integration tests. */
export interface AppRuntime {
  readonly queryClient: QueryClient;
  readonly authClient: AuthClient;
  readonly gamesClient: GamesClient;
  readonly playersClient: PlayersClient;
  readonly live: LiveClient;
  readonly clock: Clock;
  readonly motion: MotionPreference;
}

export const RuntimeContext = createContext<AppRuntime | null>(null);

export function useAppRuntime(): AppRuntime {
  const runtime = useContext(RuntimeContext);

  if (runtime === null) {
    throw new Error("AppProviders must enclose any component that uses the frontend runtime");
  }

  return runtime;
}

export function useAuthClient(): AuthClient {
  return useAppRuntime().authClient;
}

export function useGamesClient(): GamesClient {
  return useAppRuntime().gamesClient;
}

export function usePlayersClient(): PlayersClient {
  return useAppRuntime().playersClient;
}

export function useLiveClient(): LiveClient {
  return useAppRuntime().live;
}

export function useClock(): Clock {
  return useAppRuntime().clock;
}

export function useMotionPreference(): MotionPreference {
  return useAppRuntime().motion;
}
