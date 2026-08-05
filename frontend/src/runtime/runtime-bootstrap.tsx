import { useEffect } from "react";

import { useSession } from "../auth/queries.ts";
import { useLiveClient } from "./context.ts";

/**
 * Headless lifecycle owner: it loads the session and holds the socket open for
 * exactly as long as an authenticated user is confirmed, and renders nothing.
 *
 * The effect depends on the user ID rather than the user object, so refetching
 * the session cannot churn the connection.
 */
export function RuntimeBootstrap(): null {
  const session = useSession();
  const live = useLiveClient();
  const userId = session.data?.id ?? null;

  useEffect(() => {
    if (userId === null) {
      live.stop();
      return undefined;
    }

    live.start(userId);
    return () => {
      live.stop();
    };
  }, [live, userId]);

  return null;
}
