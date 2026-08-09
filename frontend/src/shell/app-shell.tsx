import { Suspense } from "react";
import { Outlet } from "react-router";

import { ReadyCheckWatch } from "../features/game/ready-check-watch.tsx";
import { SHELL } from "../ui/classes.ts";
import { PagePending } from "./page-pending.tsx";
import { PrefetchRoutes } from "./prefetch-routes.tsx";
import { SigningOutProvider } from "./signing-out-provider.tsx";
import { TopBar } from "./top-bar.tsx";

/** Keeps application chrome mounted while a lazy route loads. */
export function AppShell() {
  return (
    <SigningOutProvider>
      <div className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only rounded-full bg-surface px-4 py-2 text-sm font-semibold shadow-lift focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-40"
        >
          Skip to content
        </a>
        <TopBar />
        <PrefetchRoutes />
        <main id="main" className={`${SHELL} flex-1`}>
          <Suspense fallback={<PagePending label="Loading this screen…" />}>
            <Outlet />
          </Suspense>
        </main>
        <ReadyCheckWatch />
        <footer className={`${SHELL} pt-8`}>
          <div className="flex flex-wrap gap-6 border-t border-line py-6 text-xs text-ink-3">
            <span>Powers of Exponent 2</span>
          </div>
        </footer>
      </div>
    </SigningOutProvider>
  );
}
