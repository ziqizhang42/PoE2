import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Square } from "@poe2/rules";

import {
  browserEngineClient,
  type AnalysisEngineClient,
  type EngineSearchHandle,
} from "../analysis/browser-engine-client.ts";
import {
  encodeEngineMoves,
  engineAnalysisError,
  engineAnalysisReport,
  engineAnalysisRequest,
  invalidEngineResponse,
} from "../analysis/engine-analysis-adapter.ts";
import {
  cacheEngineAnalysisProgress,
  cacheEngineAnalysisResult,
  readCachedEngineAnalysis,
} from "../analysis/engine-analysis-cache.ts";
import type { EngineAnalysisReport } from "../analysis/engine-analysis.ts";
import type { PositionAnalysisSettings } from "../analysis/analysis-settings.ts";
import { calculateNodesPerSecond } from "../analysis/engine-search-rate.ts";
import type {
  GameAnalysisActivity,
  GameAnalysisController,
  GameAnalysisPoint,
  GameAnalysisPoints,
  GameAnalysisState,
} from "./game-analysis.ts";

interface ActiveGameAnalysis {
  readonly activity: GameAnalysisActivity;
  handle: EngineSearchHandle | null;
}

export interface GameAnalysisInput {
  readonly moves: readonly Square[];
  /** Exact terminal margin for a full board; null for resignation or timeout. */
  readonly terminalEvaluationHalfPoints: number | null;
}

/** Runs selected-position and sequential whole-game searches through one Worker. */
export function useGameAnalysis(
  input: GameAnalysisInput,
  client: AnalysisEngineClient = browserEngineClient,
): GameAnalysisController {
  const encodedMoves = useMemo(() => encodeEngineMoves(input.moves), [input.moves]);
  const positionKey = `${encodedMoves.join(",")}|${String(input.terminalEvaluationHalfPoints)}`;
  const initialPoints = useMemo(
    () => gameAnalysisPoints(encodedMoves.length, input.terminalEvaluationHalfPoints),
    [encodedMoves.length, input.terminalEvaluationHalfPoints],
  );
  const currentPositionKey = useRef(positionKey);
  const [state, setState] = useState<GameAnalysisState>({ status: "idle", points: initialPoints });
  const stateRef = useRef(state);
  const activeRef = useRef<ActiveGameAnalysis | null>(null);

  const publish = useCallback((next: GameAnalysisState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    if (currentPositionKey.current === positionKey) {
      return;
    }
    currentPositionKey.current = positionKey;
    activeRef.current?.handle?.cancel();
    activeRef.current = null;
    publish({ status: "idle", points: initialPoints });
  }, [initialPoints, positionKey, publish]);

  useEffect(
    () => () => {
      activeRef.current?.handle?.cancel();
      activeRef.current = null;
    },
    [],
  );

  const startSearch = useCallback(
    (
      active: ActiveGameAnalysis,
      ply: number,
      settings: PositionAnalysisSettings,
      previous: EngineAnalysisReport | null,
      onSuccess: (report: EngineAnalysisReport) => void,
    ) => {
      const searchMoves = encodedMoves.slice(0, ply);
      const isCurrent = () => activeRef.current === active;
      const fail = (message: string) => {
        if (!isCurrent()) {
          return;
        }
        const points = stateRef.current.points;
        activeRef.current = null;
        publish({ status: "error", points, message });
      };
      const convert = (success: Parameters<typeof engineAnalysisReport>[0]) => {
        try {
          return engineAnalysisReport(success);
        } catch (error) {
          active.handle?.cancel();
          fail(invalidEngineResponse(error));
          return null;
        }
      };

      active.handle = client.analyze(engineAnalysisRequest(searchMoves, settings), {
        onStarted() {
          if (isCurrent()) {
            publish({
              status: "analyzing",
              points: stateRef.current.points,
              activity: active.activity,
              progress: previous === null ? null : { ply, report: previous },
              nodesPerSecond: null,
            });
          }
        },
        onProgress(update, elapsedMs) {
          if (!isCurrent()) {
            return;
          }
          const report = convert(update);
          if (report !== null && isCurrent()) {
            cacheEngineAnalysisProgress(searchMoves, settings, report);
            publish({
              status: "analyzing",
              points: stateRef.current.points,
              activity: active.activity,
              progress: { ply, report },
              nodesPerSecond: calculateNodesPerSecond(update.nodes, elapsedMs),
            });
          }
        },
        onResult(response) {
          if (!isCurrent()) {
            return;
          }
          active.handle = null;
          if (!response.ok) {
            fail(engineAnalysisError(response.error));
            return;
          }
          const report = convert(response);
          if (report !== null && isCurrent()) {
            onSuccess(cacheEngineAnalysisResult(searchMoves, settings, report));
          }
        },
        onFailure: fail,
      });
    },
    [client, encodedMoves, publish],
  );

  const analyzePosition = useCallback(
    (ply: number, settings: PositionAnalysisSettings) => {
      if (!Number.isInteger(ply) || ply < 0 || ply > encodedMoves.length) {
        publish({
          status: "error",
          points: stateRef.current.points,
          message: "The selected replay position is outside this game.",
        });
        return;
      }

      activeRef.current?.handle?.cancel();
      activeRef.current = null;
      if (stateRef.current.points[ply]?.kind === "terminal") {
        publish({ status: "ready", points: stateRef.current.points });
        return;
      }

      const cached = readCachedEngineAnalysis(encodedMoves.slice(0, ply), settings);
      if (cached?.satisfiesRequest === true) {
        const points = replacePoint(stateRef.current.points, {
          kind: "search",
          ply,
          report: cached.report,
        });
        publish({ status: "ready", points });
        return;
      }

      const activity: GameAnalysisActivity = { kind: "position", ply };
      const active: ActiveGameAnalysis = { activity, handle: null };
      activeRef.current = active;
      publish({ status: "loading", points: stateRef.current.points, activity });
      startSearch(active, ply, settings, cached?.report ?? null, (report) => {
        const points = replacePoint(stateRef.current.points, {
          kind: "search",
          ply,
          report,
        });
        activeRef.current = null;
        publish({ status: "ready", points });
      });
    },
    [encodedMoves, publish, startSearch],
  );

  const analyzeGame = useCallback(
    (settings: PositionAnalysisSettings) => {
      activeRef.current?.handle?.cancel();
      const activity: GameAnalysisActivity = {
        kind: "game",
        totalPositions: encodedMoves.length + 1,
      };
      const active: ActiveGameAnalysis = { activity, handle: null };
      activeRef.current = active;

      const searchNext = () => {
        if (activeRef.current !== active) {
          return;
        }
        const ply = nextMissingPly(stateRef.current.points);
        if (ply === null) {
          const points = stateRef.current.points;
          activeRef.current = null;
          publish({ status: "ready", points });
          return;
        }

        const cached = readCachedEngineAnalysis(encodedMoves.slice(0, ply), settings);
        if (cached?.satisfiesRequest === true) {
          const points = replacePoint(stateRef.current.points, {
            kind: "search",
            ply,
            report: cached.report,
          });
          publish({
            status: "analyzing",
            points,
            activity,
            progress: null,
            nodesPerSecond: null,
          });
          searchNext();
          return;
        }

        startSearch(active, ply, settings, cached?.report ?? null, (report) => {
          const points = replacePoint(stateRef.current.points, {
            kind: "search",
            ply,
            report,
          });
          publish({
            status: "analyzing",
            points,
            activity,
            progress: null,
            nodesPerSecond: null,
          });
          searchNext();
        });
      };

      if (nextMissingPly(stateRef.current.points) === null) {
        activeRef.current = null;
        publish({ status: "ready", points: stateRef.current.points });
        return;
      }
      publish({ status: "loading", points: stateRef.current.points, activity });
      searchNext();
    },
    [encodedMoves, publish, startSearch],
  );

  const cancel = useCallback(() => {
    const active = activeRef.current;
    if (active === null) {
      return;
    }
    active.handle?.cancel();
    activeRef.current = null;
    const points = stateRef.current.points;
    publish({ status: points.some((point) => point !== null) ? "ready" : "idle", points });
  }, [publish]);

  return { state, analyzePosition, analyzeGame, cancel };
}

function gameAnalysisPoints(
  moveCount: number,
  terminalEvaluationHalfPoints: number | null,
): GameAnalysisPoints {
  const points = Array.from<GameAnalysisPoint | null>({ length: moveCount + 1 }).fill(null);
  if (terminalEvaluationHalfPoints !== null) {
    points[moveCount] = {
      kind: "terminal",
      ply: moveCount,
      evaluationHalfPoints: terminalEvaluationHalfPoints,
    };
  }
  return points;
}

function replacePoint(points: GameAnalysisPoints, point: GameAnalysisPoint): GameAnalysisPoints {
  return points.map((current, ply) => (ply === point.ply ? point : current));
}

function nextMissingPly(points: GameAnalysisPoints): number | null {
  const ply = points.findIndex((point) => point === null);
  return ply === -1 ? null : ply;
}
