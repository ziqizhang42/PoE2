import type { AuthUser, FinishedGameSnapshot } from "@poe2/protocol";
import { CELL_COUNT, type Player } from "@poe2/rules";

import { replayPath, LOBBY_PATH } from "../../app/routes.ts";
import { usePlayerProfile } from "../../players/queries.ts";
import { ratingScale } from "../../players/rating-tier.ts";
import { Button, LinkButton } from "../../ui/button.tsx";
import { HINT, NOTE } from "../../ui/classes.ts";
import { Modal } from "../../ui/modal.tsx";
import { describeMargin, isDecidedOnPoints } from "../outcome.ts";
import { opponentOf } from "./game-state.ts";
import { ratingMove } from "../../players/rating-change.ts";
import { useRatingChange } from "./use-rating-change.ts";

export function GameResultDialog({
  game,
  seat,
  viewer,
  onDismiss,
}: {
  readonly game: FinishedGameSnapshot;
  readonly seat: Player;
  readonly viewer: AuthUser;
  readonly onDismiss: () => void;
}) {
  const won = game.outcome.winner === seat;
  const opponent = opponentOf(game, seat)?.username ?? "your opponent";
  const margin = describeMargin(game.outcome, game.scores);

  return (
    <Modal labelledBy="game-result-title" onDismiss={onDismiss}>
      <div className="result-rise">
        <p
          className={`text-xs font-medium tracking-wide uppercase ${won ? "text-pen-1-text" : "text-ink-3"}`}
        >
          {game.rated ? "Rated game" : "Casual game"}
        </p>

        <h2
          id="game-result-title"
          className={`mt-1 font-display text-3xl leading-none font-medium tracking-tight ${
            won ? "text-pen-1-text" : "text-ink"
          }`}
        >
          {won ? "You won" : "You lost"}
        </h2>
        <p className="mt-2 text-lg text-ink">{margin}</p>
        <p className={`${NOTE} mt-1 text-sm`}>{explain(game, won, opponent)}</p>

        {game.rated ? (
          <RatingMove gameId={game.id} username={viewer.username} />
        ) : (
          <p className={`${HINT} mt-4 border-t border-line pt-4`}>
            Casual, so nobody&rsquo;s rating moved.
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <LinkButton to={LOBBY_PATH} variant="primary">
            Back to the lobby
          </LinkButton>
          <LinkButton to={replayPath(game.id)} variant="surface" size="sm">
            Replay
          </LinkButton>
          <Button variant="quiet" size="sm" onClick={onDismiss}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function explain(game: FinishedGameSnapshot, won: boolean, opponent: string): string {
  if (isDecidedOnPoints(game.outcome)) {
    return `The board filled after ${String(CELL_COUNT)} moves.`;
  }
  if (game.outcome.reason === "timeout") {
    return won
      ? `${opponent}'s clock expired after ${String(game.moves.length)} moves.`
      : `Your clock expired after ${String(game.moves.length)} moves.`;
  }
  return won
    ? `${opponent} resigned after ${String(game.moves.length)} moves.`
    : `You resigned after ${String(game.moves.length)} moves.`;
}

/** Draws the ledger change once both the event and profile scale are available. */
function RatingMove({ gameId, username }: { readonly gameId: string; readonly username: string }) {
  const change = useRatingChange(username, gameId);
  const profile = usePlayerProfile(username);

  if (change.isPending) {
    return (
      <p className={`${HINT} mt-4 border-t border-line pt-4`} aria-live="polite">
        Working out the rating…
      </p>
    );
  }

  const moved = change.data ?? null;
  if (moved === null) {
    return (
      <p className={`${HINT} mt-4 border-t border-line pt-4`}>
        {change.isError
          ? "The rating change could not be read. Your profile has it."
          : "This game left no rating change."}
      </p>
    );
  }

  const { before, after, delta, direction, signed } = ratingMove(moved);
  const scale =
    profile.data === undefined
      ? null
      : ratingScale(profile.data.rating.value, profile.data.rating.percentile);
  const beforeColor = scale?.(before) ?? null;
  const afterColor = scale?.(after) ?? null;

  return (
    <div className="mt-4 border-t border-line pt-4">
      <p className="text-xs font-medium text-ink-3">Your rating</p>
      <p className="num mt-1 flex flex-wrap items-baseline gap-2 text-2xl leading-none font-medium">
        <span style={beforeColor === null ? undefined : { color: beforeColor }}>{before}</span>
        <span aria-hidden="true" className="text-base text-ink-3">
          →
        </span>
        <span className="sr-only">to</span>
        <span style={afterColor === null ? undefined : { color: afterColor }}>{after}</span>
        {/* The sign communicates direction independently of color. */}
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            direction === "rose"
              ? "bg-pen-1-soft text-pen-1-text"
              : direction === "fell"
                ? "bg-pen-2-soft text-pen-2-text"
                : "bg-sunken text-ink-3"
          }`}
        >
          {delta === 0 ? "no change" : signed}
        </span>
      </p>
    </div>
  );
}
