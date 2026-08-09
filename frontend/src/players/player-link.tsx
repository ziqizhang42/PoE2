import type { ReactNode } from "react";
import { Link } from "react-router";

import { playerPath } from "../app/routes.ts";

export function PlayerLink({
  username,
  children,
  className,
}: {
  readonly username: string;
  readonly children?: ReactNode;
  readonly className?: string;
}) {
  return (
    <Link to={playerPath(username)} className={className}>
      {children ?? username}
    </Link>
  );
}
