/** Theme-aware percentile colors; text remains the primary ranking signal. */

import type { RatingPercentile } from "@poe2/protocol";

/** Interpolate eight anchors in perceptually uniform OKLab space. */
const ANCHOR_COUNT = 8;

export function ratingColor(percentile: RatingPercentile): string | null {
  if (percentile === null) {
    return null;
  }

  const clamped = Math.min(100, Math.max(0, percentile));
  const position = (clamped * (ANCHOR_COUNT - 1)) / 100;
  const lower = Math.floor(position) + 1;
  const upper = Math.ceil(position) + 1;

  if (lower === upper) {
    return `var(--tier-${String(lower)})`;
  }

  const upperWeight = Number(((position % 1) * 100).toFixed(2));
  return `color-mix(in oklab, var(--tier-${String(lower)}), var(--tier-${String(upper)}) ${String(upperWeight)}%)`;
}

/**
 * Fits a monotone logistic estimate through today's rating and percentile.
 * Historical colors therefore mean where that rating would rank today.
 */
export function ratingScale(
  current: number,
  percentile: RatingPercentile,
): ((rating: number) => string | null) | null {
  if (percentile === null) {
    return null;
  }

  return (rating) => ratingColor(percentileAt(rating, current, percentile));
}

const CENTRE = 1500;
const DEFAULT_SPREAD = 200;
const MIN_SPREAD = 50;
const MAX_SPREAD = 800;

export function percentileAt(rating: number, current: number, percentile: number): number {
  const spread = spreadFrom(current, percentile);
  const share = 1 / (1 + Math.exp(-(rating - CENTRE) / spread));
  return Math.min(100, Math.max(0, Math.round(share * 100)));
}

function spreadFrom(current: number, percentile: number): number {
  // Reported endpoints are rounded shares, not mathematical infinities.
  const share = Math.min(0.995, Math.max(0.005, percentile / 100));
  const offset = current - CENTRE;
  const logit = Math.log(share / (1 - share));

  if (offset === 0 || logit === 0 || offset / logit <= 0) {
    // The center point does not constrain the spread.
    return DEFAULT_SPREAD;
  }

  return Math.min(MAX_SPREAD, Math.max(MIN_SPREAD, offset / logit));
}

export function describeRatingPercentile(percentile: RatingPercentile): string {
  if (percentile === null) {
    return "Not ranked yet — a rated game places this rating.";
  }
  return `Higher than ${String(percentile)}% of rated players.`;
}
