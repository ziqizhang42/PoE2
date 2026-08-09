import { render, type RenderResult } from "@testing-library/react";

import { App } from "../app/app.tsx";
import { AppProviders } from "../app/providers.tsx";
import type { AppRuntime } from "../runtime/context.ts";

export function renderApp(runtime: AppRuntime, path = "/"): RenderResult {
  window.history.pushState({}, "", path);

  return render(
    <AppProviders runtime={runtime}>
      <App />
    </AppProviders>,
  );
}
