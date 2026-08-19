import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { BrowserRouter } from "react-router";

import { RuntimeContext, type AppRuntime } from "../runtime/context.ts";
import { createAppRuntime } from "../runtime/create-runtime.ts";
import { RuntimeBootstrap } from "../runtime/runtime-bootstrap.tsx";
import { EngineSettingsProvider } from "../features/analysis/engine-settings-provider.tsx";
import { BoardMarksProvider } from "../features/board-marks/board-marks-provider.tsx";
import { ThemeProvider } from "../theme/theme-provider.tsx";

type AppProvidersProps = {
  children: ReactNode;
  runtime?: AppRuntime;
};

export function AppProviders({ children, runtime }: AppProvidersProps) {
  const [ownRuntime] = useState(createAppRuntime);
  const active = runtime ?? ownRuntime;

  return (
    <BrowserRouter>
      <QueryClientProvider client={active.queryClient}>
        <RuntimeContext value={active}>
          <ThemeProvider>
            <EngineSettingsProvider>
              <BoardMarksProvider>
                <RuntimeBootstrap />
                {children}
              </BoardMarksProvider>
            </EngineSettingsProvider>
          </ThemeProvider>
        </RuntimeContext>
      </QueryClientProvider>
    </BrowserRouter>
  );
}
