import type { Player } from "@poe2/rules";

import { FILES, RANKS } from "./board-model.ts";
import { candidateRankAt, type CandidatePlacementGroup } from "./engine-candidate.ts";

/** Numbered root-move markers; symmetric placements intentionally share a rank. */
export function EngineCandidateMarks({
  groups,
  selectedRank,
  rootPlayer,
}: {
  readonly groups: readonly CandidatePlacementGroup[];
  readonly selectedRank: number;
  readonly rootPlayer: Player;
}) {
  if (groups.length === 0) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-[5px] z-5 grid grid-rows-7"
    >
      {RANKS.map((row) => (
        <div key={row} className="grid grid-cols-7">
          {FILES.map((col) => {
            const rank = candidateRankAt(groups, { row, col });
            return (
              <span key={col} className="relative min-h-0 min-w-0">
                {rank === null ? null : (
                  <span
                    data-engine-rank={rank}
                    data-root-player={rootPlayer}
                    data-selected={rank === selectedRank ? "true" : "false"}
                    className="engine-candidate-rank num absolute top-[5px] right-[5px] flex size-5 items-center justify-center rounded-full border text-[10px] leading-none font-bold shadow-lift sm:size-6 sm:text-xs"
                  >
                    {rank}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}
