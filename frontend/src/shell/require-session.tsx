import { Navigate, Outlet, useLocation } from "react-router";

import { HOME_PATH, SIGN_IN_PATH } from "../app/routes.ts";
import { useSession } from "../auth/queries.ts";
import { Button } from "../ui/button.tsx";
import { CARD, H_LG, NOTE } from "../ui/classes.ts";
import { PagePending } from "./page-pending.tsx";
import { useSigningOut } from "./signing-out.ts";

/** Waits for session resolution before choosing content or a redirect. */
export function RequireSession() {
  const session = useSession();
  const location = useLocation();
  const { signingOut } = useSigningOut();

  if (session.data === undefined) {
    if (session.isError) {
      return (
        <div className="py-12">
          <div className={`${CARD} mx-auto max-w-md`} role="alert">
            <h1 className={H_LG}>Your session could not be checked</h1>
            <p className={NOTE}>{session.error.message}</p>
            <Button
              variant="primary"
              className="mt-4"
              onClick={() => {
                void session.refetch();
              }}
            >
              Try again
            </Button>
          </div>
        </div>
      );
    }

    return <PagePending label="Restoring your session…" />;
  }

  if (session.data === null) {
    // Preserve the return route for expiry, but not deliberate logout.
    if (signingOut) {
      return <Navigate to={HOME_PATH} replace />;
    }

    return (
      <Navigate
        to={SIGN_IN_PATH}
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  return <Outlet />;
}
