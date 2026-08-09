import type { RatingPoint } from "@poe2/protocol";

export type RatingRangeId = "1d" | "1w" | "1m" | "all";

export interface RatingRange {
  readonly id: RatingRangeId;
  readonly label: string;
  readonly days: number | null;
}

export const RATING_RANGES: readonly RatingRange[] = [
  { id: "1d", label: "1 day", days: 1 },
  { id: "1w", label: "1 week", days: 7 },
  { id: "1m", label: "1 month", days: 30 },
  { id: "all", label: "Last 100", days: null },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Includes the preceding point so a window begins from its prior rating. */
export function pointsInRange(
  points: readonly RatingPoint[],
  range: RatingRange,
  now: number,
): readonly RatingPoint[] {
  if (range.days === null) {
    return points;
  }

  const cut = now - range.days * DAY_MS;
  const first = points.findIndex((point) => timeOf(point) >= cut);

  if (first === -1) {
    return [];
  }

  return points.slice(first === 0 ? 0 : first - 1);
}

function timeOf(point: RatingPoint): number {
  const parsed = Date.parse(point.at);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function indexAtFraction(fraction: number, count: number): number {
  if (count <= 1) {
    return 0;
  }
  const clamped = Math.min(1, Math.max(0, fraction));
  return Math.round(clamped * (count - 1));
}

export function formatPointDate(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) {
    return "an unknown date";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}
