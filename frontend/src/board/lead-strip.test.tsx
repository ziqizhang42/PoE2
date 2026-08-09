import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { allSquares, formatSquare, parseSquare, type Square } from "@poe2/rules";

import { LeadStrip, MoveLeadStrip } from "./lead-strip.tsx";
import { lastPly, progression } from "./progression.ts";

function squares(notation: readonly string[]): readonly Square[] {
  return notation.map((text) => {
    const square = parseSquare(text);
    if (square === null) {
      throw new RangeError(text);
    }
    return square;
  });
}

describe("LeadStrip", () => {
  it("is one image, not fifty things to read out", () => {
    const derived = progression(squares(["d4", "a1"]));
    render(<LeadStrip progression={derived} currentPly={2} boardFull={false} />);

    expect(screen.getAllByRole("img")).toHaveLength(1);
  });

  it("labels itself with the move it is speaking about, not the length of a game", () => {
    const moves = squares(["d4", "a1", "d5", "a2", "d6", "a3"]);
    const derived = progression(moves);

    render(<LeadStrip progression={derived} currentPly={6} boardFull={false} />);

    const strip = screen.getByRole("img");
    expect(strip).toHaveAccessibleName(/after move 6/);
    expect(strip).not.toHaveAccessibleName(/49/);
  });

  it("keeps its sentence to the label, since the screen already prints the standing", () => {
    const derived = progression(squares(["d4", "a1"]));
    render(<LeadStrip progression={derived} currentPly={2} boardFull={false} />);

    const label = screen.getByRole("img").getAttribute("aria-label");
    expect(label).not.toBeNull();
    expect(screen.queryByText(label ?? "")).not.toBeInTheDocument();
  });

  it("says who leads and by how much in words", () => {
    const derived = progression([]);
    render(<LeadStrip progression={derived} currentPly={0} boardFull={false} />);

    expect(screen.getByRole("img")).toHaveAccessibleName(/Player 2 is ahead by 5½/);
  });

  it("speaks of a finished game as finished", () => {
    const moves = squares(allSquares().map(formatSquare));
    const derived = progression(moves);

    render(<LeadStrip progression={derived} currentPly={lastPly(derived)} boardFull />);

    expect(screen.getByRole("img")).toHaveAccessibleName(/finished ahead by/);
    expect(screen.getByRole("img")).toHaveAccessibleName(/board full/);
  });
});

describe("MoveLeadStrip", () => {
  it("replays the move list it is given rather than being told the answer", () => {
    const moves = squares(["d4", "a1", "d5", "a2"]);

    render(<MoveLeadStrip moves={moves} boardFull={false} />);

    expect(screen.getByRole("img")).toHaveAccessibleName(/after move 4/);
  });

  it("shows the opening position before anything is played", () => {
    render(<MoveLeadStrip moves={[]} boardFull={false} />);

    expect(screen.getByRole("img")).toHaveAccessibleName(/No moves played yet/);
  });

  it("reports a finished game's own margin", () => {
    const moves = squares(allSquares().map(formatSquare));

    render(<MoveLeadStrip moves={moves} boardFull />);

    expect(screen.getByRole("img")).toHaveAccessibleName(/Player 1 finished ahead by 34½/);
  });

  it("does not turn an early resignation into a full-board result", () => {
    render(<MoveLeadStrip moves={squares(["d4", "a1"])} boardFull={false} />);

    expect(screen.getByRole("img")).toHaveAccessibleName(/after move 2/);
    expect(screen.getByRole("img")).not.toHaveAccessibleName(/finished ahead|board full/);
  });
});
