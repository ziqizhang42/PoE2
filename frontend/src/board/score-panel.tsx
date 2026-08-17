/** Shared live/replay/analysis panel for the two player score cards. */

import type { ReactNode } from "react";

import type { Player, ScoreByPlayer } from "@poe2/rules";

import { CARD } from "../ui/classes.ts";
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
  titleId,
  children,
}: ScorePanelProps) {
  return (
    <section className={CARD} aria-labelledby={titleId}>
      <h2 id={titleId} className="sr-only">
        Score
      </h2>

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

      {children}
    </section>
  );
}
