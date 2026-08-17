/** Route titles deliberately omit usernames from visible browser history. */

import { useEffect } from "react";

import {
  ANALYSIS_PATH,
  GAME_ROUTE,
  HOME_PATH,
  LOBBY_PATH,
  PLAYER_ROUTE,
  REPLAY_ROUTE,
  SIGN_IN_PATH,
} from "./routes.ts";

export const SITE_NAME = "PoE2";

const TITLES: Record<string, string> = {
  [HOME_PATH]: `${SITE_NAME} — Powers of Exponent 2`,
  [SIGN_IN_PATH]: `Sign in — ${SITE_NAME}`,
  [ANALYSIS_PATH]: `Analysis — ${SITE_NAME}`,
  [LOBBY_PATH]: `Lobby — ${SITE_NAME}`,
  [GAME_ROUTE]: `Game — ${SITE_NAME}`,
  [REPLAY_ROUTE]: `Replay — ${SITE_NAME}`,
  [PLAYER_ROUTE]: `Player — ${SITE_NAME}`,
};

export const HOME_TITLE = TITLES[HOME_PATH] ?? SITE_NAME;
export const SIGN_IN_TITLE = TITLES[SIGN_IN_PATH] ?? SITE_NAME;
export const ANALYSIS_TITLE = TITLES[ANALYSIS_PATH] ?? SITE_NAME;
export const LOBBY_TITLE = TITLES[LOBBY_PATH] ?? SITE_NAME;
export const GAME_TITLE = TITLES[GAME_ROUTE] ?? SITE_NAME;
export const REPLAY_TITLE = TITLES[REPLAY_ROUTE] ?? SITE_NAME;
export const PLAYER_TITLE = TITLES[PLAYER_ROUTE] ?? SITE_NAME;

export function titleFor(pathname: string): string {
  if (pathname.startsWith("/game/")) {
    return GAME_TITLE;
  }
  if (pathname.startsWith("/replay/")) {
    return REPLAY_TITLE;
  }
  if (pathname.startsWith("/player/")) {
    return PLAYER_TITLE;
  }
  return TITLES[pathname] ?? SITE_NAME;
}

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
