import { useEffect } from "react";

import { DEFERRED_ROUTE_IMPORTS } from "../app/lazy-routes.ts";
import { useSession } from "../auth/queries.ts";

type PrefetchRoutesProps = {
  imports?: readonly (() => Promise<unknown>)[];
};

/** Warms deferred screens after session confirmation; normal lazy loading retries failures. */
export function PrefetchRoutes({ imports = DEFERRED_ROUTE_IMPORTS }: PrefetchRoutesProps) {
  const session = useSession();
  const signedIn = session.data !== undefined && session.data !== null;

  useEffect(() => {
    if (!signedIn) {
      return;
    }

    for (const load of imports) {
      void load().catch(() => {});
    }
  }, [signedIn, imports]);

  return null;
}
