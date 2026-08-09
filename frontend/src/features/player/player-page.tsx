import { useParams } from "react-router";

import { PLAYER_TITLE, useDocumentTitle } from "../../app/document-title.ts";
import { GameHistoryList } from "../../players/game-history-list.tsx";
import { usePlayerGames, usePlayerProfile } from "../../players/queries.ts";
import { RatingChart } from "../../players/rating-chart.tsx";
import { isPlayerNotFound, PlayerRequestError } from "../../players/errors.ts";
import { PagePending } from "../../shell/page-pending.tsx";
import { Button } from "../../ui/button.tsx";
import { ASIDE_UP, CARD, CARD_TITLE, EYEBROW, H_XL, NOTE, STACK } from "../../ui/classes.ts";
import { StatusNote } from "../../ui/status-note.tsx";

export function PlayerPage() {
  useDocumentTitle(PLAYER_TITLE);
  const username = useParams()["username"] ?? "";
  const profile = usePlayerProfile(username);
  const games = usePlayerGames(username);

  if (profile.isPending) {
    return <PagePending label="Fetching the player profile…" />;
  }

  if (profile.isError) {
    const missing = isPlayerNotFound(profile.error);
    const protocol =
      profile.error instanceof PlayerRequestError && profile.error.kind === "protocol";
    const network = profile.error instanceof PlayerRequestError && profile.error.kind === "network";
    return (
      <div className="py-12">
        <div className="mx-auto max-w-md">
          <StatusNote
            tone="alarm"
            title={
              missing
                ? "No such player"
                : protocol
                  ? "That profile could not be read"
                  : network
                    ? "The profile server could not be reached"
                    : "That profile could not be fetched"
            }
            detail={missing ? "No public account matches that username." : profile.error.message}
            live="alert"
          />
          {missing ? null : (
            <Button
              variant="primary"
              className="mt-4"
              onClick={() => {
                void profile.refetch();
              }}
            >
              Try again
            </Button>
          )}
        </div>
      </div>
    );
  }

  const player = profile.data;
  const statistics = player.statistics;
  const ratedWinrate =
    statistics.ratedGames > 0
      ? Math.round((statistics.ratedWins / statistics.ratedGames) * 100)
      : null;

  return (
    <div className={ASIDE_UP}>
      <div className={STACK}>
        <div>
          <p className={EYEBROW}>Player</p>
          <h1 className={`${H_XL} break-all`}>{player.username}</h1>
          <p className={NOTE}>
            Joined <time dateTime={player.createdAt}>{formatAccountDate(player.createdAt)}</time>
          </p>
        </div>

        <RatingChart
          value={player.rating.value}
          history={player.ratingHistory}
          percentile={player.rating.percentile}
          deviation={player.rating.deviation}
        >
          <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-5 gap-y-2 border-t border-line pt-4 text-sm">
            <Stat label="Games" value={statistics.totalFinishedGames} />
            <Stat label="Wins" value={statistics.wins} />
            <Stat label="Losses" value={statistics.losses} />
            <Stat label="Rated" value={statistics.ratedGames} />
            <Stat label="Casual" value={statistics.casualGames} />
            {ratedWinrate === null ? null : (
              <Stat label="Rated winrate" value={`${String(ratedWinrate)}%`} />
            )}
          </dl>
        </RatingChart>

        <section className={CARD} aria-labelledby="public-record-title">
          <h2 id="public-record-title" className={CARD_TITLE}>
            How games ended
          </h2>
          <dl className="grid grid-cols-[1fr_auto] gap-x-5 gap-y-2 text-sm">
            <Stat label="Board full" value={statistics.boardFullGames} />
            <Stat label="Resignation" value={statistics.resignationGames} />
            <Stat label="Timeout" value={statistics.timeoutGames} />
          </dl>
        </section>
      </div>

      <GameHistoryList
        username={player.username}
        total={statistics.totalFinishedGames}
        games={games}
      />
    </div>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: number | string }) {
  return (
    <>
      <dt className="text-ink-3">{label}</dt>
      <dd className={`m-0 text-right ${typeof value === "number" ? "num" : ""}`}>{value}</dd>
    </>
  );
}

function formatAccountDate(createdAt: string): string {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime())
    ? "an unknown date"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(date);
}
