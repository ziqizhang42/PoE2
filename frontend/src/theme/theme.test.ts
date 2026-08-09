import { describe, expect, it } from "vitest";

import {
  browserSystemTheme,
  browserThemeStorage,
  isTheme,
  otherTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
  type KeyValueStore,
} from "./theme.ts";

function memoryStore(): KeyValueStore & { readonly entries: Map<string, string> } {
  const entries = new Map<string, string>();

  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

describe("theme", () => {
  it("accepts only the two themes", () => {
    expect(isTheme("light")).toBe(true);
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("sepia")).toBe(false);
    expect(isTheme(null)).toBe(false);
  });

  it("follows the system until the reader has chosen", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("toggles between the two", () => {
    expect(otherTheme("light")).toBe("dark");
    expect(otherTheme("dark")).toBe("light");
  });

  it("round-trips a choice through storage and ignores anything else", () => {
    const store = memoryStore();
    const storage = browserThemeStorage(store);

    expect(storage.read()).toBeNull();

    storage.write("dark");
    expect(store.entries.get(THEME_STORAGE_KEY)).toBe("dark");
    expect(storage.read()).toBe("dark");

    store.entries.set(THEME_STORAGE_KEY, "neon");
    expect(storage.read()).toBeNull();
  });

  it("degrades to no persistence when storage is unavailable", () => {
    const storage = browserThemeStorage(null);

    expect(storage.read()).toBeNull();
    expect(() => {
      storage.write("dark");
    }).not.toThrow();
    expect(storage.read()).toBeNull();
  });

  it("degrades to the light theme when the media query is unavailable", () => {
    const system = browserSystemTheme();

    expect(system.prefersDark()).toBe(false);
    expect(() => system.subscribe(() => {})()).not.toThrow();
  });
});
