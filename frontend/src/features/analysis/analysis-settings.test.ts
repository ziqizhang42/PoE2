import { describe, expect, it } from "vitest";

import type { KeyValueStore } from "../../theme/theme.ts";
import {
  analysisTimeAt,
  analysisTimeIndex,
  browserEngineSettingsStorage,
  ENGINE_SETTINGS_STORAGE_KEY,
  MAX_ANALYSIS_TIME_MS,
  positionAnalysisSettings,
} from "./analysis-settings.ts";

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & {
  readonly entries: Map<string, string>;
} {
  const entries = new Map(Object.entries(initial));
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

describe("engine settings", () => {
  it("round-trips every time choice through its slider index", () => {
    for (let index = 0; index <= analysisTimeIndex(MAX_ANALYSIS_TIME_MS); index += 1) {
      expect(analysisTimeIndex(analysisTimeAt(index))).toBe(index);
    }
    expect(positionAnalysisSettings(20_000, 5)).toEqual({
      candidateCount: 5,
      searchTimeMs: 20_000,
    });
  });

  it("persists valid settings and ignores malformed or unsupported values", () => {
    const store = memoryStore();
    const storage = browserEngineSettingsStorage(store);
    const settings = {
      candidateCount: 5,
      liveAnalysisTimeMs: MAX_ANALYSIS_TIME_MS,
      gameAnalysisTimeMs: 20_000,
    } as const;

    storage.write(settings);

    expect(storage.read()).toEqual(settings);
    expect(store.entries.get(ENGINE_SETTINGS_STORAGE_KEY)).toBe(
      '{"candidateCount":5,"liveAnalysisTimeMs":43200000,"gameAnalysisTimeMs":20000}',
    );

    store.entries.set(
      ENGINE_SETTINGS_STORAGE_KEY,
      '{"liveAnalysisTimeMs":5000,"gameAnalysisTimeMs":20000}',
    );
    expect(storage.read()).toEqual({
      candidateCount: 1,
      liveAnalysisTimeMs: 5_000,
      gameAnalysisTimeMs: 20_000,
    });

    store.entries.set(
      ENGINE_SETTINGS_STORAGE_KEY,
      '{"candidateCount":6,"liveAnalysisTimeMs":5000,"gameAnalysisTimeMs":20000}',
    );
    expect(storage.read()).toBeNull();
  });

  it("degrades safely when storage is unavailable or corrupt", () => {
    expect(
      browserEngineSettingsStorage(memoryStore({ [ENGINE_SETTINGS_STORAGE_KEY]: "{" })).read(),
    ).toBeNull();
    const unavailable = browserEngineSettingsStorage(null);
    expect(unavailable.read()).toBeNull();
    expect(() => {
      unavailable.write({
        candidateCount: 1,
        liveAnalysisTimeMs: 1_000,
        gameAnalysisTimeMs: 1_000,
      });
    }).not.toThrow();
  });
});
