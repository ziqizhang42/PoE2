/** Visual interpolation between authoritative clock snapshots; never decides timeout. */
import { useEffect, useRef, useState } from "react";

import type { GameSnapshot } from "@poe2/protocol";
import type { Player } from "@poe2/rules";

import { useClock, useMotionPreference } from "../../runtime/context.ts";

const NORMAL_TICK_MS = 250;
const REDUCED_MOTION_TICK_MS = 1_000;
const LOW_TIME_MS = 30_000;

interface Anchor {
  readonly receivedAtMs: number;
  readonly playerOne: number;
  readonly playerTwo: number;
  readonly runningPlayer: Player | null;
}

export function useGameClock(
  game: GameSnapshot,
  receivedAtMs: number | null = null,
): GameClockReading {
  const clock = useClock();
  const reducedMotion = useMotionPreference().prefersReducedMotion();
  const [anchor, setAnchor] = useState<Anchor>(() => anchorFor(game, receivedAtMs ?? clock.now()));
  const [visualNow, setVisualNow] = useState(() => clock.now());
  const [announcement, setAnnouncement] = useState("");
  const previousRunning = useRef<Player | null>(null);
  const lowAnnounced = useRef(new Set<Player>());
  const timeoutAnnounced = useRef(false);

  const active = game.status === "active" && game.clock !== null;
  const snapshotMarker =
    game.status === "active" && game.clock !== null
      ? game.clock.serverNow
      : game.status === "finished" && game.clock !== null
        ? game.clock.stoppedAt
        : `${game.status}:${String(game.revision)}`;

  useEffect(() => {
    const nextReceivedAtMs = receivedAtMs ?? clock.now();
    setAnchor(anchorFor(game, nextReceivedAtMs));
    setVisualNow(clock.now());
  }, [clock, game, receivedAtMs, snapshotMarker]);

  useEffect(() => {
    if (!active) {
      return undefined;
    }

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
  }, [active, clock, reducedMotion, snapshotMarker]);

  const shown = interpolate(anchor, visualNow);

  useEffect(() => {
    const running = active ? anchor.runningPlayer : null;
    if (
      running !== null &&
      previousRunning.current !== null &&
      running !== previousRunning.current
    ) {
      setAnnouncement(`Player ${String(running)} clock is now running.`);
    }
    previousRunning.current = running;
  }, [active, anchor.runningPlayer]);

  useEffect(() => {
    if (!active) {
      return;
    }
    const newlyLow: Player[] = [];
    for (const [player, remaining] of [
      [1, shown.playerOne],
      [2, shown.playerTwo],
    ] as const) {
      if (remaining <= LOW_TIME_MS && !lowAnnounced.current.has(player)) {
        lowAnnounced.current.add(player);
        newlyLow.push(player);
      }
    }
    if (newlyLow.length > 0) {
      // One live-region update exposes every simultaneous crossing.
      setAnnouncement(
        newlyLow
          .map((player) => `Player ${String(player)} has 30 seconds or less remaining.`)
          .join(" "),
      );
    }
  }, [active, shown.playerOne, shown.playerTwo]);

  useEffect(() => {
    const timedOut = game.status === "finished" && game.outcome.reason === "timeout";
    if (timedOut && !timeoutAnnounced.current) {
      timeoutAnnounced.current = true;
      setAnnouncement(`Player ${String(game.outcome.winner)} won on time.`);
    }
  }, [game]);

  return {
    playerOne: shown.playerOne,
    playerTwo: shown.playerTwo,
    running: active ? anchor.runningPlayer : null,
    announcement,
  };
}

export interface GameClockReading {
  readonly playerOne: number;
  readonly playerTwo: number;
  readonly running: Player | null;
  readonly announcement: string;
}

function anchorFor(game: GameSnapshot, receivedAtMs: number): Anchor {
  if (game.timeControl.kind === "untimed") {
    return { receivedAtMs, playerOne: 0, playerTwo: 0, runningPlayer: null };
  }
  if (game.status === "waiting") {
    return {
      receivedAtMs,
      playerOne: game.timeControl.initialMs,
      playerTwo: game.timeControl.initialMs,
      runningPlayer: null,
    };
  }
  if (game.clock === null) {
    return { receivedAtMs, playerOne: 0, playerTwo: 0, runningPlayer: null };
  }
  return {
    receivedAtMs,
    playerOne: game.clock.remainingMs.playerOne,
    playerTwo: game.clock.remainingMs.playerTwo,
    runningPlayer: game.status === "active" ? game.clock.runningPlayer : null,
  };
}

function interpolate(anchor: Anchor, nowMs: number) {
  const elapsed = Math.max(0, nowMs - anchor.receivedAtMs);
  return {
    playerOne: Math.max(0, anchor.playerOne - (anchor.runningPlayer === 1 ? elapsed : 0)),
    playerTwo: Math.max(0, anchor.playerTwo - (anchor.runningPlayer === 2 ? elapsed : 0)),
  };
}
