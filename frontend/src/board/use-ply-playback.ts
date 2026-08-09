/** Shared single-timer playback for demonstrations and finished-game replays. */

import { useCallback, useEffect, useMemo, useState } from "react";

import type { Square } from "@poe2/rules";

import { useClock, useMotionPreference } from "../runtime/context.ts";
import {
  finalPly as lastPlyOf,
  frameAt,
  replayScript,
  type ReplayFrame,
  type ReplayScript,
} from "./replay-script.ts";

export const PLY_INTERVAL_MS = 220;

export interface PlyPlaybackOptions {
  readonly moves: readonly Square[];
  readonly start: "beginning" | "end";
  readonly autoplay: boolean;
}

export interface PlyPlayback {
  readonly script: ReplayScript;
  readonly frame: ReplayFrame;
  readonly ply: number;
  readonly finalPly: number;
  readonly playing: boolean;
  readonly finished: boolean;
  readonly play: () => void;
  readonly pause: () => void;
  readonly replay: () => void;
  readonly seek: (ply: number) => void;
}

export function usePlyPlayback(options: PlyPlaybackOptions): PlyPlayback {
  const clock = useClock();
  const motion = useMotionPreference();

  const script = useMemo(() => replayScript(options.moves), [options.moves]);
  const last = lastPlyOf(script);

  // Do not restart playback if the media query changes mid-visit.
  const [reducedMotion] = useState(() => motion.prefersReducedMotion());
  const opensAtEnd = options.start === "end" || reducedMotion;

  const [ply, setPly] = useState(() => (opensAtEnd ? last : 0));
  const [playing, setPlaying] = useState(() => options.autoplay && !reducedMotion && !opensAtEnd);

  // Cleanup leaves no timer after pause, completion, or unmount.
  useEffect(() => {
    if (!playing) {
      return;
    }

    if (ply >= last) {
      setPlaying(false);
      return;
    }

    return clock.schedule(() => {
      setPly((current) => Math.min(current + 1, last));
    }, PLY_INTERVAL_MS);
  }, [clock, playing, ply, last]);

  const play = useCallback(() => {
    setPly((current) => (current >= last ? 0 : current));
    setPlaying(true);
  }, [last]);

  const pause = useCallback(() => {
    setPlaying(false);
  }, []);

  const replay = useCallback(() => {
    setPly(0);
    setPlaying(true);
  }, []);

  const seek = useCallback(
    (target: number) => {
      setPlaying(false);
      setPly(Math.min(Math.max(Math.trunc(target), 0), last));
    },
    [last],
  );

  return {
    script,
    frame: frameAt(script, ply),
    ply,
    finalPly: last,
    playing,
    finished: ply === last,
    play,
    pause,
    replay,
    seek,
  };
}
