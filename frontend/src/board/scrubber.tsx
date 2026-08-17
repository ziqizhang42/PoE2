import type { ReactNode } from "react";

import { HINT } from "../ui/classes.ts";
import { formatHalfPoints } from "./half-points.ts";
import { LeadStrip } from "./lead-strip.tsx";
import { pointAt, type Progression } from "./progression.ts";

type ScrubberProps = {
  progression: Progression;
  ply: number;
  finalPly: number;
  boardFull: boolean;
  /** Draw the finished score history even when an earlier ply is selected. */
  completeScoreTimeline?: boolean;
  onSeek: (ply: number) => void;
  /** Replaces the score lead strip while retaining the same native range input. */
  timeline?: ReactNode;
  /** Accessible value for a replacement timeline. Defaults to the board-score standing. */
  positionValueText?: string;
};

/** Native range input over the lead strip, retaining keyboard and AT behavior. */
export function Scrubber({
  progression,
  ply,
  finalPly,
  boardFull,
  completeScoreTimeline = false,
  onSeek,
  timeline,
  positionValueText,
}: ScrubberProps) {
  const point = pointAt(progression, ply);
  const leader = point.marginHalfPoints === 0 ? "level" : `Player ${String(point.leader)} ahead`;
  const margin =
    point.marginHalfPoints === 0 ? "" : ` by ${formatHalfPoints(point.marginHalfPoints)}`;

  return (
    <div>
      <div className="relative rounded-sm focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-pen-1">
        {timeline ?? (
          <LeadStrip
            progression={progression}
            currentPly={ply}
            visibleThroughPly={completeScoreTimeline ? finalPly : ply}
            boardFull={boardFull && ply === finalPly}
            {...(completeScoreTimeline ? { axisFinalPly: finalPly } : {})}
          />
        )}

        <input
          type="range"
          min={0}
          max={finalPly}
          step={1}
          value={ply}
          onChange={(event) => {
            onSeek(Number(event.target.value));
          }}
          aria-label="Position after ply"
          aria-valuetext={
            positionValueText ?? `Ply ${String(ply)} of ${String(finalPly)}, ${leader}${margin}`
          }
          className="absolute inset-x-0 -top-1.5 -bottom-1.5 w-full cursor-ew-resize opacity-0"
        />
      </div>

      <p className={`${HINT} flex flex-wrap justify-between gap-x-4`}>
        <span>Drag, or use the arrow keys.</span>
        <span className="num">
          ply {ply} / {finalPly}
        </span>
      </p>
    </div>
  );
}
