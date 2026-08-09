import type { CSSProperties } from "react";

import type { Run } from "@poe2/rules";

import { BOARD_VIEWBOX, runBand, runKey, type RunMark } from "./board-model.ts";

/** Decorative blended strokes for maximal runs; the run list carries the text. */
export function RunBands({ runs }: { runs: readonly Run[] }) {
  return (
    <svg
      className="run-band pointer-events-none absolute inset-[5px] z-2"
      viewBox={`0 0 ${BOARD_VIEWBOX} ${BOARD_VIEWBOX}`}
      aria-hidden="true"
    >
      {runs.map((run) => {
        const band = runBand(run);
        return (
          <line
            key={runKey(run)}
            className="run-stroke"
            x1={band.x1}
            y1={band.y1}
            x2={band.x2}
            y2={band.y2}
            strokeWidth={34}
            strokeLinecap="round"
            stroke={run.player === 1 ? "var(--pen-1)" : "var(--pen-2)"}
            style={{ "--run-pow": run.length - 1 } as CSSProperties}
          />
        );
      })}
    </svg>
  );
}

/** Non-blended labels for the largest runs, positioned between counters. */
export function RunMarks({ marks }: { marks: readonly RunMark[] }) {
  if (marks.length === 0) {
    return null;
  }

  return (
    <svg
      className="pointer-events-none absolute inset-[5px] z-4 hidden overflow-visible sm:block"
      viewBox={`0 0 ${BOARD_VIEWBOX} ${BOARD_VIEWBOX}`}
      aria-hidden="true"
    >
      {marks.map((mark) => (
        <text
          key={mark.key}
          className="run-mark"
          x={mark.x}
          y={mark.y}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          ×{mark.value}
        </text>
      ))}
    </svg>
  );
}
