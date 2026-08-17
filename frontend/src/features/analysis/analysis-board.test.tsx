import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createGame, parseSquare, type Square } from "@poe2/rules";

import type { CandidatePlacementGroup } from "../../board/engine-candidate.ts";
import { BoardMarksProvider } from "../board-marks/board-marks-provider.tsx";
import { AnalysisBoard } from "./analysis-board.tsx";

function square(notation: string): Square {
  const parsed = parseSquare(notation);
  if (parsed === null) {
    throw new RangeError(notation);
  }
  return parsed;
}

describe("AnalysisBoard engine candidates", () => {
  it("labels ranked equivalent placements without making the board read-only", async () => {
    const onPlay = vi.fn();
    const groups: readonly CandidatePlacementGroup[] = [
      { rank: 1, squares: [square("d4"), square("e4")] },
      { rank: 2, squares: [square("c3")] },
    ];
    render(
      <BoardMarksProvider
        storage={{
          read: () => ({ runValues: false, squareGains: false }),
          write: () => undefined,
        }}
      >
        <AnalysisBoard
          game={createGame()}
          candidateGroups={groups}
          selectedRank={1}
          onPlay={onPlay}
        />
      </BoardMarksProvider>,
    );

    const d4 = screen.getByRole("gridcell", {
      name: /d4, empty, play for Player 1, engine candidate rank 1, selected candidate/u,
    });
    expect(screen.getByRole("gridcell", { name: /e4.+engine candidate rank 1/u })).toBeVisible();
    expect(screen.getByRole("gridcell", { name: /c3.+engine candidate rank 2/u })).toBeVisible();

    await userEvent.click(d4);
    expect(onPlay).toHaveBeenCalledWith(square("d4"));
  });
});
