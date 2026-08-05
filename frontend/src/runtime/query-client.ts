import { QueryClient } from "@tanstack/react-query";

/** A factory rather than a module singleton, so each test gets a clean cache. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 30_000,
      },
    },
  });
}
