import { useCallback, useMemo, useState, type ReactNode } from "react";

import {
  browserEngineSettingsStorage,
  DEFAULT_ENGINE_SETTINGS,
  type EngineSettings,
  type EngineSettingsStorage,
} from "./analysis-settings.ts";
import { EngineSettingsContext, type EngineSettingsControl } from "./engine-settings-context.ts";

export function EngineSettingsProvider({
  children,
  storage,
}: {
  readonly children: ReactNode;
  readonly storage?: EngineSettingsStorage;
}) {
  const [settingsStorage] = useState(() => storage ?? browserEngineSettingsStorage());
  const [settings, setSettings] = useState<EngineSettings>(
    () => settingsStorage.read() ?? DEFAULT_ENGINE_SETTINGS,
  );

  const saveSettings = useCallback(
    (next: EngineSettings) => {
      settingsStorage.write(next);
      setSettings(next);
    },
    [settingsStorage],
  );

  const value = useMemo<EngineSettingsControl>(
    () => ({ settings, saveSettings }),
    [saveSettings, settings],
  );

  return <EngineSettingsContext value={value}>{children}</EngineSettingsContext>;
}
