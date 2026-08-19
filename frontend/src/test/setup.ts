import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { ENGINE_SETTINGS_STORAGE_KEY } from "../features/analysis/analysis-settings.ts";

const INITIAL_TITLE = document.title;

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
  delete document.documentElement.dataset["theme"];
  window.localStorage?.removeItem(ENGINE_SETTINGS_STORAGE_KEY);
  document.title = INITIAL_TITLE;
});
