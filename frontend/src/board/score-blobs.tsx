import type { ReactNode } from "react";

import {
  marginHalfPoints,
  PLAYER_TWO_HANDICAP_HALF_POINTS,
  type Player,
  type ScoreByPlayer,
} from "@poe2/rules";

import { formatHalfPoints } from "./half-points.ts";

type ScoreBlobsProps = {
  readonly scores: ScoreByPlayer;
  readonly nameOne?: ReactNode;
  readonly nameTwo?: ReactNode;
  readonly clockOne?: string;
  readonly clockTwo?: string;
  readonly running?: Player;
  /** Separate from `running` because untimed games still have a side to move. */
  readonly thinking?: Player;
  readonly viewerSeat?: Player;
};

/** Comparable post-handicap totals, with the raw arithmetic shown beneath. */
export function ScoreBlobs({
  scores,
  nameOne,
  nameTwo,
  clockOne,
  clockTwo,
  running,
  thinking,
  viewerSeat,
}: ScoreBlobsProps) {
  const leader: Player = marginHalfPoints(scores) > 0 ? 1 : 2;
  const playerTwoTotal = scores.playerTwo * 2 + PLAYER_TWO_HANDICAP_HALF_POINTS;

  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      <Blob
        player={1}
        name={nameOne ?? "Player 1"}
        leads={leader === 1}
        isViewer={viewerSeat === 1}
        total={String(scores.playerOne)}
        derivation="no handicap"
        running={running === 1}
        thinking={thinking === 1}
        {...(clockOne === undefined ? {} : { clock: clockOne })}
      />
      <Blob
        player={2}
        name={nameTwo ?? "Player 2"}
        leads={leader === 2}
        isViewer={viewerSeat === 2}
        total={formatHalfPoints(playerTwoTotal)}
        derivation={`${String(scores.playerTwo)} + 5½`}
        running={running === 2}
        thinking={thinking === 2}
        {...(clockTwo === undefined ? {} : { clock: clockTwo })}
      />
    </dl>
  );
}

type BlobProps = {
  readonly player: Player;
  readonly name: ReactNode;
  readonly leads: boolean;
  readonly isViewer: boolean;
  readonly total: string;
  readonly derivation: string;
  readonly running: boolean;
  readonly thinking: boolean;
  readonly clock?: string;
};

/* Player 2's solid fill needs dark ink to meet contrast. */
const FILLS: Record<Player, { lead: string; trail: string; glow: string }> = {
  1: {
    lead: "bg-pen-1 text-on-fill",
    trail: "bg-pen-1-soft text-pen-1-text",
    glow: "[--glow-ink:var(--pen-1)]",
  },
  2: {
    lead: "bg-pen-2 text-on-pen-2",
    trail: "bg-pen-2-soft text-pen-2-text",
    glow: "[--glow-ink:var(--pen-2)]",
  },
};

function Blob({
  player,
  name,
  leads,
  isViewer,
  total,
  derivation,
  running,
  thinking,
  clock,
}: BlobProps) {
  const fill = FILLS[player];

  return (
    <div
      className={`min-w-0 rounded-md px-3 py-2.5 ${leads ? fill.lead : fill.trail} ${
        thinking ? `thinking-glow ${fill.glow}` : ""
      }`}
    >
      <dt className="flex min-w-0 items-center gap-2 text-sm">
        <span className="min-w-0 truncate">{name}</span>
        {isViewer ? <span className="shrink-0 text-xs">you</span> : null}
      </dt>
      <dd className="m-0 mt-1.5 flex items-baseline justify-between gap-2">
        <span className="num text-2xl leading-none font-medium tracking-tight">{total}</span>
        {clock === undefined ? null : (
          <span className={`num shrink-0 text-xs leading-none ${running ? "font-semibold" : ""}`}>
            {clock}
            <span className="sr-only">{running ? " left, and running" : " left on the clock"}</span>
          </span>
        )}
      </dd>
      <dd className="num m-0 mt-1 text-xs leading-none">{derivation}</dd>
    </div>
  );
}

/** Text equivalent of the margin represented by the score blobs. */
export function LeadLine({
  scores,
  finished,
  detail,
  nameOne,
  nameTwo,
}: {
  readonly scores: ScoreByPlayer;
  readonly finished: boolean;
  readonly detail?: ReactNode;
  readonly nameOne?: string;
  readonly nameTwo?: string;
}) {
  const halfPoints = marginHalfPoints(scores);
  const leader = halfPoints > 0 ? 1 : 2;
  const leaderName = (leader === 1 ? nameOne : nameTwo) ?? `Player ${String(leader)}`;

  return (
    <p className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
      <span>
        <b className={`font-semibold ${leader === 1 ? "text-pen-1-text" : "text-pen-2-text"}`}>
          {leaderName}
        </b>{" "}
        <span className="text-ink-2">{finished ? "won by" : "ahead by"}</span>{" "}
        <span className="num font-semibold">{formatHalfPoints(halfPoints)}</span>
      </span>
      {detail === undefined ? null : <span className="num text-ink-3">{detail}</span>}
    </p>
  );
}
