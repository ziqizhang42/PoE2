import { Link } from "react-router";

import { HOME_PATH } from "../app/routes.ts";

export function Wordmark() {
  return (
    <Link
      to={HOME_PATH}
      className="font-display text-lg leading-none font-semibold tracking-tight whitespace-nowrap no-underline"
    >
      PoE
      <b className="num ml-px align-[0.32em] text-[0.86em] font-semibold text-wordmark">2</b>
    </Link>
  );
}
