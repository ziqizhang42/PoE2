import type { QueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";

import type { AuthClient } from "../auth/client.ts";
import type { LiveClient } from "../live/client.ts";

/**
 * Everything the browser runtime owns, injected as one value so tests can
 * replace any part of it without touching module state.
 */
export interface AppRuntime {
  readonly queryClient: QueryClient;
  readonly authClient: AuthClient;
  readonly live: LiveClient;
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

export function useLiveClient(): LiveClient {
  return useAppRuntime().live;
}
