import { useEffect, useState } from "react";

import { READY_CHECK_MS, type ReadyCheckGameSnapshot } from "@poe2/protocol";
import type { Player } from "@poe2/rules";

import { useClock, useMotionPreference } from "../../runtime/context.ts";
import { Button } from "../../ui/button.tsx";
import { HINT, NOTE } from "../../ui/classes.ts";
import { Modal } from "../../ui/modal.tsx";

const NORMAL_TICK_MS = 250;
const REDUCED_MOTION_TICK_MS = 1_000;

type ReadyCheckPanelProps = {
  game: ReadyCheckGameSnapshot;
  seat: Player;
  receivedAtMs: number | null;
  canCommand: boolean;
  confirming: boolean;
  leaving: boolean;
  failure: string | null;
  onReady: () => void;
  onDecline: () => void;
};

/**
 * Non-dismissible ready prompt. Its visual countdown is anchored at snapshot
 * receipt; only server state decides whether the check expired.
 */
export function ReadyCheckPanel({
  game,
  seat,
  receivedAtMs,
  canCommand,
  confirming,
  leaving,
  failure,
  onReady,
  onDecline,
}: ReadyCheckPanelProps) {
  const clock = useClock();
  const reducedMotion = useMotionPreference().prefersReducedMotion();
  const check = game.readyCheck;
  const [anchor, setAnchor] = useState(() => receivedAtMs ?? clock.now());
  const [visualNow, setVisualNow] = useState(() => clock.now());

  useEffect(() => {
    setAnchor(receivedAtMs ?? clock.now());
    setVisualNow(clock.now());
  }, [check.deadline, check.serverNow, clock, game.id, receivedAtMs]);

  useEffect(() => {
    let cancel = () => {};
    const schedule = (): void => {
      cancel = clock.schedule(
        () => {
          setVisualNow(clock.now());
          schedule();
        },
        reducedMotion ? REDUCED_MOTION_TICK_MS : NORMAL_TICK_MS,
      );
    };

    schedule();
    return () => {
      cancel();
    };
  }, [clock, reducedMotion]);

  const serverRemainingMs = Math.max(0, Date.parse(check.deadline) - Date.parse(check.serverNow));
  const remainingMs = Math.max(0, serverRemainingMs - (visualNow - anchor));
  const seconds = Math.ceil(remainingMs / 1_000);
  // Confirmation snapshots must not reset the progress scale.
  const left = Math.min(1, Math.max(0, remainingMs / READY_CHECK_MS));

  const you = seat === 1 ? check.playerOneReady : check.playerTwoReady;
  const them = seat === 1 ? check.playerTwoReady : check.playerOneReady;
  const opponent = seat === 1 ? game.players.playerTwo : game.players.playerOne;

  return (
    <Modal labelledBy="ready-check-title">
      <p className="text-xs font-medium tracking-wide text-pen-2-text uppercase">Ready check</p>
      <h2 id="ready-check-title" className="mt-1 font-display text-xl font-medium tracking-tight">
        Ready to play?
      </h2>
      <p className={`${NOTE} mt-2`}>
        <span className="font-medium text-ink">{opponent.username}</span> has taken the other seat.
        The board opens, and any clock with it, once you have both confirmed.
      </p>

      <div
        className="mt-4 h-1.5 overflow-hidden rounded-full bg-sunken"
        role="presentation"
        aria-hidden="true"
      >
        <div
          className="h-full rounded-full bg-pen-2 transition-[width] duration-200 ease-linear"
          style={{ width: `${String((left * 100).toFixed(1))}%` }}
        />
      </div>
      <p className={`${HINT} mt-2`}>
        <span className="num">{seconds}</span> second{seconds === 1 ? "" : "s"} left. If it runs out
        the seat is given back and the lobby opens again — nobody loses a game, because there is not
        one yet.
      </p>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-line pt-4 text-sm">
        <dt className="text-ink-3">You</dt>
        <dd className="m-0">{you ? "Ready" : "Not confirmed yet"}</dd>
        <dt className="text-ink-3 break-all">{opponent.username}</dt>
        <dd className="m-0">{them ? "Ready" : "Not confirmed yet"}</dd>
      </dl>

      {failure === null ? null : (
        <p className="mt-4 text-sm leading-relaxed text-pen-2-text" role="alert">
          {failure}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={!canCommand || you} onClick={onReady}>
          {confirming ? "Confirming…" : you ? "You are ready" : "I'm ready"}
        </Button>
        <Button variant="quiet" size="sm" disabled={!canCommand} onClick={onDecline}>
          {leaving ? "Leaving…" : "Leave"}
        </Button>
      </div>
    </Modal>
  );
}
