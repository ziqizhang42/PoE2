import { createContext, useContext } from "react";

import type { Theme } from "./theme.ts";

export interface ThemeControl {
  readonly theme: Theme;
  /** `null` until the reader chooses; the system is followed until then. */
  readonly chosen: Theme | null;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

export const ThemeContext = createContext<ThemeControl | null>(null);

export function useTheme(): ThemeControl {
  const control = useContext(ThemeContext);

  if (control === null) {
    throw new Error("ThemeProvider must enclose any component that reads the theme");
  }

  return control;
}
