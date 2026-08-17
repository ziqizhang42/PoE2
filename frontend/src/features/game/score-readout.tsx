import type { GameSnapshot } from "@poe2/protocol";
import type { Player } from "@poe2/rules";

import { ScorePanel } from "../../board/score-panel.tsx";
import { PlayerLink } from "../../players/player-link.tsx";
import { HINT } from "../../ui/classes.ts";
import { formatClock, formatTimeControl } from "../time-control.ts";
import { playersBySeat } from "./game-state.ts";
import { useGameClock } from "./use-game-clock.ts";

type ScoreReadoutProps = {
  game: GameSnapshot;
  seat: Player;
  receivedAtMs?: number | null;
};

/** Live score panel with clocks anchored to snapshot receipt time. */
export function ScoreReadout({ game, ...props }: ScoreReadoutProps) {
  // A route-parameter change reuses the outer component; key the stateful clock
  // reader so announcements and interpolation never cross game boundaries.
  return <ScoreReadoutForGame key={game.id} game={game} {...props} />;
}

function ScoreReadoutForGame({ game, seat, receivedAtMs = null }: ScoreReadoutProps) {
  const clock = useGameClock(game, receivedAtMs);
  const timed = game.timeControl.kind !== "untimed";
  const players = playersBySeat(game);

  return (
    <ScorePanel
      titleId="margin-title"
      scores={game.scores}
      nameOne={
        players.playerOne === null ? null : <PlayerLink username={players.playerOne.username} />
      }
      nameTwo={
        players.playerTwo === null ? null : <PlayerLink username={players.playerTwo.username} />
      }
      viewerSeat={seat}
      running={clock.running}
      // Untimed games still have a side to move.
      thinking={game.status === "active" ? game.sideToMove : null}
      {...(timed
        ? { clockOne: formatClock(clock.playerOne), clockTwo: formatClock(clock.playerTwo) }
        : {})}
    >
      {timed ? <p className={HINT}>{formatTimeControl(game.timeControl)}</p> : null}
      {/* Keep ticking balances out of the live region. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {clock.announcement}
      </p>
    </ScorePanel>
  );
}
