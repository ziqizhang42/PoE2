import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router";

import { playerPath } from "../app/routes.ts";

export function PlayerLink({
  username,
  children,
  className,
  style,
}: {
  readonly username: string;
  readonly children?: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
}) {
  return (
    <Link to={playerPath(username)} className={className} style={style}>
      {children ?? username}
    </Link>
  );
}
