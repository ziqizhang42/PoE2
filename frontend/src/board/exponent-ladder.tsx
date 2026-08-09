import { useMemo, type CSSProperties } from "react";

import type { Board } from "@poe2/rules";

import { CARD, CARD_TITLE, TABLE, TABLE_SCROLL, TD, TH } from "../ui/classes.ts";
import {
  exponentLadder,
  rungBarPercent,
  type LadderRung,
  type RungSide,
} from "./exponent-ladder-model.ts";

export function ExponentLadder({ board }: { board: Board }) {
  const ladder = useMemo(() => exponentLadder(board), [board]);

  return (
    <section className={CARD} aria-labelledby="ladder-title">
      <h2 id="ladder-title" className={CARD_TITLE}>
        Exponent ladder <span className="num">{ladder.totalRuns} scoring</span>
      </h2>

      <div className={TABLE_SCROLL}>
        <table className={TABLE}>
          <caption className="sr-only">
            How many runs of each length each player holds, and what those runs pay
          </caption>
          <thead>
            <tr>
              <th scope="col" className={`${TH} pl-2.5`}>
                Pays
              </th>
              <th scope="col" className={TH}>
                Length
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Player 1
              </th>
              <th scope="col" className={`${TH} pr-2.5 text-right`}>
                Player 2
              </th>
            </tr>
          </thead>
          <tbody>
            {ladder.rungs.map((rung) => (
              <Rung key={rung.value} rung={rung} peakPoints={ladder.peakPoints} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type RungProps = {
  rung: LadderRung;
  peakPoints: number;
};

function Rung({ rung, peakPoints }: RungProps) {
  const live = rung.playerOne.count > 0 || rung.playerTwo.count > 0;

  return (
    <tr>
      <th
        scope="row"
        className={`${TD} num pl-2.5 text-left font-semibold ${live ? "" : "text-ink-3"}`}
      >
        {rung.value}
      </th>
      <td className={`${TD} text-xs whitespace-nowrap text-ink-3`}>
        {rung.length === 1 ? "alone" : `${String(rung.length)} long`}
      </td>
      <Side side={rung.playerOne} peakPoints={peakPoints} player={1} />
      <Side side={rung.playerTwo} peakPoints={peakPoints} player={2} />
    </tr>
  );
}

type SideProps = {
  side: RungSide;
  peakPoints: number;
  player: 1 | 2;
};

function Side({ side, peakPoints, player }: SideProps) {
  const percent = rungBarPercent(side.points, peakPoints);

  return (
    <td className={`${TD} ${player === 2 ? "pr-2.5" : ""}`}>
      <span className="flex items-center justify-end gap-2">
        <span aria-hidden="true" className="flex h-2 min-w-0 flex-1 justify-end">
          <span
            className={`ladder-rung h-full rounded-full ${player === 1 ? "bg-pen-1" : "bg-pen-2"}`}
            style={{ "--rung-percent": `${String(percent)}%` } as CSSProperties}
          />
        </span>
        <span className={`num w-6 shrink-0 text-right ${side.count === 0 ? "text-ink-3" : ""}`}>
          {side.count}
        </span>
      </span>
    </td>
  );
}
