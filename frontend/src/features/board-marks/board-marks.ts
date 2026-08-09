import { localKeyValueStore, type KeyValueStore } from "../../theme/theme.ts";

export const BOARD_MARKS_STORAGE_KEY = "poe2-board-marks";

export interface BoardMarks {
  readonly runValues: boolean;
  readonly squareGains: boolean;
}

export const DEFAULT_BOARD_MARKS: BoardMarks = { runValues: true, squareGains: true };

export const NO_BOARD_MARKS: BoardMarks = { runValues: false, squareGains: false };

/** Rated games suppress both optional aids regardless of preference. */
export function marksFor(chosen: BoardMarks, rated: boolean): BoardMarks {
  return rated ? NO_BOARD_MARKS : chosen;
}

export interface BoardMarksStorage {
  read(): BoardMarks | null;
  write(marks: BoardMarks): void;
}

function isBoardMarks(value: unknown): value is BoardMarks {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<BoardMarks>;
  return typeof candidate.runValues === "boolean" && typeof candidate.squareGains === "boolean";
}

export function browserBoardMarksStorage(
  store: KeyValueStore | null = localKeyValueStore(),
): BoardMarksStorage {
  return {
    read() {
      if (store === null) {
        return null;
      }

      try {
        const raw = store.getItem(BOARD_MARKS_STORAGE_KEY);
        if (raw === null) {
          return null;
        }
        const parsed: unknown = JSON.parse(raw);
        return isBoardMarks(parsed)
          ? { runValues: parsed.runValues, squareGains: parsed.squareGains }
          : null;
      } catch {
        return null;
      }
    },
    write(marks) {
      if (store === null) {
        return;
      }

      try {
        store.setItem(BOARD_MARKS_STORAGE_KEY, JSON.stringify(marks));
      } catch {}
    },
  };
}
