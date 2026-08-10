import type { LobbyEntry } from "@poe2/protocol";
import { PLAYER_ONE } from "@poe2/rules";

import { Button } from "../../ui/button.tsx";
import { PlayerLink } from "../../players/player-link.tsx";
import { CARD, CARD_TITLE, HINT, NOTE, TABLE, TABLE_SCROLL, TD, TH } from "../../ui/classes.ts";
import { joinKey } from "./command-keys.ts";
import { formatOpenedAt } from "./games.ts";
import { formatTimeControl } from "../time-control.ts";

type OpenLobbiesPanelProps = {
  lobbies: readonly LobbyEntry[];
  now: number;
  canCommand: boolean;
  pending: string | null;
  onJoin: (gameId: string) => void;
};

export function OpenLobbiesPanel({
  lobbies,
  now,
  canCommand,
  pending,
  onJoin,
}: OpenLobbiesPanelProps) {
  return (
    <section className={CARD} aria-labelledby="open-lobbies-title">
      <h2 id="open-lobbies-title" className={CARD_TITLE}>
        Open rooms <span className="num">{lobbies.length} open</span>
      </h2>

      {lobbies.length === 0 ? (
        <p className={NOTE}>
          Nobody else is waiting. Create a game and its open seat will appear here for everyone.
        </p>
      ) : (
        <div className={TABLE_SCROLL}>
          <table className={TABLE}>
            <caption className="sr-only">Lobbies waiting for a second player</caption>
            <thead>
              <tr>
                <th scope="col" className={`${TH} pl-2.5`}>
                  Player
                </th>
                <th scope="col" className={TH}>
                  Your seat
                </th>
                <th scope="col" className={TH}>
                  Stakes
                </th>
                <th scope="col" className={TH}>
                  Clock
                </th>
                <th scope="col" className={TH}>
                  Opened
                </th>
                <th className={`${TH} pr-2.5 text-right`}>
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lobbies.map((lobby) => {
                const key = joinKey(lobby.id);
                return (
                  <tr key={lobby.id}>
                    <td className={`${TD} pl-2.5`}>
                      <PlayerLink username={lobby.owner.username} />
                    </td>
                    <td className={`${TD} whitespace-nowrap text-ink-3`}>
                      {lobby.creatorSeat === PLAYER_ONE ? "Player 2" : "Player 1"}
                    </td>
                    <td className={TD}>
                      {lobby.rated ? (
                        <span className="font-medium text-pen-1-text">Rated</span>
                      ) : (
                        <span className="text-ink-3">Casual</span>
                      )}
                    </td>
                    <td className={`${TD} whitespace-nowrap text-ink-3`}>
                      {formatTimeControl(lobby.timeControl)}
                    </td>
                    <td className={`${TD} num text-ink-3`}>
                      <time dateTime={lobby.createdAt}>{formatOpenedAt(lobby.createdAt, now)}</time>
                    </td>
                    <td className={`${TD} pr-2.5 text-right`}>
                      <Button
                        size="sm"
                        disabled={!canCommand || pending !== null}
                        onClick={() => {
                          onJoin(lobby.id);
                        }}
                      >
                        {pending === key ? "Joining…" : "Join"}
                      </Button>
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
