import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

const INITIAL_TITLE = document.title;

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
  delete document.documentElement.dataset["theme"];
  document.title = INITIAL_TITLE;
});
