import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { parseSquare, type Square } from "@poe2/rules";

import { EngineCandidateMarks } from "./engine-candidate-marks.tsx";
import { candidateRankAt, type CandidatePlacementGroup } from "./engine-candidate.ts";

function square(notation: string): Square {
  const parsed = parseSquare(notation);
  if (parsed === null) {
    throw new RangeError(notation);
  }
  return parsed;
}

const GROUPS: readonly CandidatePlacementGroup[] = [
  { rank: 1, squares: [square("d4"), square("e4")] },
  { rank: 2, squares: [square("c3")] },
];

describe("EngineCandidateMarks", () => {
  it("puts one shared rank on every equivalent placement", () => {
    const view = render(<EngineCandidateMarks groups={GROUPS} selectedRank={2} rootPlayer={2} />);

    expect(view.container.querySelectorAll('[data-engine-rank="1"]')).toHaveLength(2);
    expect(view.container.querySelectorAll('[data-engine-rank="2"]')).toHaveLength(1);
    expect(view.container.querySelector('[data-engine-rank="2"]')).toHaveAttribute(
      "data-selected",
      "true",
    );
    expect(view.container.querySelectorAll('[data-root-player="2"]')).toHaveLength(3);
  });

  it("finds a rank by physical square without merging unrelated groups", () => {
    expect(candidateRankAt(GROUPS, square("e4"))).toBe(1);
    expect(candidateRankAt(GROUPS, square("c3"))).toBe(2);
    expect(candidateRankAt(GROUPS, square("a1"))).toBeNull();
  });
});
