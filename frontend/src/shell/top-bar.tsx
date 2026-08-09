import { NavLink } from "react-router";

import { useSession } from "../auth/queries.ts";
import { LOBBY_PATH, playerPath } from "../app/routes.ts";
import { describeConnection } from "../features/connection.ts";
import { useLiveStatus } from "../live/hooks.ts";
import { ThemeToggle } from "../theme/theme-toggle.tsx";
import { SHELL } from "../ui/classes.ts";
import { STATUS_LAMPS } from "../ui/status-tone.ts";
import { SessionNav } from "./session-nav.tsx";
import { Wordmark } from "./wordmark.tsx";

const LINK =
  "rounded-full px-2 py-1.5 text-sm font-medium whitespace-nowrap no-underline transition-colors sm:px-3";

export function TopBar() {
  const session = useSession();
  const liveStatus = useLiveStatus();
  const user = session.data ?? null;
  const signedIn = user !== null;
  const connection = describeConnection(liveStatus, 0);

  const navLinks = signedIn
    ? [
        { to: LOBBY_PATH, label: "Lobby" },
        { to: playerPath(user.username), label: "Profile" },
      ]
    : [];

  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-field/85 backdrop-blur-md backdrop-saturate-150">
      <div className={`${SHELL} flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 sm:gap-x-6`}>
        <Wordmark />
        {signedIn ? (
          <span className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
            <span
              className={`h-2 w-2 flex-none rounded-full ${STATUS_LAMPS[connection.tone]}`}
              aria-hidden="true"
            />
            {connection.title}
          </span>
        ) : null}
        <nav aria-label="Main" className="ml-auto flex flex-wrap items-center gap-0.5 sm:gap-1">
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                isActive
                  ? `${LINK} bg-surface text-ink shadow-lift`
                  : `${LINK} text-ink-2 hover:bg-surface/70 hover:text-ink`
              }
            >
              {link.label}
            </NavLink>
          ))}
          <ThemeToggle />
          <SessionNav />
        </nav>
      </div>
    </header>
  );
}
