import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";

import type { GameSnapshot } from "@poe2/protocol";
import type { Square } from "@poe2/rules";

import { GAME_TITLE, useDocumentTitle } from "../../app/document-title.ts";
import { LOBBY_PATH, replayPath } from "../../app/routes.ts";
import { ExponentLadder } from "../../board/exponent-ladder.tsx";
import { MoveLeadStrip } from "../../board/lead-strip.tsx";
import { useSession } from "../../auth/queries.ts";
import { isNotFound } from "../../games/errors.ts";
import { useGameReplay } from "../../games/queries.ts";
import {
  useGame,
  useGameReceivedAtMs,
  useLiveCommands,
  useLiveStatus,
  useLiveSynced,
  useLiveUserId,
  useReconnectAttempts,
} from "../../live/hooks.ts";
import type { LiveStatus } from "../../live/store.ts";
import { PagePending } from "../../shell/page-pending.tsx";
import { PlayerLink } from "../../players/player-link.tsx";
import { Button, LinkButton } from "../../ui/button.tsx";
import { CARD, EYEBROW, H_LG, H_XL, HINT, NOTE, STACK, TWO_UP } from "../../ui/classes.ts";
import { Chip } from "../../ui/chip.tsx";
import { StatusNote } from "../../ui/status-note.tsx";
import { describeConnection, type ConnectionDescription } from "../connection.ts";
import { useCommandRunner } from "../use-command-runner.ts";
import { Board } from "./board.tsx";
import { describeStanding, moveGate, playersBySeat, seatOf } from "./game-state.ts";
import { MoveHistory } from "./move-history.tsx";
import {
  describeMoveFailure,
  describeResignationFailure,
  describeWithdrawalFailure,
} from "./move-failure.ts";
import { moveKey, pendingMoveSquare } from "./move-keys.ts";
import { BoardMarksControl } from "../board-marks/board-marks-control.tsx";
import { useBoardMarks } from "../board-marks/board-marks-context.ts";
import { marksFor } from "../board-marks/board-marks.ts";
import { GameResultDialog } from "./game-result-dialog.tsx";
import { ResignControl } from "./resign-control.tsx";
import { ScoreReadout } from "./score-readout.tsx";
import { formatTimeControl } from "../time-control.ts";

const RESIGN_KEY = "resign";
const WITHDRAW_KEY = "withdraw";

const PHASE: Record<GameSnapshot["status"], string> = {
  waiting: "Waiting",
  ready_check: "Ready check",
  active: "In play",
  finished: "Finished",
};

export function GamePage() {
  useDocumentTitle(GAME_TITLE);
  const params = useParams();
  const gameId = params["gameId"] ?? "";

  const session = useSession();
  const liveStatus = useLiveStatus();
  const liveUserId = useLiveUserId();
  const reconnectAttempts = useReconnectAttempts();
  const liveGame = useGame(gameId);
  const gameReceivedAtMs = useGameReceivedAtMs(gameId);
  const synced = useLiveSynced();
  const commands = useLiveCommands();
  const runner = useCommandRunner(describeMoveFailure);
  const boardMarks = useBoardMarks().chosen;
  const navigate = useNavigate();
  // Scope result dismissal to one game.
  const [resultClosed, setResultClosed] = useState<string | null>(null);

  const viewer = session.data ?? null;
  // Ignore snapshots left from the previous session during socket restart.
  const attached = viewer !== null && liveUserId === viewer.id;
  const game = attached ? liveGame : null;
  const status: LiveStatus = attached ? liveStatus : "connecting";

  if (viewer === null) {
    return null;
  }

  const connection = describeConnection(status, reconnectAttempts, "game");

  if (game === null) {
    // Absence is authoritative only after the opening sequence completes.
    return (
      <GameNotShown
        gameId={gameId}
        status={status}
        connection={connection}
        synced={attached && synced}
      />
    );
  }

  const seat = seatOf(game, viewer);

  if (seat === null) {
    return (
      <Missing
        title="You hold no seat in this game"
        detail="Only the two players can open a game. There is no spectator view."
      />
    );
  }

  const showingGains = marksFor(boardMarks, game.rated).squareGains;
  const standing = describeStanding(game, seat);
  const players = playersBySeat(game);
  const pendingSquare = pendingMoveSquare(runner.pending);
  const gate = moveGate(game, seat, connection.canCommand, pendingSquare !== null);
  const showScore =
    game.status === "active" ||
    game.status === "finished" ||
    (game.status === "waiting" && game.timeControl.kind === "timed");
  const showLadder = game.status === "active" || game.status === "finished";

  const play = (square: Square): void => {
    if (!gate.allowed) {
      return;
    }

    runner.run(moveKey(square), () =>
      commands.playMove({ gameId: game.id, expectedRevision: game.revision, square }),
    );
  };

  const withdraw = (): void => {
    // Navigate explicitly because withdrawal removes this game from the store.
    runner.run(
      WITHDRAW_KEY,
      async () => {
        const result = await commands.cancelLobby(game.id);
        if (result.ok) {
          await navigate(LOBBY_PATH);
        }
        return result;
      },
      describeWithdrawalFailure,
    );
  };

  const resign = (): void => {
    // Use the latest snapshot revision after the confirmation step.
    runner.run(
      RESIGN_KEY,
      () => commands.resignGame({ gameId: game.id, expectedRevision: game.revision }),
      describeResignationFailure,
    );
  };

  return (
    <div className={TWO_UP}>
      <div className={STACK}>
        <div>
          <p className={EYEBROW}>Game</p>
          <h1 className={H_XL}>
            {players.playerOne === null ? (
              <span className="text-pen-1-text">an open seat</span>
            ) : (
              <PlayerLink username={players.playerOne.username} className="text-pen-1-text" />
            )}{" "}
            <span className="text-ink-3">vs</span>{" "}
            {players.playerTwo === null ? (
              <span className="text-pen-2-text">an open seat</span>
            ) : (
              <PlayerLink username={players.playerTwo.username} className="text-pen-2-text" />
            )}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={seat === 1 ? "player-1" : "player-2"}>You are Player {seat}</Chip>
            <Chip>{PHASE[game.status]}</Chip>
            <Chip tone={game.rated ? "player-1" : "neutral"}>
              {game.rated ? "Rated" : "Casual"}
            </Chip>
            <Chip>{formatTimeControl(game.timeControl)}</Chip>
          </div>
        </div>

        <StatusNote tone={standing.tone} title={standing.title} detail={standing.detail} />

        {connection.canCommand ? null : (
          <StatusNote
            tone={connection.tone}
            title={connection.title}
            detail={connection.detail}
            live="none"
          />
        )}

        {runner.failure === null ? null : (
          <StatusNote
            tone="alarm"
            title={failureTitle(runner.failureKey)}
            detail={runner.failure}
            live="alert"
          />
        )}

        <section className={CARD} aria-labelledby="board-title">
          <h2 id="board-title" className="sr-only">
            Board
          </h2>
          <Board
            key={game.id}
            game={game}
            seat={seat}
            gate={gate}
            pendingSquare={pendingSquare}
            onPlay={play}
          />
          <p className={HINT}>
            {gate.allowed
              ? showingGains
                ? "Each empty square shows what it would add to your score. Move with the arrow keys, play with Enter."
                : "Move with the arrow keys, play with Enter."
              : gate.reason}
          </p>

          {game.status === "waiting" || game.status === "ready_check" ? null : (
            <div className="mt-4 border-t border-line pt-4">
              <MoveLeadStrip
                moves={game.moves}
                boardFull={game.status === "finished" && game.outcome.reason === "board_full"}
              />
            </div>
          )}
        </section>

        {showLadder ? <ExponentLadder board={game.board} /> : null}
      </div>

      <div className={STACK}>
        {/* A timed lobby already has meaningful configured balances. */}
        {showScore ? (
          <ScoreReadout game={game} seat={seat} receivedAtMs={gameReceivedAtMs} />
        ) : null}
        <MoveHistory moves={game.moves} />

        {game.rated ? null : <BoardMarksControl />}

        <div className="flex flex-wrap items-center gap-3">
          <LinkButton to={LOBBY_PATH} variant="quiet" size="sm">
            Back to the lobby
          </LinkButton>
          {game.status === "waiting" ? (
            <Button
              variant="danger"
              size="sm"
              disabled={!connection.canCommand || runner.pending !== null}
              onClick={withdraw}
            >
              {runner.pending === WITHDRAW_KEY ? "Withdrawing…" : "Withdraw this lobby"}
            </Button>
          ) : null}
          {game.status === "active" ? (
            <ResignControl
              canResign={connection.canCommand && runner.pending === null}
              pending={runner.pending === RESIGN_KEY}
              onResign={resign}
            />
          ) : null}
        </div>
      </div>

      {game.status === "finished" && resultClosed !== game.id ? (
        <GameResultDialog
          game={game}
          seat={seat}
          viewer={viewer}
          onDismiss={() => {
            setResultClosed(game.id);
          }}
        />
      ) : null}
    </div>
  );
}

function failureTitle(key: string | null): string {
  if (key === WITHDRAW_KEY) {
    return "That lobby withdrawal was not confirmed";
  }
  if (key === RESIGN_KEY) {
    return "That resignation was not confirmed";
  }
  return "That move was not confirmed";
}

type GameNotShownProps = {
  gameId: string;
  status: LiveStatus;
  connection: ConnectionDescription;
  synced: boolean;
};

function GameNotShown({ gameId, status, connection, synced }: GameNotShownProps) {
  if (status !== "ready") {
    return (
      <div className="py-8">
        <div className="mx-auto max-w-xl">
          <StatusNote tone={connection.tone} title={connection.title} detail={connection.detail} />
          <p className={`${NOTE} mt-4`}>
            The board is drawn from the server&rsquo;s own snapshot, so it appears once the
            connection does.
          </p>
        </div>
      </div>
    );
  }

  if (!synced) {
    return <PagePending label="Still synchronizing with the game server…" />;
  }

  return <RuledOut gameId={gameId} />;
}

/** Resolves a game omitted from the open-game sync against the finished archive. */
function RuledOut({ gameId }: { gameId: string }) {
  const replay = useGameReplay(gameId);

  if (replay.isPending) {
    return <PagePending label="Checking whether this game has finished…" />;
  }

  if (replay.isSuccess) {
    return <Navigate to={replayPath(gameId)} replace />;
  }

  if (!isNotFound(replay.error)) {
    return (
      <ArchiveFailure
        detail={replay.error.message}
        retrying={replay.isFetching}
        onRetry={() => {
          void replay.refetch();
        }}
      />
    );
  }

  return (
    <Missing
      title="This game is not one of your open games"
      detail="The server has finished sending every waiting, ready-check, and active game you hold a seat in, and this was not among them. If it finished, it would be in your history; if it is not yours, there is nothing here to show."
    />
  );
}

function ArchiveFailure({
  detail,
  retrying,
  onRetry,
}: {
  detail: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="py-12">
      <div className={`${CARD} mx-auto max-w-md`}>
        <h1 className={H_LG}>That game record could not be checked</h1>
        <p className={NOTE}>{detail}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" disabled={retrying} onClick={onRetry}>
            {retrying ? "Trying again…" : "Try again"}
          </Button>
          <LinkButton to={LOBBY_PATH} variant="quiet">
            Back to the lobby
          </LinkButton>
        </div>
      </div>
    </div>
  );
}

function Missing({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="py-12">
      <div className={`${CARD} mx-auto max-w-md`}>
        <h1 className={H_LG}>{title}</h1>
        <p className={NOTE}>{detail}</p>
        <LinkButton to={LOBBY_PATH} variant="primary" className="mt-4">
          Back to the lobby
        </LinkButton>
      </div>
    </div>
  );
}
