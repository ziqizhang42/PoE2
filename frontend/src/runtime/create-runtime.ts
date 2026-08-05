import type { QueryClient } from "@tanstack/react-query";

import type { AuthClient } from "../auth/client.ts";
import { createAuthClient } from "../auth/client.ts";
import { AUTH_SESSION_KEY } from "../auth/queries.ts";
import { createLiveClient, type LiveClientFactory } from "../live/client.ts";
import type { AppRuntime } from "./context.ts";
import { createQueryClient } from "./query-client.ts";

export interface AppRuntimeOptions {
  readonly queryClient?: QueryClient;
  readonly authClient?: AuthClient;
  readonly createLive?: LiveClientFactory;
}

export function createAppRuntime(options: AppRuntimeOptions = {}): AppRuntime {
  const queryClient = options.queryClient ?? createQueryClient();
  const authClient = options.authClient ?? createAuthClient();
  const createLive = options.createLive ?? createLiveClient;

  // The socket cannot tell a refused upgrade from a network failure, so it
  // reports suspicion and the session query stays the only thing that decides
  // whether this browser is still authenticated.
  const live = createLive({
    onSessionSuspect: () => {
      void queryClient.invalidateQueries({ queryKey: AUTH_SESSION_KEY });
    },
  });

  return { queryClient, authClient, live };
}
