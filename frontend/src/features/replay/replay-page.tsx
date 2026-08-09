import { useParams } from "react-router";

import type { GameReplay } from "@poe2/protocol";
import { marginHalfPoints } from "@poe2/rules";

import { REPLAY_TITLE, useDocumentTitle } from "../../app/document-title.ts";
import { HOME_PATH, playerPath } from "../../app/routes.ts";
import { ExponentLadder } from "../../board/exponent-ladder.tsx";
import { formatHalfPoints } from "../../board/half-points.ts";
import { ReplayBoard } from "../../board/replay-board.tsx";
import { ScorePanel } from "../../board/score-panel.tsx";
import { Scrubber } from "../../board/scrubber.tsx";
import { usePlyPlayback } from "../../board/use-ply-playback.ts";
import { useGameReplay } from "../../games/queries.ts";
import { isNotFound } from "../../games/errors.ts";
import { PagePending } from "../../shell/page-pending.tsx";
import { PlayerLink } from "../../players/player-link.tsx";
import { LinkButton } from "../../ui/button.tsx";
import { CARD, EYEBROW, H_LG, H_XL, NOTE, STACK, TWO_UP } from "../../ui/classes.ts";
import { Chip } from "../../ui/chip.tsx";
import { BoardMarksControl } from "../board-marks/board-marks-control.tsx";
import { useBoardMarks } from "../board-marks/board-marks-context.ts";
import { MoveHistory } from "../game/move-history.tsx";
import { isDecidedOnPoints } from "../outcome.ts";
import { formatClock, formatTimeControl } from "../time-control.ts";

export function ReplayPage() {
  useDocumentTitle(REPLAY_TITLE);
  const params = useParams();
  const gameId = params["gameId"] ?? "";
  const query = useGameReplay(gameId);

  if (query.isPending) {
    return <PagePending label="Fetching the game record…" />;
  }

  if (query.isError) {
    return isNotFound(query.error) ? (
      <Missing
        title="No such game"
        detail="No finished game has that address. A game still being played is not readable here until it is decided."
      />
    ) : (
      <Missing title="That game could not be fetched" detail={query.error.message} />
    );
  }

  // Reset playback when navigating directly between records.
  return <Replay key={query.data.id} game={query.data} />;
}

function Replay({ game }: { game: GameReplay }) {
  const playback = usePlyPlayback({ moves: game.moves, start: "end", autoplay: false });
  const { frame } = playback;
  const marks = useBoardMarks().chosen;

  const winnerName =
    game.outcome.winner === 1 ? game.players.playerOne.username : game.players.playerTwo.username;
  const loserName =
    game.outcome.winner === 1 ? game.players.playerTwo.username : game.players.playerOne.username;

  const remaining = remainingAtPly(game, playback.ply, playback.finalPly);
  const moveTimesMs = game.clockHistory?.moves.map((move) => move.elapsedMs) ?? null;

  const finalMargin = isDecidedOnPoints(game.outcome)
    ? `by ${formatHalfPoints(marginHalfPoints(playback.script.frames[playback.finalPly]?.scores ?? frame.scores))}`
    : game.outcome.reason === "timeout"
      ? "on time"
      : "by resignation";

  return (
    <div className={TWO_UP}>
      <div className={STACK}>
        <div>
          <p className={EYEBROW}>A finished game</p>
          <h1 className={H_XL}>
            <PlayerLink
              username={winnerName}
              className={game.outcome.winner === 1 ? "text-pen-1-text" : "text-pen-2-text"}
            />{" "}
            <span className="text-ink-3">beat</span>{" "}
            <PlayerLink
              username={loserName}
              className={game.outcome.winner === 1 ? "text-pen-2-text" : "text-pen-1-text"}
            />{" "}
            <span className="text-ink-3">{finalMargin}</span>
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={game.rated ? "player-1" : "neutral"}>
              {game.rated ? "Rated" : "Casual"}
            </Chip>
            <Chip>
              {isDecidedOnPoints(game.outcome)
                ? "Board full"
                : game.outcome.reason === "timeout"
                  ? "Timeout"
                  : "Resigned"}
            </Chip>
            <Chip>{formatTimeControl(game.timeControl)}</Chip>
          </div>
        </div>

        <section className={CARD} aria-labelledby="replay-board-title">
          <h2 id="replay-board-title" className="sr-only">
            The board at the position being read
          </h2>

          <ReplayBoard frame={frame} showRunValues={marks.runValues} />

          <div className="mt-4 border-t border-line pt-4">
            <Scrubber
              progression={playback.script.progression}
              ply={playback.ply}
              finalPly={playback.finalPly}
              boardFull={isDecidedOnPoints(game.outcome)}
              onSeek={playback.seek}
            />
          </div>
        </section>

        <MoveHistory moves={frame.moves} {...(moveTimesMs === null ? {} : { moveTimesMs })} />
      </div>

      <div className={STACK}>
        <ScorePanel
          titleId="replay-readout-title"
          scores={frame.scores}
          nameOne={<PlayerLink username={game.players.playerOne.username} />}
          nameTwo={<PlayerLink username={game.players.playerTwo.username} />}
          finished={playback.ply === playback.finalPly && isDecidedOnPoints(game.outcome)}
          detail={
            <>
              ply <span className="num">{playback.ply}</span> of{" "}
              <span className="num">{playback.finalPly}</span>
            </>
          }
          {...(remaining === null
            ? {}
            : {
                clockOne: formatClock(remaining.playerOne),
                clockTwo: formatClock(remaining.playerTwo),
              })}
        />

        <ExponentLadder board={frame.board} />
        <BoardMarksControl />

        <div>
          <LinkButton to={playerPath(game.players.playerOne.username)} variant="quiet" size="sm">
            {game.players.playerOne.username}&rsquo;s games
          </LinkButton>
        </div>
      </div>
    </div>
  );
}

/** Uses configured, per-move, or final stopped balances for the selected ply. */
function remainingAtPly(
  game: GameReplay,
  ply: number,
  finalPly: number,
): { readonly playerOne: number; readonly playerTwo: number } | null {
  if (game.timeControl.kind === "untimed" || game.clockHistory === null) {
    return null;
  }
  if (ply === finalPly) {
    return game.clockHistory.final.remainingMs;
  }
  if (ply === 0) {
    return { playerOne: game.timeControl.initialMs, playerTwo: game.timeControl.initialMs };
  }
  return game.clockHistory.moves[ply - 1]?.remainingMs ?? null;
}

function Missing({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="py-12">
      <div className={`${CARD} mx-auto max-w-md`}>
        <h1 className={H_LG}>{title}</h1>
        <p className={NOTE}>{detail}</p>
        <LinkButton to={HOME_PATH} variant="primary" className="mt-4">
          Back to the start
        </LinkButton>
      </div>
    </div>
  );
}
