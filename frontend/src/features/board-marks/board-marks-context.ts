import { createContext, useContext } from "react";

import type { BoardMarks } from "./board-marks.ts";

export interface BoardMarksControl {
  readonly chosen: BoardMarks;
  setRunValues: (shown: boolean) => void;
  setSquareGains: (shown: boolean) => void;
}

export const BoardMarksContext = createContext<BoardMarksControl | null>(null);

export function useBoardMarks(): BoardMarksControl {
  const control = useContext(BoardMarksContext);

  if (control === null) {
    throw new Error("BoardMarksProvider must enclose any component that reads the board marks");
  }

  return control;
}
