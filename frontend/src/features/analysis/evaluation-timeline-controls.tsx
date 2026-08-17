import { Button } from "../../ui/button.tsx";

export type EvaluationTimelineMode = "score" | "engine";

export function EvaluationTimelineControls({
  mode,
  onModeChange,
}: {
  readonly mode: EvaluationTimelineMode;
  readonly onModeChange: (mode: EvaluationTimelineMode) => void;
}) {
  return (
    <div role="group" aria-label="Timeline measure" className="flex items-center gap-1">
      <Button
        size="sm"
        variant={mode === "score" ? "surface" : "quiet"}
        aria-pressed={mode === "score"}
        onClick={() => {
          onModeChange("score");
        }}
      >
        Board score
      </Button>
      <Button
        size="sm"
        variant={mode === "engine" ? "surface" : "quiet"}
        aria-pressed={mode === "engine"}
        onClick={() => {
          onModeChange("engine");
        }}
      >
        Engine evaluation
      </Button>
    </div>
  );
}
