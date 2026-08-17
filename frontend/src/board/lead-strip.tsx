import { useMemo, type CSSProperties } from "react";

import { CELL_COUNT, type Square } from "@poe2/rules";

import {
  describeProgression,
  lastPly,
  pointAt,
  progression,
  type Progression,
} from "./progression.ts";

type LeadStripProps = {
  progression: Progression;
  /** Ply described by the selected-position marker and accessible label. */
  currentPly: number;
  /** Last ply drawn. Defaults to the selected ply for live or editable lines. */
  visibleThroughPly?: number;
  /** Last ply on the horizontal axis. Defaults to the board's full 49-move capacity. */
  axisFinalPly?: number;
  /** True only when the current position is the full-board result. */
  boardFull: boolean;
};

const MIN_BAR_PERCENT = 8;

/**
 * Lead sparkline: direction conveys the leader without color, while height is
 * scaled to this game's peak. Its single image label avoids dozens of announcements.
 */
export function LeadStrip({
  progression,
  currentPly,
  visibleThroughPly = currentPly,
  axisFinalPly = CELL_COUNT,
  boardFull,
}: LeadStripProps) {
  const description = describeProgression(progression, currentPly, boardFull);
  const renderedFinalPly = Math.max(currentPly, visibleThroughPly, axisFinalPly);

  return (
    <div
      role="img"
      aria-label={description}
      className="relative flex h-16 gap-px rounded-sm bg-sunken px-1 py-1"
    >
      <span aria-hidden="true" className="absolute inset-x-1 top-1/2 h-px bg-line" />
      {Array.from({ length: renderedFinalPly + 1 }, (_unused, ply) => (
        <Segment
          key={ply}
          ply={ply}
          progression={progression}
          currentPly={currentPly}
          visibleThroughPly={visibleThroughPly}
          peak={progression.peakHalfPoints}
        />
      ))}
    </div>
  );
}

export function MoveLeadStrip({
  moves,
  boardFull,
}: {
  moves: readonly Square[];
  boardFull: boolean;
}) {
  const derived = useMemo(() => progression(moves), [moves]);

  return <LeadStrip progression={derived} currentPly={lastPly(derived)} boardFull={boardFull} />;
}

type SegmentProps = {
  ply: number;
  progression: Progression;
  currentPly: number;
  visibleThroughPly: number;
  peak: number;
};

function Segment({ ply, progression, currentPly, visibleThroughPly, peak }: SegmentProps) {
  // Future plies are absent, not tied.
  if (ply > visibleThroughPly) {
    return <span aria-hidden="true" className="min-w-0 flex-1" />;
  }

  const point = pointAt(progression, ply);
  const share = peak === 0 ? 0 : Math.abs(point.marginHalfPoints) / peak;
  const height = `${String(Math.max(MIN_BAR_PERCENT, share * 100))}%`;
  const leadsAbove = point.leader === 1;

  return (
    <span aria-hidden="true" className="relative flex min-w-0 flex-1 flex-col">
      {ply === currentPly ? (
        <span className="absolute inset-y-[-4px] left-1/2 z-1 w-px -translate-x-1/2 bg-ink" />
      ) : null}

      <span className="flex h-1/2 items-end">
        {leadsAbove ? (
          <span
            className="lead-bar w-full rounded-t-[1px] bg-pen-1"
            style={{ "--lead-height": height } as CSSProperties}
          />
        ) : null}
      </span>
      <span className="flex h-1/2 items-start">
        {leadsAbove ? null : (
          <span
            className="lead-bar w-full rounded-b-[1px] bg-pen-2"
            style={{ "--lead-height": height } as CSSProperties}
          />
        )}
      </span>
    </span>
  );
}
