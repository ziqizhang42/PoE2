import { usePlyPlayback, type PlyPlayback } from "../../board/use-ply-playback.ts";
import { DEMO_MOVES } from "./demo-record.ts";

export { PLY_INTERVAL_MS } from "../../board/use-ply-playback.ts";

export type DemoPlayback = PlyPlayback;

/** Autoplays the demo unless reduced motion requests a static final frame. */
export function useDemoPlayback(): DemoPlayback {
  return usePlyPlayback({ moves: DEMO_MOVES, start: "beginning", autoplay: true });
}
