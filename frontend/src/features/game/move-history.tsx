import { formatSquare, type Square } from "@poe2/rules";

import { CARD, CARD_TITLE, NOTE, TABLE, TABLE_SCROLL, TD, TH } from "../../ui/classes.ts";
import { formatMoveTime } from "../time-control.ts";

export function MoveHistory({
  moves,
  moveTimesMs,
}: {
  readonly moves: readonly Square[];
  readonly moveTimesMs?: readonly number[];
}) {
  const turns = Math.ceil(moves.length / 2);

  return (
    <section className={CARD} aria-labelledby="moves-title">
      <h2 id="moves-title" className={CARD_TITLE}>
        Moves <span className="num">{moves.length} played</span>
      </h2>

      {moves.length === 0 ? (
        <p className={NOTE}>Nothing has been played yet.</p>
      ) : (
        <div className={`${TABLE_SCROLL} max-h-72 overflow-y-auto`}>
          <table className={TABLE}>
            <caption className="sr-only">Every move played, in order</caption>
            <thead>
              <tr>
                <th className={`${TH} pl-2.5`}>Turn</th>
                <th className={TH}>Player 1</th>
                <th className={`${TH} pr-2.5`}>Player 2</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: turns }, (_unused, turn) => {
                const first = moves[turn * 2];
                const second = moves[turn * 2 + 1];

                return (
                  <tr key={turn}>
                    <td className={`${TD} num pl-2.5 text-ink-3`}>{turn + 1}</td>
                    <td className={`${TD} num text-pen-1-text`}>
                      {first === undefined ? "" : formatSquare(first)}
                      <MoveTime milliseconds={moveTimesMs?.[turn * 2]} />
                    </td>
                    <td className={`${TD} num pr-2.5 text-pen-2-text`}>
                      {second === undefined ? "" : formatSquare(second)}
                      <MoveTime milliseconds={moveTimesMs?.[turn * 2 + 1]} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function MoveTime({ milliseconds }: { readonly milliseconds: number | undefined }) {
  if (milliseconds === undefined) {
    return null;
  }

  return (
    <span className="ml-1.5 text-xs text-ink-3">
      {formatMoveTime(milliseconds)}
      <span className="sr-only"> spent on this move</span>
    </span>
  );
}
