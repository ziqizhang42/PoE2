/** Shared live/replay score panel; signed margins are relative to the viewer. */

import type { ReactNode } from "react";

import { marginHalfPoints, type Player, type ScoreByPlayer } from "@poe2/rules";

import { CARD } from "../ui/classes.ts";
import { formatHalfPoints } from "./half-points.ts";
import { ScoreBlobs } from "./score-blobs.tsx";

export interface ScorePanelProps {
  readonly scores: ScoreByPlayer;
  readonly nameOne: ReactNode | null;
  readonly nameTwo: ReactNode | null;
  readonly viewerSeat?: Player;
  readonly clockOne?: string;
  readonly clockTwo?: string;
  readonly running?: Player | null;
  readonly thinking?: Player | null;
  readonly finished: boolean;
  readonly detail: ReactNode;
  readonly titleId: string;
  readonly children?: ReactNode;
}

export function ScorePanel({
  scores,
  nameOne,
  nameTwo,
  viewerSeat,
  clockOne,
  clockTwo,
  running,
  thinking,
  finished,
  detail,
  titleId,
  children,
}: ScorePanelProps) {
  const halfPoints = marginHalfPoints(scores);
  const leader: Player = halfPoints > 0 ? 1 : 2;
  const towardsViewer = viewerSeat === 2 ? -halfPoints : halfPoints;
  const headline =
    viewerSeat === undefined
      ? formatHalfPoints(Math.abs(halfPoints))
      : `${towardsViewer > 0 ? "+" : "−"}${formatHalfPoints(Math.abs(towardsViewer))}`;
  const leaderName = leader === 1 ? nameOne : nameTwo;

  return (
    <section className={CARD} aria-labelledby={titleId}>
      <h2 id={titleId} className="sr-only">
        Score
      </h2>

      <p className="num text-3xl leading-none font-medium tracking-tight">{headline}</p>
      <p className="mt-2 text-sm text-ink-2">
        <b className="font-semibold text-ink">
          {leader === viewerSeat ? (
            "You are"
          ) : leaderName === null ? (
            `Player ${String(leader)} is`
          ) : (
            <>{leaderName} is</>
          )}{" "}
          {finished ? "ahead with the board full" : "ahead"}
        </b>{" "}
        {detail}
      </p>

      <div className="mt-4 border-t border-line pt-4">
        <ScoreBlobs
          scores={scores}
          nameOne={nameOne ?? "Player 1"}
          nameTwo={nameTwo ?? "Player 2"}
          {...(viewerSeat === undefined ? {} : { viewerSeat })}
          {...(clockOne === undefined ? {} : { clockOne })}
          {...(clockTwo === undefined ? {} : { clockTwo })}
          {...(running === undefined || running === null ? {} : { running })}
          {...(thinking === undefined || thinking === null ? {} : { thinking })}
        />
      </div>

      {children}
    </section>
  );
}
