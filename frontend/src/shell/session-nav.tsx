import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";

import { HOME_PATH, SIGN_IN_PATH } from "../app/routes.ts";
import { useLogout, useSession } from "../auth/queries.ts";
import { PlayerLink } from "../players/player-link.tsx";
import { Button, LinkButton } from "../ui/button.tsx";
import { useSigningOut } from "./signing-out.ts";

export function SessionNav() {
  const session = useSession();
  const logout = useLogout();
  const location = useLocation();
  const navigate = useNavigate();
  const { signingOut, beginSignOut, abandonSignOut } = useSigningOut();

  useEffect(() => {
    if (session.data === null && signingOut && location.pathname === HOME_PATH) {
      // Clear only after the guard's navigation consumes this intent.
      abandonSignOut();
    }
  }, [abandonSignOut, location.pathname, session.data, signingOut]);

  const signOut = (): void => {
    // Set intent before the session cache can be cleared.
    beginSignOut();

    void logout.submit().then(
      () => {
        // Also clears intent when signing out from an unguarded public route.
        void navigate(HOME_PATH, { replace: true });
      },
      () => {
        abandonSignOut();
      },
    );
  };

  if (session.data === undefined) {
    if (session.isError) {
      return (
        <div className="flex items-center gap-2">
          <span role="alert" className="text-xs text-pen-2-text">
            Session unavailable
          </span>
          <Button
            variant="quiet"
            size="sm"
            onClick={() => {
              void session.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      );
    }

    return (
      <span role="status" className="px-2 text-xs text-ink-3">
        Checking session…
      </span>
    );
  }

  if (session.data === null) {
    return (
      <LinkButton to={SIGN_IN_PATH} size="sm" className="ml-2">
        Sign in
      </LinkButton>
    );
  }

  return (
    <div className="ml-2 flex items-center gap-2">
      <PlayerLink
        username={session.data.username}
        className="num max-w-[12ch] truncate text-xs text-ink-2 hover:text-ink-1 hover:underline"
      />
      <Button size="sm" onClick={signOut} disabled={logout.isPending}>
        {logout.isPending ? "Signing out…" : "Sign out"}
      </Button>
      {logout.error === null ? null : (
        <span role="alert" className="text-xs text-pen-2-text">
          Sign out failed
        </span>
      )}
    </div>
  );
}
