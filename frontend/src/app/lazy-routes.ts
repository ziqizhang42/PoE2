import { lazy } from "react";

export const importLobbyPage = () => import("../features/lobby/lobby-page.tsx");
export const importGamePage = () => import("../features/game/game-page.tsx");
export const importReplayPage = () => import("../features/replay/replay-page.tsx");
export const importPlayerPage = () => import("../features/player/player-page.tsx");
export const importAnalysisPage = () => import("../features/analysis/analysis-page.tsx");

export const AnalysisPage = lazy(async () => ({
  default: (await importAnalysisPage()).AnalysisPage,
}));

export const LobbyPage = lazy(async () => ({
  default: (await importLobbyPage()).LobbyPage,
}));

export const GamePage = lazy(async () => ({
  default: (await importGamePage()).GamePage,
}));

export const ReplayPage = lazy(async () => ({
  default: (await importReplayPage()).ReplayPage,
}));

export const PlayerPage = lazy(async () => ({
  default: (await importPlayerPage()).PlayerPage,
}));

export const DEFERRED_ROUTE_IMPORTS: readonly (() => Promise<unknown>)[] = [
  importLobbyPage,
  importGamePage,
  importReplayPage,
  importPlayerPage,
];
