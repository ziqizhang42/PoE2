import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import type { GameSnapshot, LobbyEntry } from "@poe2/protocol";
import { PLAYER_ONE, PLAYER_TWO, type Player } from "@poe2/rules";

import { LOBBY_TITLE, useDocumentTitle } from "../../app/document-title.ts";
import { gamePath } from "../../app/routes.ts";
import { useSession } from "../../auth/queries.ts";
import {
  useGames,
  useLastLiveRejection,
  useLiveCommands,
  useLiveStatus,
  useLiveSynced,
  useLiveUserId,
  useLobbies,
  useReconnectAttempts,
} from "../../live/hooks.ts";
import { PagePending } from "../../shell/page-pending.tsx";
import { PlayerLink } from "../../players/player-link.tsx";
import { useClock } from "../../runtime/context.ts";
import { Button } from "../../ui/button.tsx";
import { CARD, CARD_TITLE, EYEBROW, H_XL, HINT, NOTE, STACK, TWO_UP } from "../../ui/classes.ts";
import { Modal } from "../../ui/modal.tsx";
import { CHIP_GROUP, ToggleChip } from "../../ui/toggle-chip.tsx";
import { StatusNote } from "../../ui/status-note.tsx";
import { describeConnection } from "../connection.ts";
import { useCommandRunner } from "../use-command-runner.ts";
import { describeCommandFailure } from "./command-failure.ts";
import { CREATE_KEY, joinKey } from "./command-keys.ts";
import { OpenLobbiesPanel } from "./open-lobbies-panel.tsx";
import { PlayerDirectoryCard } from "./player-directory-card.tsx";
import { TimeControlFieldset } from "./time-control-field.tsx";
import {
  DEFAULT_TIME_CONTROL_FIELDS,
  parseTimeControl,
  type TimeControlField,
  type TimeControlFields,
} from "./time-control-form.ts";

const NO_LOBBIES: readonly LobbyEntry[] = [];
const NO_GAMES: readonly GameSnapshot[] = [];
const LOBBY_AGE_REFRESH_MS = 60_000;

const STAKE_CHOICES: readonly { readonly label: string; readonly rated: boolean }[] = [
  { label: "Casual", rated: false },
  { label: "Rated", rated: true },
];

const SEAT_CHOICES: readonly { readonly label: string; readonly seat: Player }[] = [
  { label: "Player 1", seat: PLAYER_ONE },
  { label: "Player 2", seat: PLAYER_TWO },
];

const RATED_NEEDS_CLOCK = "Rated games need a clock, so this one now starts at 5 + 3.";
const UNTIMED_IS_CASUAL = "A game with no clock cannot be rated, so this one is casual.";

export function LobbyPage() {
  useDocumentTitle(LOBBY_TITLE);
  const [newGameOpen, setNewGameOpen] = useState(false);
  const [rated, setRated] = useState(false);
  const [seat, setSeat] = useState<Player>(PLAYER_ONE);
  const [timeFields, setTimeFields] = useState<TimeControlFields>(DEFAULT_TIME_CONTROL_FIELDS);
  const [timeError, setTimeError] = useState<{
    field: TimeControlField;
    message: string;
  } | null>(null);
  const [coupling, setCoupling] = useState<string | null>(null);
  const session = useSession();
  const liveStatus = useLiveStatus();
  const liveSynced = useLiveSynced();
  const liveUserId = useLiveUserId();
  const reconnectAttempts = useReconnectAttempts();
  const liveLobbies = useLobbies();
  const liveGames = useGames();
  const liveRejection = useLastLiveRejection();
  const commands = useLiveCommands();
  const runner = useCommandRunner(describeCommandFailure);
  const navigate = useNavigate();
  const now = useRelativeNow();
  /** Existing ids distinguish the pushed create result regardless of frame order. */
  const [awaitingCreate, setAwaitingCreate] = useState<ReadonlySet<string> | null>(null);

  const viewerId = session.data?.id ?? null;

  useEffect(() => {
    if (awaitingCreate === null || viewerId === null) {
      return;
    }

    const opened = liveGames.find(
      (game) =>
        game.status === "waiting" &&
        game.players.playerOne.id === viewerId &&
        !awaitingCreate.has(game.id),
    );

    if (opened === undefined) {
      return;
    }

    setAwaitingCreate(null);
    void navigate(gamePath(opened.id));
  }, [awaitingCreate, liveGames, navigate, viewerId]);

  const viewer = session.data;

  if (viewer === undefined || viewer === null) {
    return null;
  }

  // Do not expose snapshots left from the previous session during socket restart.
  const attached = liveUserId === viewer.id;
  const synced = attached && liveSynced;

  const status = attached ? liveStatus : "connecting";
  const lobbies = synced ? liveLobbies : NO_LOBBIES;
  const games = synced ? liveGames : NO_GAMES;
  const rejection = attached ? liveRejection : null;

  const connection = describeConnection(status, reconnectAttempts);
  const joinable = lobbies.filter((lobby) => lobby.owner.id !== viewer.id);
  const busy = runner.pending !== null;

  const chooseStake = (nextRated: boolean): void => {
    setRated(nextRated);
    if (nextRated && timeFields.untimed) {
      setTimeFields({ ...DEFAULT_TIME_CONTROL_FIELDS, untimed: false });
      setCoupling(RATED_NEEDS_CLOCK);
      return;
    }
    setCoupling(null);
  };

  const chooseTimeControl = (fields: TimeControlFields): void => {
    setTimeFields(fields);
    setTimeError(null);
    if (fields.untimed && rated) {
      setRated(false);
      setCoupling(UNTIMED_IS_CASUAL);
      return;
    }
    setCoupling(null);
  };

  const openLobby = (): void => {
    const parsed = parseTimeControl(timeFields);
    if (!parsed.ok) {
      setTimeError({ field: parsed.field, message: parsed.message });
      document.getElementById(`time-${parsed.field}`)?.focus();
      return;
    }

    setTimeError(null);
    const known = new Set(games.map((game) => game.id));

    runner.run(CREATE_KEY, async () => {
      const result = await commands.createLobby(rated, parsed.control, seat);
      if (result.ok || result.failure === "connection_lost" || result.failure === "timed_out") {
        setAwaitingCreate(known);
      }
      if (result.ok) {
        setNewGameOpen(false);
      }
      return result;
    });
  };

  return (
    <div className={TWO_UP}>
      <div className={STACK}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className={EYEBROW}>Lobby</p>
            <h1 className={H_XL}>Open a seat, or take one</h1>
            <p className={NOTE}>
              A room is one open seat. It stays up until another player takes it or you withdraw it.
            </p>
          </div>
          <Button
            variant="primary"
            disabled={!connection.canCommand || busy}
            onClick={() => {
              setNewGameOpen(true);
            }}
          >
            New game
          </Button>
        </div>

        {connection.canCommand ? null : (
          <StatusNote tone={connection.tone} title={connection.title} detail={connection.detail} />
        )}

        {runner.failure === null || newGameOpen ? null : (
          <StatusNote
            tone="alarm"
            title="That command was not confirmed"
            detail={runner.failure}
            live="alert"
          />
        )}

        {rejection === null ? null : (
          <StatusNote
            tone="alarm"
            title="The server refused something this page could not match to a request"
            detail={rejection.message}
            live="alert"
          />
        )}

        {newGameOpen ? (
          <Modal
            labelledBy="new-game-title"
            panelClassName="max-w-xl"
            {...(busy
              ? {}
              : {
                  onDismiss: () => {
                    setNewGameOpen(false);
                    setTimeError(null);
                    setCoupling(null);
                  },
                })}
          >
            <h2 id="new-game-title" className="font-display text-xl font-medium tracking-tight">
              New game
            </h2>
            <p className={`${NOTE} mt-2`}>
              Choose your seat, stakes, and clock. The other seat will appear in the open rooms.
            </p>

            <fieldset className="mt-5 border-0 p-0">
              <legend className="mb-2 text-sm font-medium text-ink">Which seat do you take?</legend>
              <div className={CHIP_GROUP}>
                {SEAT_CHOICES.map((choice) => (
                  <ToggleChip
                    key={choice.label}
                    type="radio"
                    name="lobby-seat"
                    label={choice.label}
                    checked={seat === choice.seat}
                    disabled={busy}
                    onChange={() => {
                      setSeat(choice.seat);
                    }}
                  />
                ))}
              </div>
              <p className={HINT}>
                {seat === PLAYER_ONE
                  ? "You move first; whoever joins plays second with a 5½-point head start."
                  : "You move second and start 5½ points ahead; whoever joins moves first."}
              </p>
            </fieldset>

            <fieldset className="mt-5 border-0 p-0">
              <legend className="mb-2 text-sm font-medium text-ink">Does this one count?</legend>
              <div className={CHIP_GROUP}>
                {STAKE_CHOICES.map((choice) => (
                  <ToggleChip
                    key={choice.label}
                    type="radio"
                    name="lobby-stakes"
                    label={choice.label}
                    checked={rated === choice.rated}
                    disabled={busy}
                    onChange={() => {
                      chooseStake(choice.rated);
                    }}
                  />
                ))}
              </div>
              <p className={HINT}>
                {rated
                  ? "Both ratings move once this game is decided, however it is decided."
                  : "Neither rating moves, whatever happens."}
              </p>
            </fieldset>

            <TimeControlFieldset
              fields={timeFields}
              error={timeError}
              disabled={busy}
              onChange={chooseTimeControl}
            />

            {coupling === null ? null : (
              <p className={HINT} role="status">
                {coupling}
              </p>
            )}

            {runner.failure === null ? null : (
              <div className="mt-4">
                <StatusNote
                  tone="alarm"
                  title="That game could not be created"
                  detail={runner.failure}
                  live="alert"
                />
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                disabled={!connection.canCommand || busy}
                onClick={openLobby}
              >
                {runner.pending === CREATE_KEY ? "Creating…" : "Create game"}
              </Button>
              <Button
                variant="quiet"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setNewGameOpen(false);
                  setTimeError(null);
                  setCoupling(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </Modal>
        ) : null}

        {synced ? (
          <OpenLobbiesPanel
            lobbies={joinable}
            now={now}
            canCommand={connection.canCommand}
            pending={runner.pending}
            onJoin={(gameId) => {
              runner.run(joinKey(gameId), async () => {
                const result = await commands.joinLobby(gameId);
                // Navigate on acceptance so the joiner cannot miss the expiring ready check.
                if (result.ok) {
                  await navigate(gamePath(gameId));
                }
                return result;
              });
            }}
          />
        ) : (
          // Never present a partial opening sequence as the complete lobby.
          <PagePending label="Fetching open rooms…" />
        )}
      </div>

      <div className={STACK}>
        <section className={CARD} aria-labelledby="viewer-title">
          <h2 id="viewer-title" className={CARD_TITLE}>
            You
          </h2>
          <p className="num text-xl font-medium break-all">
            <PlayerLink username={viewer.username} />
          </p>
        </section>
        <PlayerDirectoryCard statusesReady={synced} />
      </div>
    </div>
  );
}

function useRelativeNow(): number {
  const clock = useClock();
  const [origin] = useState(() => ({ wallMs: Date.now(), monotonicMs: clock.now() }));
  const [now, setNow] = useState(origin.wallMs);

  useEffect(() => {
    let cancel = () => {};
    const schedule = (): void => {
      cancel = clock.schedule(() => {
        setNow(origin.wallMs + (clock.now() - origin.monotonicMs));
        schedule();
      }, LOBBY_AGE_REFRESH_MS);
    };

    schedule();
    return () => {
      cancel();
    };
  }, [clock, origin]);

  return now;
}
