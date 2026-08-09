import type { RatingPoint } from "@poe2/protocol";

export interface RatingHistoryShape {
  readonly points: readonly RatingPoint[];
  readonly lowest: number;
  readonly highest: number;
  readonly current: number;
  readonly ratedGames: number;
  readonly heights: readonly number[];
}

export function ratingHistoryShape(points: readonly RatingPoint[]): RatingHistoryShape | null {
  if (points.length < 2) {
    return null;
  }

  const ratings = points.map((point) => point.rating);
  const lowest = Math.min(...ratings);
  const highest = Math.max(...ratings);
  const span = highest - lowest;

  return {
    points,
    lowest,
    highest,
    current: ratings[ratings.length - 1] ?? 0,
    ratedGames: points.length - 1,
    // Center a flat line instead of implying every point is a low.
    heights: ratings.map((rating) => (span === 0 ? 0.5 : (rating - lowest) / span)),
  };
}

export function describeRatingHistory(shape: RatingHistoryShape): string {
  const started = shape.points[0]?.rating ?? shape.current;
  const direction =
    shape.current > started ? "up" : shape.current < started ? "down" : "level with";

  const games = `${String(shape.ratedGames)} rated game${shape.ratedGames === 1 ? "" : "s"}`;
  const movement =
    direction === "level with"
      ? `level with where it started, ${String(started)}`
      : `${direction} from ${String(started)}`;

  return `Rating over ${games}: now ${String(shape.current)}, ${movement}. Highest ${String(shape.highest)}, lowest ${String(shape.lowest)}.`;
}
