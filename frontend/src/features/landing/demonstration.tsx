import { CELL_COUNT } from "@poe2/rules";

import { LeadLine, ScoreBlobs } from "../../board/score-blobs.tsx";
import { Scrubber } from "../../board/scrubber.tsx";
import { Button } from "../../ui/button.tsx";
import { CARD, EYEBROW } from "../../ui/classes.ts";
import { DemoBoard } from "./demo-board.tsx";
import { useDemoPlayback } from "./use-demo-playback.ts";

/** Playback whose board, scores, and result are all derived from the demo record. */
export function Demonstration() {
  const playback = useDemoPlayback();
  const { frame } = playback;

  const scores = frame.scores;

  return (
    <section className={CARD} aria-labelledby="demo-title">
      <p className={EYEBROW}>A demonstration, not a live game</p>
      <h2 id="demo-title" className="mb-3 font-display text-lg font-semibold tracking-tight">
        One recorded game, scored as it goes
      </h2>

      <DemoBoard frame={frame} />

      <div className="mt-4">
        <Scrubber
          progression={playback.script.progression}
          ply={playback.ply}
          finalPly={playback.finalPly}
          boardFull={false}
          onSeek={playback.seek}
        />
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <ScoreBlobs scores={scores} />
        <LeadLine
          scores={scores}
          finished={playback.finished}
          detail={`move ${String(playback.ply)} of ${String(CELL_COUNT)}`}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {playback.finished ? (
          <Button variant="surface" size="sm" onClick={playback.replay}>
            Watch it again
          </Button>
        ) : playback.playing ? (
          <Button variant="surface" size="sm" onClick={playback.pause}>
            Pause
          </Button>
        ) : (
          <Button variant="surface" size="sm" onClick={playback.play}>
            Play
          </Button>
        )}
      </div>
    </section>
  );
}
