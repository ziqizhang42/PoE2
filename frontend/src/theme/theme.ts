export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "poe2-theme";

export interface ThemeStorage {
  read(): Theme | null;
  write(theme: Theme): void;
}

export interface SystemTheme {
  prefersDark(): boolean;
  subscribe(listener: (prefersDark: boolean) => void): () => void;
}

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

export function resolveTheme(chosen: Theme | null, prefersDark: boolean): Theme {
  return chosen ?? (prefersDark ? "dark" : "light");
}

export function otherTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

export type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

/** Returns null when storage is unavailable or blocked. */
export function localKeyValueStore(): KeyValueStore | null {
  try {
    const store: KeyValueStore | undefined = globalThis.localStorage;
    return store ?? null;
  } catch {
    return null;
  }
}

export function browserThemeStorage(
  store: KeyValueStore | null = localKeyValueStore(),
): ThemeStorage {
  return {
    read() {
      if (store === null) {
        return null;
      }

      try {
        const value = store.getItem(THEME_STORAGE_KEY);
        return isTheme(value) ? value : null;
      } catch {
        return null;
      }
    },
    write(theme) {
      if (store === null) {
        return;
      }

      try {
        store.setItem(THEME_STORAGE_KEY, theme);
      } catch {}
    },
  };
}

export function browserSystemTheme(): SystemTheme {
  const query =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;

  if (query === null) {
    return { prefersDark: () => false, subscribe: () => () => {} };
  }

  return {
    prefersDark: () => query.matches,
    subscribe(listener) {
      const handle = (event: MediaQueryListEvent): void => {
        listener(event.matches);
      };
      query.addEventListener("change", handle);
      return () => {
        query.removeEventListener("change", handle);
      };
    },
  };
}
