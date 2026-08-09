import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { ThemeContext, type ThemeControl } from "./theme-context.ts";
import {
  browserSystemTheme,
  browserThemeStorage,
  otherTheme,
  resolveTheme,
  type SystemTheme,
  type Theme,
  type ThemeStorage,
} from "./theme.ts";

type ThemeProviderProps = {
  children: ReactNode;
  storage?: ThemeStorage;
  system?: SystemTheme;
  root?: HTMLElement;
};

export function ThemeProvider({ children, storage, system, root }: ThemeProviderProps) {
  const [themeStorage] = useState(() => storage ?? browserThemeStorage());
  const [systemTheme] = useState(() => system ?? browserSystemTheme());

  const [chosen, setChosen] = useState<Theme | null>(() => themeStorage.read());
  const [prefersDark, setPrefersDark] = useState(() => systemTheme.prefersDark());

  const theme = resolveTheme(chosen, prefersDark);

  useEffect(() => systemTheme.subscribe(setPrefersDark), [systemTheme]);

  useEffect(() => {
    (root ?? document.documentElement).dataset["theme"] = theme;
  }, [root, theme]);

  const setTheme = useCallback(
    (next: Theme) => {
      themeStorage.write(next);
      setChosen(next);
    },
    [themeStorage],
  );

  const value = useMemo<ThemeControl>(
    () => ({ theme, chosen, setTheme, toggle: () => setTheme(otherTheme(theme)) }),
    [chosen, setTheme, theme],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}
