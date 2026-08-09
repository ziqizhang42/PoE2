import { Navigate, Route, Routes } from "react-router";

import { AuthPage } from "../features/auth/auth-page.tsx";
import { LandingPage } from "../features/landing/landing-page.tsx";
import { AppShell } from "../shell/app-shell.tsx";
import { RequireSession } from "../shell/require-session.tsx";
import { GamePage, LobbyPage, PlayerPage, ReplayPage } from "./lazy-routes.ts";
import {
  GAME_ROUTE,
  HOME_PATH,
  LOBBY_PATH,
  PLAYER_ROUTE,
  REPLAY_ROUTE,
  SIGN_IN_PATH,
} from "./routes.ts";

/** Keep the landing and sign-in routes eager; defer authenticated and archive screens. */
export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path={HOME_PATH} element={<LandingPage />} />
        <Route path={SIGN_IN_PATH} element={<AuthPage />} />
        <Route path={PLAYER_ROUTE} element={<PlayerPage />} />
        <Route path={REPLAY_ROUTE} element={<ReplayPage />} />
        <Route element={<RequireSession />}>
          <Route path={LOBBY_PATH} element={<LobbyPage />} />
          <Route path={GAME_ROUTE} element={<GamePage />} />
        </Route>
        <Route path="*" element={<Navigate to={HOME_PATH} replace />} />
      </Route>
    </Routes>
  );
}
