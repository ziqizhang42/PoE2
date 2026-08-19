import { createContext, useContext } from "react";

import type { EngineSettings } from "./analysis-settings.ts";

export interface EngineSettingsControl {
  readonly settings: EngineSettings;
  readonly saveSettings: (settings: EngineSettings) => void;
}

export const EngineSettingsContext = createContext<EngineSettingsControl | null>(null);

export function useEngineSettings(): EngineSettingsControl {
  const control = useContext(EngineSettingsContext);

  if (control === null) {
    throw new Error("EngineSettingsProvider must enclose any component that reads engine settings");
  }

  return control;
}
