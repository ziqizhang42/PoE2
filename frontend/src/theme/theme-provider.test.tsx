import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  createFakeSystemTheme,
  createMemoryThemeStorage,
  type FakeSystemTheme,
} from "../test/fakes.ts";
import type { ThemeStorage } from "./theme.ts";
import { ThemeProvider } from "./theme-provider.tsx";
import { ThemeToggle } from "./theme-toggle.tsx";

function renderTheme(storage: ThemeStorage, system: FakeSystemTheme) {
  const root = document.createElement("html");

  render(
    <ThemeProvider storage={storage} system={system} root={root}>
      <ThemeToggle />
    </ThemeProvider>,
  );

  return root;
}

describe("ThemeProvider", () => {
  it("follows the system on a first visit", () => {
    const root = renderTheme(createMemoryThemeStorage(), createFakeSystemTheme(true));

    expect(root.dataset["theme"]).toBe("dark");
    expect(screen.getByRole("switch", { name: "Dark theme" })).toBeChecked();
  });

  it("prefers a stored choice over the system", () => {
    const root = renderTheme(createMemoryThemeStorage("light"), createFakeSystemTheme(true));

    expect(root.dataset["theme"]).toBe("light");
    expect(screen.getByRole("switch", { name: "Dark theme" })).not.toBeChecked();
  });

  it("tracks system changes only while the reader has not chosen", async () => {
    const user = userEvent.setup();
    const storage = createMemoryThemeStorage();
    const system = createFakeSystemTheme(false);
    const root = renderTheme(storage, system);

    act(() => {
      system.emit(true);
    });
    expect(root.dataset["theme"]).toBe("dark");

    await user.click(screen.getByRole("switch", { name: "Dark theme" }));
    expect(root.dataset["theme"]).toBe("light");
    expect(storage.read()).toBe("light");

    act(() => {
      system.emit(true);
    });
    expect(root.dataset["theme"]).toBe("light");
  });
});
