import { CELL_COUNT, formatSquare, parseSquare, replay, type Square } from "@poe2/rules";

import { ANALYSIS_PATH } from "../../app/routes.ts";

export const ANALYSIS_MOVES_PARAMETER = "moves";

export type AnalysisUrlResult =
  | { readonly ok: true; readonly moves: readonly Square[] }
  | { readonly ok: false; readonly message: string };

/** A compact, readable URL for a legal position reached from the empty board. */
export function analysisPath(moves: readonly Square[]): string {
  const notation = moves.map(formatSquare).join(",");
  return notation.length === 0
    ? ANALYSIS_PATH
    : `${ANALYSIS_PATH}?${ANALYSIS_MOVES_PARAMETER}=${notation}`;
}

/** Validates untrusted URL state before it becomes an editable local position. */
export function readAnalysisUrl(search: string): AnalysisUrlResult {
  const parameters = new URLSearchParams(search);
  const encodedHistories = parameters.getAll(ANALYSIS_MOVES_PARAMETER);

  if (encodedHistories.length === 0) {
    return { ok: true, moves: [] };
  }
  if (encodedHistories.length > 1) {
    return { ok: false, message: "The position link contains more than one move history." };
  }

  const encoded = encodedHistories[0] ?? "";
  if (encoded.length === 0) {
    return { ok: true, moves: [] };
  }

  const tokens = encoded.split(",");
  if (tokens.length > CELL_COUNT) {
    return {
      ok: false,
      message: `The position link contains more than ${String(CELL_COUNT)} moves.`,
    };
  }

  const moves: Square[] = [];
  for (const [index, token] of tokens.entries()) {
    const move = parseSquare(token);
    if (move === null) {
      return {
        ok: false,
        message: `Move ${String(index + 1)} in the position link is not an a1–g7 square.`,
      };
    }
    moves.push(move);
  }

  const rebuilt = replay(moves);
  if (!rebuilt.ok) {
    return {
      ok: false,
      message: `Move ${String(rebuilt.index + 1)} in the position link is not legal (${rebuilt.error}).`,
    };
  }

  return { ok: true, moves };
}
