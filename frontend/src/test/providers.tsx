import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { RuntimeContext, type AppRuntime } from "../runtime/context.ts";

type TestProvidersProps = {
  children: ReactNode;
  runtime: AppRuntime;
};

/** The provider stack without `RuntimeBootstrap`, so hooks can be tested alone. */
export function TestProviders({ children, runtime }: TestProvidersProps) {
  return (
    <QueryClientProvider client={runtime.queryClient}>
      <RuntimeContext value={runtime}>{children}</RuntimeContext>
    </QueryClientProvider>
  );
}
