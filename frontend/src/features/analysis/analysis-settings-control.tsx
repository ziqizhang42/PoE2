import { useId, useState, type CSSProperties } from "react";

import { Button } from "../../ui/button.tsx";
import { Modal } from "../../ui/modal.tsx";
import {
  ANALYSIS_TIME_CHOICES,
  analysisTimeAt,
  analysisTimeIndex,
  CANDIDATE_COUNTS,
  formatAnalysisTime,
  isCandidateCount,
  MAX_ANALYSIS_TIME_MS,
  type AnalysisTimeMs,
  type EngineSettings,
} from "./analysis-settings.ts";

export function AnalysisSettingsDialog({
  dialogId,
  settings,
  onSave,
  onDismiss,
}: {
  readonly dialogId?: string;
  readonly settings: EngineSettings;
  readonly onSave: (settings: EngineSettings) => void;
  readonly onDismiss: () => void;
}) {
  const titleId = useId();
  const candidateId = useId();
  const candidateDescriptionId = useId();
  const [draft, setDraft] = useState(settings);

  return (
    <Modal
      labelledBy={titleId}
      width="medium"
      panelClassName="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      onDismiss={onDismiss}
      {...(dialogId === undefined ? {} : { panelId: dialogId })}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draft);
        }}
      >
        <p className="mb-1 text-xs font-medium tracking-wide text-pen-2-text uppercase">
          Browser engine
        </p>
        <h2 id={titleId} className="font-display text-xl font-medium tracking-tight text-ink">
          Engine settings
        </h2>

        <div className="mt-6 grid gap-3">
          <section className="flex items-center justify-between gap-4 rounded-md border border-line bg-sunken px-4 py-4 sm:px-5">
            <div>
              <label htmlFor={candidateId} className="font-display text-sm font-semibold text-ink">
                Candidate lines
              </label>
              <p id={candidateDescriptionId} className="mt-1 text-xs leading-relaxed text-ink-3">
                Number of engine-ranked moves shown for the current position.
              </p>
            </div>
            <select
              id={candidateId}
              value={draft.candidateCount}
              aria-describedby={candidateDescriptionId}
              onChange={(event) => {
                const candidateCount = Number(event.currentTarget.value);
                if (isCandidateCount(candidateCount)) {
                  setDraft({ ...draft, candidateCount });
                }
              }}
              className="shrink-0 rounded-sm border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink"
            >
              {CANDIDATE_COUNTS.map((count) => (
                <option key={count} value={count}>
                  {count} {count === 1 ? "line" : "lines"}
                </option>
              ))}
            </select>
          </section>
          <AnalysisTimeSlider
            label="Live analysis time"
            value={draft.liveAnalysisTimeMs}
            onChange={(liveAnalysisTimeMs) => {
              setDraft({ ...draft, liveAnalysisTimeMs });
            }}
          />
          <AnalysisTimeSlider
            label="Game analysis time per move"
            value={draft.gameAnalysisTimeMs}
            perMove
            onChange={(gameAnalysisTimeMs) => {
              setDraft({ ...draft, gameAnalysisTimeMs });
            }}
          />
        </div>

        <div className="mt-6 flex items-center justify-end gap-2 border-t border-line pt-4">
          <Button variant="quiet" onClick={onDismiss}>
            Cancel
          </Button>
          <Button variant="primary" type="submit">
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function AnalysisTimeSlider({
  label,
  value,
  perMove = false,
  onChange,
}: {
  readonly label: string;
  readonly value: AnalysisTimeMs;
  readonly perMove?: boolean;
  readonly onChange: (value: AnalysisTimeMs) => void;
}) {
  const inputId = useId();
  const index = analysisTimeIndex(value);
  const maximum = ANALYSIS_TIME_CHOICES.length - 1;
  const visibleTime =
    value === MAX_ANALYSIS_TIME_MS ? formatAnalysisTime(value) : formatAnalysisTime(value, "short");
  const visibleValue = `${visibleTime}${perMove ? " / move" : ""}`;
  const accessibleValue = `${formatAnalysisTime(value)}${perMove ? " per move" : ""}`;
  const sliderStyle = {
    "--slider-position": `${String((index / maximum) * 100)}%`,
  } as CSSProperties;

  return (
    <section className="rounded-md border border-line bg-sunken px-4 py-4 sm:px-5">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={inputId} className="font-display text-sm font-semibold text-ink">
          {label}
        </label>
        <output
          htmlFor={inputId}
          className="num shrink-0 rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-ink"
        >
          {visibleValue}
        </output>
      </div>
      <input
        id={inputId}
        type="range"
        min={0}
        max={maximum}
        step={1}
        value={index}
        aria-valuetext={accessibleValue}
        style={sliderStyle}
        onChange={(event) => {
          onChange(analysisTimeAt(event.currentTarget.valueAsNumber));
        }}
        className="engine-time-slider mt-4 w-full"
      />
      <div aria-hidden="true" className="mt-2 flex justify-between text-xs text-ink-3">
        <span>1 sec</span>
        <span>{perMove ? "12 hours / move" : "12 hours"}</span>
      </div>
    </section>
  );
}
