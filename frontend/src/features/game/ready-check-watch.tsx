/** Shell-level ready check so an expiring prompt reaches players on any route. */

import type { AuthUser, GameSnapshot, ReadyCheckGameSnapshot } from "@poe2/protocol";

import { useSession } from "../../auth/queries.ts";
import {
  useGames,
  useGameReceivedAtMs,
  useLiveCommands,
  useLiveStatus,
  useLiveUserId,
  useReconnectAttempts,
} from "../../live/hooks.ts";
import { describeConnection } from "../connection.ts";
import { useCommandRunner } from "../use-command-runner.ts";
import {
  describeMoveFailure,
  describeReadyConfirmationFailure,
  describeReadyDepartureFailure,
} from "./move-failure.ts";
import { seatOf } from "./game-state.ts";
import { ReadyCheckPanel } from "./ready-check-panel.tsx";

const READY_KEY = "ready";
const DECLINE_KEY = "decline";

export function ReadyCheckWatch() {
  const session = useSession();
  const status = useLiveStatus();
  const liveUserId = useLiveUserId();
  const reconnectAttempts = useReconnectAttempts();
  const games = useGames();
  const commands = useLiveCommands();
  const runner = useCommandRunner(describeMoveFailure);

  const viewer = session.data ?? null;
  // Ignore snapshots left from the previous session during socket restart.
  const attached = viewer !== null && liveUserId === viewer.id;
  const check = attached && viewer !== null ? soonest(games, viewer) : null;
  const receivedAtMs = useGameReceivedAtMs(check?.id ?? null);

  if (check === null || viewer === null) {
    return null;
  }

  const seat = seatOf(check, viewer);
  if (seat === null) {
    return null;
  }

  const connection = describeConnection(status, reconnectAttempts, "game");

  return (
    <ReadyCheckPanel
      game={check}
      seat={seat}
      receivedAtMs={receivedAtMs}
      canCommand={connection.canCommand && runner.pending === null}
      confirming={runner.pending === READY_KEY}
      leaving={runner.pending === DECLINE_KEY}
      failure={runner.failure}
      onReady={() => {
        runner.run(
          READY_KEY,
          () =>
            commands.readyGame({
              gameId: check.id,
              readyCheckGeneration: check.readyCheck.generation,
            }),
          describeReadyConfirmationFailure,
        );
      }}
      onDecline={() => {
        runner.run(
          DECLINE_KEY,
          () =>
            commands.declineGame({
              gameId: check.id,
              readyCheckGeneration: check.readyCheck.generation,
            }),
          describeReadyDepartureFailure,
        );
      }}
    />
  );
}

/** Selects the earliest unconfirmed check to minimize expiry risk. */
function soonest(games: readonly GameSnapshot[], viewer: AuthUser): ReadyCheckGameSnapshot | null {
  const checks = games.filter((game): game is ReadyCheckGameSnapshot => {
    if (game.status !== "ready_check") {
      return false;
    }

    const seat = seatOf(game, viewer);
    return seat === 1
      ? !game.readyCheck.playerOneReady
      : seat === 2
        ? !game.readyCheck.playerTwoReady
        : false;
  });

  return checks.reduce<ReadyCheckGameSnapshot | null>(
    (earliest, game) =>
      earliest === null ||
      Date.parse(game.readyCheck.deadline) < Date.parse(earliest.readyCheck.deadline)
        ? game
        : earliest,
    null,
  );
}
