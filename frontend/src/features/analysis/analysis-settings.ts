import { localKeyValueStore, type KeyValueStore } from "../../theme/theme.ts";

/** Multi-PV choices supported by the installed engine contract. */
export const CANDIDATE_COUNTS = [1, 2, 3, 4, 5] as const;
export type CandidateCount = (typeof CANDIDATE_COUNTS)[number];

/** Friendly, non-linear stops keep both short and very long searches practical. */
export const ANALYSIS_TIME_CHOICES = [
  { timeMs: 1_000, label: "1 second", shortLabel: "1 sec" },
  { timeMs: 2_000, label: "2 seconds", shortLabel: "2 sec" },
  { timeMs: 5_000, label: "5 seconds", shortLabel: "5 sec" },
  { timeMs: 10_000, label: "10 seconds", shortLabel: "10 sec" },
  { timeMs: 20_000, label: "20 seconds", shortLabel: "20 sec" },
  { timeMs: 30_000, label: "30 seconds", shortLabel: "30 sec" },
  { timeMs: 60_000, label: "1 minute", shortLabel: "1 min" },
  { timeMs: 120_000, label: "2 minutes", shortLabel: "2 min" },
  { timeMs: 300_000, label: "5 minutes", shortLabel: "5 min" },
  { timeMs: 600_000, label: "10 minutes", shortLabel: "10 min" },
  { timeMs: 1_800_000, label: "30 minutes", shortLabel: "30 min" },
  { timeMs: 3_600_000, label: "1 hour", shortLabel: "1 hr" },
  { timeMs: 7_200_000, label: "2 hours", shortLabel: "2 hr" },
  { timeMs: 14_400_000, label: "4 hours", shortLabel: "4 hr" },
  { timeMs: 28_800_000, label: "8 hours", shortLabel: "8 hr" },
  { timeMs: 43_200_000, label: "12 hours", shortLabel: "12 hr" },
] as const;

export type AnalysisTimeMs = (typeof ANALYSIS_TIME_CHOICES)[number]["timeMs"];

export const MAX_ANALYSIS_TIME_MS: AnalysisTimeMs = 43_200_000;

export interface EngineSettings {
  readonly candidateCount: CandidateCount;
  readonly liveAnalysisTimeMs: AnalysisTimeMs;
  readonly gameAnalysisTimeMs: AnalysisTimeMs;
}

/** Request settings at the engine boundary. */
export interface PositionAnalysisSettings {
  readonly candidateCount: CandidateCount;
  readonly searchTimeMs: AnalysisTimeMs;
}

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  candidateCount: 1,
  liveAnalysisTimeMs: 1_000,
  gameAnalysisTimeMs: 1_000,
};

export const DEFAULT_POSITION_ANALYSIS_SETTINGS: PositionAnalysisSettings = {
  candidateCount: 1,
  searchTimeMs: DEFAULT_ENGINE_SETTINGS.liveAnalysisTimeMs,
};

export const ENGINE_SETTINGS_STORAGE_KEY = "poe2-engine-settings";

export interface EngineSettingsStorage {
  read(): EngineSettings | null;
  write(settings: EngineSettings): void;
}

export function positionAnalysisSettings(
  searchTimeMs: AnalysisTimeMs,
  candidateCount: CandidateCount = 1,
): PositionAnalysisSettings {
  return { candidateCount, searchTimeMs };
}

export function analysisTimeIndex(timeMs: AnalysisTimeMs): number {
  return ANALYSIS_TIME_CHOICES.findIndex((choice) => choice.timeMs === timeMs);
}

export function analysisTimeAt(index: number): AnalysisTimeMs {
  const bounded = Math.max(0, Math.min(ANALYSIS_TIME_CHOICES.length - 1, Math.round(index)));
  return ANALYSIS_TIME_CHOICES[bounded]!.timeMs;
}

export function formatAnalysisTime(
  timeMs: AnalysisTimeMs,
  style: "long" | "short" = "long",
): string {
  const choice =
    ANALYSIS_TIME_CHOICES.find((candidate) => candidate.timeMs === timeMs) ??
    ANALYSIS_TIME_CHOICES[0];
  return style === "short" ? choice.shortLabel : choice.label;
}

export function isAnalysisTimeMs(value: unknown): value is AnalysisTimeMs {
  return ANALYSIS_TIME_CHOICES.some((choice) => choice.timeMs === value);
}

export function isCandidateCount(value: unknown): value is CandidateCount {
  return CANDIDATE_COUNTS.some((candidate) => candidate === value);
}

function readEngineSettings(value: unknown): EngineSettings | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Partial<EngineSettings>;
  const candidateCount = candidate.candidateCount === undefined ? 1 : candidate.candidateCount;
  if (
    !isCandidateCount(candidateCount) ||
    !isAnalysisTimeMs(candidate.liveAnalysisTimeMs) ||
    !isAnalysisTimeMs(candidate.gameAnalysisTimeMs)
  ) {
    return null;
  }
  return {
    candidateCount,
    liveAnalysisTimeMs: candidate.liveAnalysisTimeMs,
    gameAnalysisTimeMs: candidate.gameAnalysisTimeMs,
  };
}

export function browserEngineSettingsStorage(
  store: KeyValueStore | null = localKeyValueStore(),
): EngineSettingsStorage {
  return {
    read() {
      if (store === null) {
        return null;
      }

      try {
        const raw = store.getItem(ENGINE_SETTINGS_STORAGE_KEY);
        if (raw === null) {
          return null;
        }
        const parsed: unknown = JSON.parse(raw);
        return readEngineSettings(parsed);
      } catch {
        return null;
      }
    },
    write(settings) {
      if (store === null) {
        return;
      }

      try {
        store.setItem(ENGINE_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
      } catch {}
    },
  };
}
