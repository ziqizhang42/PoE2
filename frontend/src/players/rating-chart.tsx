/** Scrubbable rating history; historical percentile colors are today's estimate. */

import {
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import type { RatingPercentile, RatingPoint } from "@poe2/protocol";

import { CARD, CARD_TITLE, NOTE } from "../ui/classes.ts";
import {
  formatPointDate,
  indexAtFraction,
  pointsInRange,
  RATING_RANGES,
  type RatingRangeId,
} from "./rating-chart-model.ts";
import { describeRatingHistory, ratingHistoryShape } from "./rating-history.ts";
import { describeRatingPercentile, percentileAt, ratingColor, ratingScale } from "./rating-tier.ts";

const VIEWBOX_WIDTH = 300;
const VIEWBOX_HEIGHT = 90;
const PADDING = 8;

export function RatingChart({
  value,
  history,
  percentile,
  deviation,
  children,
}: {
  readonly value: number;
  readonly history: readonly RatingPoint[];
  readonly percentile: RatingPercentile;
  readonly deviation: number;
  readonly children?: ReactNode;
}) {
  const [rangeId, setRangeId] = useState<RatingRangeId>("all");
  const [cursor, setCursor] = useState<number | null>(null);
  const plot = useRef<SVGSVGElement>(null);
  const selectId = useId();

  const range = RATING_RANGES.find((candidate) => candidate.id === rangeId) ?? RATING_RANGES[3];
  // Use one instant for every point at the range boundary.
  const windowed = useMemo(
    () => (range === undefined ? history : pointsInRange(history, range, Date.now())),
    [history, range],
  );
  const shape = useMemo(() => ratingHistoryShape(windowed), [windowed]);

  const color = ratingColor(percentile);
  const hovered = shape === null || cursor === null ? null : (shape.points[cursor] ?? null);
  const scale = ratingScale(value, percentile);
  const hoveredColor = hovered === null || scale === null ? color : scale(hovered.rating);
  const hoveredPercentile =
    hovered === null || percentile === null
      ? null
      : percentileAt(hovered.rating, value, percentile);

  return (
    <section className={CARD} aria-labelledby="rating-chart-title">
      <h2 id="rating-chart-title" className={CARD_TITLE}>
        Rating
        <span className="flex items-center gap-2 font-sans text-xs font-normal text-ink-3">
          <label htmlFor={selectId} className="sr-only">
            Range shown
          </label>
          <select
            id={selectId}
            value={rangeId}
            onChange={(event) => {
              setCursor(null);
              setRangeId(event.target.value as RatingRangeId);
            }}
            className="rounded-sm border border-line bg-sunken px-2 py-1 text-xs text-ink-2"
          >
            {RATING_RANGES.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
        </span>
      </h2>

      <p className="num text-4xl leading-none font-medium tracking-tight">
        <span style={hoveredColor === null ? undefined : { color: hoveredColor }}>
          {hovered?.rating ?? value}
        </span>
        {/* Preserve line height while deviation is irrelevant to a hovered point. */}
        <span
          aria-hidden={hovered === null ? undefined : true}
          className={`ml-1 align-super text-lg font-normal text-ink-3 ${hovered === null ? "" : "invisible"}`}
        >
          ±{deviation}
        </span>
      </p>
      <p className={`${NOTE} mt-2 min-h-[1.25rem] text-xs`}>
        {hovered === null
          ? describeRatingPercentile(percentile)
          : hoveredPercentile === null
            ? formatPointDate(hovered.at)
            : `${formatPointDate(hovered.at)} — above ${String(hoveredPercentile)}% today`}
      </p>

      {shape === null ? (
        <p className={`${NOTE} mt-3`}>
          {history.length < 2
            ? "Nothing to draw yet. A rated game leaves a point here; two leave a line."
            : "Nothing to draw in this window. Widen the range to see the line."}
        </p>
      ) : (
        <div className="mt-3 rounded-sm bg-sunken p-1">
          <svg
            ref={plot}
            role="img"
            tabIndex={0}
            aria-label={describeRatingHistory(shape)}
            viewBox={`0 0 ${String(VIEWBOX_WIDTH)} ${String(VIEWBOX_HEIGHT)}`}
            className="block h-24 w-full touch-none"
            preserveAspectRatio="none"
            onPointerMove={(event: PointerEvent<SVGSVGElement>) => {
              const box = plot.current?.getBoundingClientRect();
              if (box === undefined || box.width === 0) {
                return;
              }
              setCursor(
                indexAtFraction((event.clientX - box.left) / box.width, shape.heights.length),
              );
            }}
            onPointerLeave={() => {
              setCursor(null);
            }}
            onBlur={() => {
              setCursor(null);
            }}
            onKeyDown={(event: KeyboardEvent<SVGSVGElement>) => {
              const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
              if (step === 0) {
                return;
              }
              event.preventDefault();
              const last = shape.heights.length - 1;
              const from = cursor ?? last;
              setCursor(Math.min(last, Math.max(0, from + step)));
            }}
          >
            <Plot
              ratings={shape.points.map((point) => point.rating)}
              heights={shape.heights}
              color={color}
              markColor={hoveredColor}
              scale={scale}
              cursor={cursor}
            />
          </svg>
        </div>
      )}

      {children}
    </section>
  );
}

function Plot({
  ratings,
  heights,
  color,
  markColor,
  scale,
  cursor,
}: {
  readonly ratings: readonly number[];
  readonly heights: readonly number[];
  readonly color: string | null;
  readonly markColor: string | null;
  readonly scale: ((rating: number) => string | null) | null;
  readonly cursor: number | null;
}) {
  const gradientId = useId();
  const stepX = heights.length > 1 ? (VIEWBOX_WIDTH - PADDING * 2) / (heights.length - 1) : 0;
  const at = (index: number, height: number): readonly [number, number] => [
    PADDING + index * stepX,
    // SVG y coordinates increase downward.
    VIEWBOX_HEIGHT - PADDING - height * (VIEWBOX_HEIGHT - PADDING * 2),
  ];
  const corners = heights.map((height, index) => at(index, height));
  const line = corners
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${(corners.at(-1)?.[0] ?? 0).toFixed(1)} ${String(VIEWBOX_HEIGHT)} L${(corners[0]?.[0] ?? 0).toFixed(1)} ${String(VIEWBOX_HEIGHT)} Z`;
  const marked = cursor ?? heights.length - 1;
  const [markX, markY] = corners[marked] ?? [0, 0];

  const banded = scale === null ? null : `url(#${gradientId})`;
  const paint = banded ?? color;

  return (
    <>
      {scale === null ? null : (
        <defs>
          <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
            {ratings.map((rating, index) => {
              const stop = scale(rating);
              return stop === null ? null : (
                <stop
                  key={index}
                  offset={ratings.length > 1 ? index / (ratings.length - 1) : 0}
                  stopColor={stop}
                />
              );
            })}
          </linearGradient>
        </defs>
      )}
      <path
        d={area}
        className={paint === null ? "fill-pen-1" : ""}
        opacity={0.18}
        {...(paint === null ? {} : { fill: paint })}
      />
      <path
        d={line}
        className={`fill-none ${paint === null ? "stroke-pen-1" : ""}`}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...(paint === null ? {} : { stroke: paint })}
      />
      {/* Keep cursor position visually distinct from percentile color. */}
      {cursor === null ? null : (
        <line
          x1={markX}
          x2={markX}
          y1={0}
          y2={VIEWBOX_HEIGHT}
          className="stroke-ink-3"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      )}
      <circle
        cx={markX}
        cy={markY}
        r={3.5}
        className={markColor === null ? "fill-pen-1" : ""}
        {...(markColor === null ? {} : { fill: markColor })}
      />
    </>
  );
}
