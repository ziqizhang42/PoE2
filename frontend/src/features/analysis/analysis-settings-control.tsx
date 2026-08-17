import { useId } from "react";

import { Button } from "../../ui/button.tsx";
import {
  ANALYSIS_TIME_CHOICES,
  isCandidateCount,
  type PositionAnalysisSettings,
} from "./analysis-settings.ts";

export function AnalysisSettingsControl({
  settings,
  disabled = false,
  onChange,
}: {
  readonly settings: PositionAnalysisSettings;
  readonly disabled?: boolean;
  readonly onChange: (settings: PositionAnalysisSettings) => void;
}) {
  const candidateId = useId();

  return (
    <fieldset className="border-0 p-0">
      <legend className="sr-only">Position analysis settings</legend>
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <label htmlFor={candidateId} className="grid gap-1.5 text-xs font-medium text-ink-2">
          Candidate lines
          <select
            id={candidateId}
            value={settings.candidateCount}
            disabled={disabled}
            onChange={(event) => {
              const candidateCount = Number(event.target.value);
              if (isCandidateCount(candidateCount)) {
                onChange({ ...settings, candidateCount });
              }
            }}
            className="rounded-sm border border-line bg-sunken px-2.5 py-2 text-xs text-ink disabled:opacity-55"
          >
            {[1, 2, 3, 4, 5].map((count) => (
              <option key={count} value={count}>
                {count} {count === 1 ? "line" : "lines"}
              </option>
            ))}
          </select>
        </label>

        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-2">Time per position</p>
          <div role="group" aria-label="Analysis time" className="flex flex-wrap gap-1">
            {ANALYSIS_TIME_CHOICES.map((choice) => (
              <Button
                key={choice.id}
                size="sm"
                variant={settings.timePreset === choice.id ? "surface" : "quiet"}
                disabled={disabled}
                aria-pressed={settings.timePreset === choice.id}
                title={`${choice.label}: ${choice.detail} per position`}
                onClick={() => {
                  onChange({ ...settings, timePreset: choice.id });
                }}
              >
                {choice.label} · {choice.durationLabel}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </fieldset>
  );
}
