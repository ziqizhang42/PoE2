import { useId, type ReactNode } from "react";

import { CARD } from "../../ui/classes.ts";
import { AnalysisSettingsControl } from "./analysis-settings-control.tsx";
import { analysisTimeChoice, type PositionAnalysisSettings } from "./analysis-settings.ts";

export interface EngineAnalysisCardControls {
  readonly settings: PositionAnalysisSettings;
  readonly settingsDisabled: boolean;
  readonly settingsOpen: boolean;
  readonly settingsNote?: ReactNode;
  readonly toggle: ReactNode;
  readonly actions?: ReactNode;
  readonly status?: ReactNode;
  readonly onSettingsChange: (settings: PositionAnalysisSettings) => void;
  readonly onSettingsOpenChange: (open: boolean) => void;
}

/** Shared Engine card, including its heading toggle, actions, and settings. */
export function EngineAnalysisCard({
  titleId,
  controls,
  children,
}: {
  readonly titleId: string;
  readonly controls?: EngineAnalysisCardControls | undefined;
  readonly children: ReactNode;
}) {
  const settingsId = useId();

  return (
    <section className={CARD} aria-labelledby={titleId}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 font-display text-sm font-semibold text-ink">
        <div className="flex items-center gap-2">
          <h2 id={titleId}>Engine</h2>
          {controls?.toggle}
        </div>
        {controls === undefined ? null : (
          <div className="flex flex-wrap items-center justify-end gap-2 font-sans font-normal">
            {controls.actions ?? null}
            <span className="hidden text-xs text-ink-3 sm:inline">
              {settingsSummary(controls.settings)}
            </span>
            <button
              type="button"
              aria-label="Engine settings"
              aria-expanded={controls.settingsOpen}
              aria-controls={settingsId}
              title={`Engine settings: ${settingsSummary(controls.settings)}`}
              onClick={() => {
                controls.onSettingsOpenChange(!controls.settingsOpen);
              }}
              className={`flex size-8 cursor-pointer items-center justify-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pen-1 ${
                controls.settingsOpen
                  ? "selected-control border-pen-1"
                  : "border-line bg-transparent text-ink-2 hover:bg-sunken hover:text-ink"
              }`}
            >
              <SettingsIcon />
            </button>
          </div>
        )}
      </div>

      {controls?.settingsOpen === true ? (
        <div id={settingsId} className="mb-4 rounded-md border border-line bg-sunken p-3">
          <AnalysisSettingsControl
            settings={controls.settings}
            disabled={controls.settingsDisabled}
            onChange={controls.onSettingsChange}
          />
          {controls.settingsNote === undefined ? null : (
            <p className="mt-2 text-xs leading-relaxed text-ink-3">{controls.settingsNote}</p>
          )}
        </div>
      ) : null}

      {controls?.status}
      {children}
    </section>
  );
}

function settingsSummary(settings: PositionAnalysisSettings): string {
  const preset = analysisTimeChoice(settings.timePreset);
  return `${preset.label} · ${preset.durationLabel} · ${String(settings.candidateCount)} ${
    settings.candidateCount === 1 ? "line" : "lines"
  }`;
}

function SettingsIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className="size-4"
    >
      <path d="M4 7h8m4 0h4M4 17h4m4 0h8M4 12h2m4 0h10" />
      <circle cx="14" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
      <circle cx="8" cy="12" r="2" />
    </svg>
  );
}
