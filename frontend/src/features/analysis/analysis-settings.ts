export type CandidateCount = 1 | 2 | 3 | 4 | 5;
export type AnalysisTimePreset = "fast" | "balanced" | "deep";

export interface PositionAnalysisSettings {
  readonly candidateCount: CandidateCount;
  readonly timePreset: AnalysisTimePreset;
}

export interface AnalysisTimeChoice {
  readonly id: AnalysisTimePreset;
  readonly label: string;
  readonly detail: string;
  readonly durationLabel: string;
  readonly searchTimeMs: number;
}

export const ANALYSIS_TIME_CHOICES: readonly AnalysisTimeChoice[] = [
  {
    id: "fast",
    label: "Fast",
    detail: "1 second",
    durationLabel: "1s",
    searchTimeMs: 1_000,
  },
  {
    id: "balanced",
    label: "Balanced",
    detail: "5 seconds",
    durationLabel: "5s",
    searchTimeMs: 5_000,
  },
  {
    id: "deep",
    label: "Deep",
    detail: "20 seconds",
    durationLabel: "20s",
    searchTimeMs: 20_000,
  },
];

export const DEFAULT_POSITION_ANALYSIS_SETTINGS: PositionAnalysisSettings = {
  candidateCount: 1,
  timePreset: "fast",
};

export function searchTimeMs(settings: PositionAnalysisSettings): number {
  return analysisTimeChoice(settings.timePreset).searchTimeMs;
}

export function analysisTimeChoice(preset: AnalysisTimePreset): AnalysisTimeChoice {
  return ANALYSIS_TIME_CHOICES.find((choice) => choice.id === preset) ?? ANALYSIS_TIME_CHOICES[0]!;
}

export function isCandidateCount(value: number): value is CandidateCount {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}
