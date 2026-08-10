import { useState } from "react";

import type { PlayerActivity, PlayerStatus } from "@poe2/protocol";

import { usePlayerStatuses } from "../../live/hooks.ts";
import { PlayerLink } from "../../players/player-link.tsx";
import { usePlayerDirectory } from "../../players/queries.ts";
import { ratingColor } from "../../players/rating-tier.ts";
import { Button } from "../../ui/button.tsx";
import { CARD, CARD_TITLE, NOTE, TABLE, TABLE_SCROLL, TD, TH } from "../../ui/classes.ts";
import { CHIP_GROUP, ToggleChip } from "../../ui/toggle-chip.tsx";

type DirectoryView = "online" | "overall";

const VIEWS: readonly { readonly value: DirectoryView; readonly label: string }[] = [
  { value: "online", label: "Online" },
  { value: "overall", label: "Overall" },
];

const ACTIVITY: Readonly<
  Record<PlayerActivity | "none", { readonly symbol: string; readonly label: string }>
> = {
  open_room: { symbol: "◇", label: "Open room" },
  in_game: { symbol: "●", label: "In game" },
  none: { symbol: "·", label: "No current activity" },
};

export function PlayerDirectoryCard({ statusesReady }: { readonly statusesReady: boolean }) {
  const [view, setView] = useState<DirectoryView>("online");
  const directory = usePlayerDirectory();
  const statuses = usePlayerStatuses();
  const statusById = new Map(statuses.map((status) => [status.id, status]));
  const players =
    directory.data?.filter(
      (player) => view === "overall" || statusById.get(player.id)?.online === true,
    ) ?? [];
  const pending = directory.isPending || (view === "online" && !statusesReady);

  return (
    <section className={CARD} aria-labelledby="players-title">
      <div className={`${CARD_TITLE} flex-wrap`}>
        <h2 id="players-title">Players</h2>
        <fieldset className="border-0 p-0">
          <legend className="sr-only">Players shown</legend>
          <div className={CHIP_GROUP}>
            {VIEWS.map((choice) => (
              <ToggleChip
                key={choice.value}
                type="radio"
                name="player-directory-view"
                label={choice.label}
                checked={view === choice.value}
                onChange={() => {
                  setView(choice.value);
                }}
              />
            ))}
          </div>
        </fieldset>
      </div>

      {pending ? (
        <p className={NOTE} role="status">
          Fetching players…
        </p>
      ) : directory.isError ? (
        <div role="alert">
          <p className={NOTE}>The player list could not be loaded.</p>
          <Button
            variant="quiet"
            size="sm"
            className="mt-3"
            disabled={directory.isFetching}
            onClick={() => {
              void directory.refetch();
            }}
          >
            {directory.isFetching ? "Retrying…" : "Retry"}
          </Button>
        </div>
      ) : players.length === 0 ? (
        <p className={NOTE}>{view === "online" ? "Nobody is online." : "No players yet."}</p>
      ) : (
        <div className={TABLE_SCROLL}>
          <table className={TABLE}>
            <caption className="sr-only">
              {view === "online" ? "Online players" : "All players"}, by rating
            </caption>
            <thead>
              <tr>
                <th className={TH} scope="col">
                  <span className="sr-only">Activity</span>
                </th>
                <th className={TH} scope="col">
                  Player
                </th>
                <th className={`${TH} pr-0 text-right`} scope="col">
                  Rating
                </th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => {
                const status = statusById.get(player.id);
                return (
                  <tr key={player.id}>
                    <td className={`${TD} w-7`}>
                      <ActivitySymbol status={status} />
                    </td>
                    <td className={`${TD} max-w-0`}>
                      <PlayerLink
                        username={player.username}
                        className="block truncate font-medium"
                        style={{ color: ratingColor(player.colorPercentile) ?? undefined }}
                      />
                    </td>
                    <td className={`${TD} num pr-0 text-right font-medium`}>{player.rating}</td>
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

function ActivitySymbol({ status }: { readonly status: PlayerStatus | undefined }) {
  const activity = ACTIVITY[status?.activity ?? "none"];

  return (
    <span role="img" aria-label={activity.label} title={activity.label} className="text-ink-2">
      {activity.symbol}
    </span>
  );
}
