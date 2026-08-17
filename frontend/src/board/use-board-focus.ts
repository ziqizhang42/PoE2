import { useCallback, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { BOARD_SIZE, formatSquare, parseSquare, type Square } from "@poe2/rules";

import { sameSquare } from "./board-model.ts";

const STEPS: Record<string, { readonly row: number; readonly col: number }> = {
  ArrowUp: { row: 1, col: 0 },
  ArrowDown: { row: -1, col: 0 },
  ArrowLeft: { row: 0, col: -1 },
  ArrowRight: { row: 0, col: 1 },
};

function clamp(value: number): number {
  return Math.min(BOARD_SIZE - 1, Math.max(0, value));
}

function nextSquare(from: Square, key: string): Square | null {
  const step = STEPS[key];
  if (step !== undefined) {
    return { row: clamp(from.row + step.row), col: clamp(from.col + step.col) };
  }

  if (key === "Home") {
    return { row: from.row, col: 0 };
  }
  if (key === "End") {
    return { row: from.row, col: BOARD_SIZE - 1 };
  }

  return null;
}

export interface BoardFocus {
  readonly anchor: Square;
  readonly isAnchor: (square: Square) => boolean;
  readonly gridRef: (node: HTMLElement | null) => void;
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  readonly onFocus: (event: { readonly target: EventTarget | null }) => void;
}

/** Roving tabindex that never moves focus in response to a board render. */
export function useBoardFocus(initial: Square): BoardFocus {
  const [anchor, setAnchor] = useState<Square>(initial);
  const grid = useRef<HTMLElement | null>(null);

  const gridRef = useCallback((node: HTMLElement | null) => {
    grid.current = node;
  }, []);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const from = parseSquare(target.dataset["square"] ?? "");
    if (from === null) {
      return;
    }

    const next = nextSquare(from, event.key);
    if (next === null) {
      return;
    }

    // Claim recognized keys even when movement clamps at an edge.
    event.preventDefault();

    if (sameSquare(next, from)) {
      return;
    }

    setAnchor(next);
    grid.current?.querySelector<HTMLElement>(`[data-square="${formatSquare(next)}"]`)?.focus();
  }, []);

  const onFocus = useCallback((event: { readonly target: EventTarget | null }) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const square = parseSquare(target.dataset["square"] ?? "");
    if (square !== null) {
      setAnchor(square);
    }
  }, []);

  const isAnchor = useCallback((square: Square) => sameSquare(square, anchor), [anchor]);

  return { anchor, isAnchor, gridRef, onKeyDown, onFocus };
}
