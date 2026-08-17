import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Square } from "@poe2/rules";

import {
  browserEngineClient,
  type AnalysisEngineClient,
  type EngineSearchHandle,
} from "./browser-engine-client.ts";
import {
  encodeEngineMoves,
  engineAnalysisError,
  engineAnalysisReport,
  engineAnalysisRequest,
  invalidEngineResponse,
} from "./engine-analysis-adapter.ts";
import {
  cacheEngineAnalysisProgress,
  cacheEngineAnalysisResult,
  readCachedEngineAnalysis,
} from "./engine-analysis-cache.ts";
import {
  visibleEngineReport,
  type EngineAnalysisReport,
  type EngineAnalysisState,
} from "./engine-analysis.ts";
import type { PositionAnalysisSettings } from "./analysis-settings.ts";
import { calculateNodesPerSecond } from "./engine-search-rate.ts";

const IDLE_STATE: EngineAnalysisState = { status: "idle" };

interface ActiveAnalysis {
  handle: EngineSearchHandle | null;
  readonly previous: EngineAnalysisReport | null;
  retained: EngineAnalysisReport | null;
}

export interface EngineAnalysisController {
  readonly state: EngineAnalysisState;
  /** Known Player 1-normalized evaluations for prefixes of the visible line. */
  readonly evaluations: readonly (number | null)[];
  readonly analyze: (settings: PositionAnalysisSettings) => void;
  readonly cancel: () => void;
}

/** Runs standalone-board searches through the shared browser Worker. */
export function useEngineAnalysis(
  moves: readonly Square[],
  client: AnalysisEngineClient = browserEngineClient,
): EngineAnalysisController {
  const encodedMoves = useMemo(() => encodeEngineMoves(moves), [moves]);
  const positionKey = encodedMoves.join(",");
  const currentPositionKey = useRef(positionKey);
  const [state, setState] = useState<EngineAnalysisState>(IDLE_STATE);
  const stateRef = useRef(state);
  const activeRef = useRef<ActiveAnalysis | null>(null);
  const reportsByPosition = useRef(new Map<string, EngineAnalysisReport>());

  const remember = useCallback((key: string, report: EngineAnalysisReport) => {
    const current = reportsByPosition.current.get(key);
    if (current === undefined || report.nodes > current.nodes) {
      reportsByPosition.current.set(key, report);
    }
  }, []);

  const publish = useCallback((next: EngineAnalysisState) => {
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
    publish(IDLE_STATE);
  }, [positionKey, publish]);

  useEffect(
    () => () => {
      activeRef.current?.handle?.cancel();
      activeRef.current = null;
    },
    [],
  );

  const analyze = useCallback(
    (settings: PositionAnalysisSettings) => {
      activeRef.current?.handle?.cancel();
      activeRef.current = null;

      const cached = readCachedEngineAnalysis(encodedMoves, settings);
      if (cached?.satisfiesRequest === true) {
        remember(positionKey, cached.report);
        publish({ status: "ready", report: cached.report });
        return;
      }

      const previous = cached?.report ?? visibleEngineReport(stateRef.current);
      if (previous !== null) {
        remember(positionKey, previous);
      }
      const active: ActiveAnalysis = { handle: null, previous, retained: previous };
      activeRef.current = active;
      publish({ status: "loading" });

      const isCurrent = () => activeRef.current === active;
      const fail = (message: string) => {
        if (!isCurrent()) {
          return;
        }
        const latest = active.retained;
        activeRef.current = null;
        publish({ status: "error", message, previous: latest });
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

      active.handle = client.analyze(engineAnalysisRequest(encodedMoves, settings), {
        onStarted() {
          if (isCurrent()) {
            publish({ status: "analyzing", progress: null, previous, nodesPerSecond: null });
          }
        },
        onProgress(update, elapsedMs) {
          if (!isCurrent()) {
            return;
          }
          const progress = convert(update);
          if (progress !== null && isCurrent()) {
            const deepest = cacheEngineAnalysisProgress(encodedMoves, settings, progress);
            active.retained = deepest;
            remember(positionKey, deepest);
            publish({
              status: "analyzing",
              progress,
              previous,
              nodesPerSecond: calculateNodesPerSecond(update.nodes, elapsedMs),
            });
          }
        },
        onResult(response) {
          if (!isCurrent()) {
            return;
          }
          if (!response.ok) {
            fail(engineAnalysisError(response.error));
            return;
          }
          const report = convert(response);
          if (report !== null && isCurrent()) {
            const deepest = cacheEngineAnalysisResult(encodedMoves, settings, report);
            remember(positionKey, deepest);
            activeRef.current = null;
            publish({ status: "ready", report: deepest });
          }
        },
        onFailure: fail,
      });
    },
    [client, encodedMoves, positionKey, publish, remember],
  );

  const cancel = useCallback(() => {
    const active = activeRef.current;
    if (active === null) {
      return;
    }

    active.handle?.cancel();
    activeRef.current = null;
    publish(active.retained === null ? IDLE_STATE : { status: "ready", report: active.retained });
  }, [publish]);

  const evaluations = encodedMoves.map((_move, ply) => {
    const key = encodedMoves.slice(0, ply).join(",");
    return reportsByPosition.current.get(key)?.evaluationHalfPoints ?? null;
  });
  evaluations.push(reportsByPosition.current.get(positionKey)?.evaluationHalfPoints ?? null);

  return { state, evaluations, analyze, cancel };
}
