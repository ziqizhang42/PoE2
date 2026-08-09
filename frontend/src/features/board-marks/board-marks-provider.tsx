import { useCallback, useMemo, useState, type ReactNode } from "react";

import { BoardMarksContext, type BoardMarksControl } from "./board-marks-context.ts";
import {
  browserBoardMarksStorage,
  DEFAULT_BOARD_MARKS,
  type BoardMarks,
  type BoardMarksStorage,
} from "./board-marks.ts";

type BoardMarksProviderProps = {
  children: ReactNode;
  storage?: BoardMarksStorage;
};

export function BoardMarksProvider({ children, storage }: BoardMarksProviderProps) {
  const [marksStorage] = useState(() => storage ?? browserBoardMarksStorage());
  const [chosen, setChosen] = useState<BoardMarks>(
    () => marksStorage.read() ?? DEFAULT_BOARD_MARKS,
  );

  const update = useCallback(
    (next: BoardMarks) => {
      marksStorage.write(next);
      setChosen(next);
    },
    [marksStorage],
  );

  const value = useMemo<BoardMarksControl>(
    () => ({
      chosen,
      setRunValues: (shown) => {
        update({ ...chosen, runValues: shown });
      },
      setSquareGains: (shown) => {
        update({ ...chosen, squareGains: shown });
      },
    }),
    [chosen, update],
  );

  return <BoardMarksContext value={value}>{children}</BoardMarksContext>;
}
