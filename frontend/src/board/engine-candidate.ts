import { squareIndex, type Square } from "@poe2/rules";

export interface CandidatePlacementGroup {
  readonly rank: number;
  readonly squares: readonly Square[];
}

export function candidateRankAt(
  groups: readonly CandidatePlacementGroup[],
  square: Square,
): number | null {
  const index = squareIndex(square);
  for (const group of groups) {
    if (group.squares.some((candidate) => squareIndex(candidate) === index)) {
      return group.rank;
    }
  }
  return null;
}
