import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { engineEvaluationValueText } from "./engine-evaluation.ts";
import { EngineEvaluationStrip } from "./engine-evaluation-strip.tsx";

describe("EngineEvaluationStrip", () => {
  it("describes the selected evaluation and partial whole-game progress", () => {
    render(
      <EngineEvaluationStrip
        evaluations={[1, -3, null]}
        currentPly={1}
        finalPly={2}
        axisFinalPly={2}
      />,
    );

    const strip = screen.getByRole("img");
    expect(strip).toHaveAccessibleName(/engine evaluation −1½, advantage orange/u);
    expect(strip).toHaveAccessibleName(/2 of 3 positions analyzed/u);
    expect(strip.children).toHaveLength(4);
  });

  it("distinguishes an even result from a position that has not been analyzed", () => {
    expect(engineEvaluationValueText([0, null], 0, 1)).toContain("evaluation 0, an even position");
    expect(engineEvaluationValueText([0, null], 1, 1)).toContain("engine evaluation not available");
  });
});
