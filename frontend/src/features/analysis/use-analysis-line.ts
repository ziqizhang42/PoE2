import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import type { Square } from "@poe2/rules";

import {
  analysisLine,
  playAnalysisMove,
  redoAnalysisMove,
  resetAnalysisLine,
  seekAnalysisPly,
  undoAnalysisMove,
  type AnalysisLine,
} from "./analysis-line.ts";
import { analysisPath, readAnalysisUrl } from "./analysis-url.ts";

export interface AnalysisLineControl {
  readonly line: AnalysisLine;
  readonly urlError: string | null;
  readonly play: (square: Square) => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly seek: (ply: number) => void;
  readonly reset: () => void;
}

/** Owns the editable line while keeping its current position shareable in the address bar. */
export function useAnalysisLine(): AnalysisLineControl {
  const location = useLocation();
  const navigate = useNavigate();
  const initial = useRef(readAnalysisUrl(location.search));
  const handledSearch = useRef(location.search);
  const [line, setLine] = useState<AnalysisLine>(() =>
    analysisLine(initial.current.ok ? initial.current.moves : []),
  );
  const [urlError, setUrlError] = useState<string | null>(() =>
    initial.current.ok ? null : initial.current.message,
  );

  // Handle links to another analysis position while this route remains mounted.
  useEffect(() => {
    if (handledSearch.current === location.search) {
      return;
    }

    handledSearch.current = location.search;
    const decoded = readAnalysisUrl(location.search);
    setLine(analysisLine(decoded.ok ? decoded.moves : []));
    setUrlError(decoded.ok ? null : decoded.message);
  }, [location.search]);

  const commit = useCallback(
    (next: AnalysisLine) => {
      const target = analysisPath(next.game.moves);
      const queryStart = target.indexOf("?");
      handledSearch.current = queryStart === -1 ? "" : target.slice(queryStart);
      setLine(next);
      setUrlError(null);
      void navigate(target, { replace: true });
    },
    [navigate],
  );

  const play = useCallback(
    (square: Square) => {
      commit(playAnalysisMove(line, square));
    },
    [commit, line],
  );

  const undo = useCallback(() => {
    commit(undoAnalysisMove(line));
  }, [commit, line]);

  const redo = useCallback(() => {
    commit(redoAnalysisMove(line));
  }, [commit, line]);

  const seek = useCallback(
    (ply: number) => {
      commit(seekAnalysisPly(line, ply));
    },
    [commit, line],
  );

  const reset = useCallback(() => {
    commit(resetAnalysisLine(line));
  }, [commit, line]);

  return { line, urlError, play, undo, redo, seek, reset };
}
