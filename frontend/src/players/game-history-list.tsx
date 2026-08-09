/** Public game rows interpreted from the profile owner's seat. */

import type { GameHistoryEntry, GameHistoryPage } from "@poe2/protocol";
import { marginHalfPoints } from "@poe2/rules";
import type { UseInfiniteQueryResult } from "@tanstack/react-query";

import { replayPath } from "../app/routes.ts";
import { formatHalfPoints } from "../board/half-points.ts";
import { isDecidedOnPoints } from "../features/outcome.ts";
import { formatTimeControl } from "../features/time-control.ts";
import { Button, LinkButton } from "../ui/button.tsx";
import { CARD, CARD_TITLE, NOTE, TABLE, TABLE_SCROLL, TD, TH } from "../ui/classes.ts";
import { StatusNote } from "../ui/status-note.tsx";
import type { PlayerRequestError } from "./errors.ts";
import { PlayerLink } from "./player-link.tsx";
import { ratingMove } from "./rating-change.ts";

const ENDED: Record<GameHistoryEntry["outcome"]["reason"], string> = {
  board_full: "board full",
  resignation: "resigned",
  timeout: "time expired",
};

export interface GameHistoryListProps {
  readonly username: string;
  readonly total?: number;
  readonly games: UseInfiniteQueryResult<
    { readonly pages: readonly GameHistoryPage[] },
    PlayerRequestError
  >;
}

export function GameHistoryList({ username, total, games }: GameHistoryListProps) {
  return (
    <section className={CARD} aria-labelledby="player-games-title">
      <h2 id="player-games-title" className={CARD_TITLE}>
        Games
        {total === undefined ? null : (
          <span className="num text-xs font-normal text-ink-3">{total} played</span>
        )}
      </h2>
      <Body username={username} games={games} />
    </section>
  );
}

function Body({ username, games }: GameHistoryListProps) {
  if (games.isPending) {
    return <p className={NOTE}>Fetching finished games…</p>;
  }

  if (games.isError) {
    return (
      <>
        <StatusNote
          tone="alarm"
          title="These games could not be fetched"
          detail={games.error.message}
          live="alert"
        />
        <Button
          variant="primary"
          className="mt-4"
          onClick={() => {
            void games.refetch();
          }}
        >
          Try again
        </Button>
      </>
    );
  }

  const rows = games.data.pages.flatMap((page) => page.games);

  if (rows.length === 0) {
    return (
      <p className={NOTE}>
        No finished games yet. One appears here once it is decided, whether the board filled,
        somebody resigned, or a clock expired.
      </p>
    );
  }

  return (
    <>
      <div className={TABLE_SCROLL}>
        <table className={TABLE}>
          <caption className="sr-only">
            Every game {username} has finished, most recently decided first
          </caption>
          <thead>
            <tr>
              <th scope="col" className={`${TH} pl-2.5`}>
                Opponent
              </th>
              <th scope="col" className={TH}>
                Result
              </th>
              <th scope="col" className={TH}>
                By
              </th>
              <th scope="col" className={TH}>
                Ended
              </th>
              <th scope="col" className={TH}>
                Moves
              </th>
              <th scope="col" className={TH}>
                Clock
              </th>
              <th scope="col" className={TH}>
                Rating
              </th>
              <th scope="col" className={`${TH} pr-2.5 text-right`}>
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((game) => (
              <HistoryRow key={game.id} game={game} />
            ))}
          </tbody>
        </table>
      </div>

      {games.hasNextPage ? (
        <Button
          variant="surface"
          className="mt-4"
          disabled={games.isFetchingNextPage}
          onClick={() => {
            void games.fetchNextPage();
          }}
        >
          {games.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      ) : null}
    </>
  );
}

function HistoryRow({ game }: { game: GameHistoryEntry }) {
  const won = game.outcome.winner === game.seat;

  return (
    <tr>
      <td className={`${TD} pl-2.5`}>
        <PlayerLink username={game.opponent.username} className="block font-medium" />
        <span className="block text-xs text-ink-3">
          Player <span className="num">{game.seat}</span>
        </span>
      </td>
      <td className={`${TD} font-semibold ${won ? "text-pen-1-text" : "text-pen-2-text"}`}>
        {won ? "Won" : "Lost"}
      </td>
      <td className={TD}>
        {isDecidedOnPoints(game.outcome) ? (
          <span className="num">{formatHalfPoints(marginHalfPoints(game.scores))}</span>
        ) : (
          <span className="text-ink-3">—</span>
        )}
      </td>
      <td className={`${TD} text-ink-3`}>{ENDED[game.outcome.reason]}</td>
      <td className={TD}>
        <span className="num text-ink-3">{game.plies}</span>
      </td>
      <td className={`${TD} whitespace-nowrap text-ink-3`}>
        {formatTimeControl(game.timeControl)}
      </td>
      <td className={TD}>
        <RatingCell game={game} />
      </td>
      <td className={`${TD} pr-2.5 text-right`}>
        <LinkButton to={replayPath(game.id)} variant="surface" size="sm">
          Read
        </LinkButton>
      </td>
    </tr>
  );
}

/** Rating delta whose sign communicates direction independently of color. */
function RatingCell({ game }: { game: GameHistoryEntry }) {
  const change = game.ratingChange;

  if (change === null) {
    return <span className="text-ink-3">casual</span>;
  }

  const { after, direction, signed } = ratingMove(change);
  const tone =
    direction === "rose"
      ? "text-pen-1-text"
      : direction === "fell"
        ? "text-pen-2-text"
        : "text-ink-3";
  return (
    <span className="num whitespace-nowrap">
      {after} <span className={`text-xs ${tone}`}>{signed}</span>
    </span>
  );
}
