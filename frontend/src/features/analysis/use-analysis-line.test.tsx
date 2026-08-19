import { act, renderHook } from "@testing-library/react";
import { useMemo, useState, type ReactNode } from "react";
import {
  NavigationType,
  Router,
  parsePath,
  type Location,
  type Navigator,
  type To,
} from "react-router";
import { describe, expect, it } from "vitest";

import { allSquares } from "@poe2/rules";

import type { AnalysisLine } from "./analysis-line.ts";
import { analysisPath } from "./analysis-url.ts";
import { useAnalysisLine } from "./use-analysis-line.ts";

interface DelayedRoute {
  readonly location: Location;
  readonly navigationType: NavigationType;
}

function totalPly(line: AnalysisLine): number {
  return line.game.moves.length + line.future.length;
}

function routeLocation(to: To, state: unknown): Location {
  const path = typeof to === "string" ? parsePath(to) : to;

  return {
    pathname: path.pathname ?? "/analysis",
    search: path.search ?? "",
    hash: path.hash ?? "",
    state,
    key: crypto.randomUUID(),
  };
}

function delayedRouter(initialPath: string): {
  readonly Wrapper: ({ children }: { children: ReactNode }) => ReactNode;
  readonly routeUpdates: Array<() => void>;
} {
  const routeUpdates: Array<() => void> = [];

  function Wrapper({ children }: { children: ReactNode }): ReactNode {
    const [route, setRoute] = useState<DelayedRoute>(() => ({
      location: routeLocation(initialPath, null),
      navigationType: NavigationType.Pop,
    }));
    const navigator = useMemo<Navigator>(
      () => ({
        createHref: (to) =>
          typeof to === "string" ? to : `${to.pathname ?? ""}${to.search ?? ""}${to.hash ?? ""}`,
        encodeLocation: (to) => {
          const path = typeof to === "string" ? parsePath(to) : to;
          return {
            pathname: path.pathname ?? "",
            search: path.search ?? "",
            hash: path.hash ?? "",
          };
        },
        go: () => undefined,
        push: (to, state) => {
          routeUpdates.push(() => {
            setRoute({
              location: routeLocation(to, state),
              navigationType: NavigationType.Push,
            });
          });
        },
        replace: (to, state) => {
          routeUpdates.push(() => {
            setRoute({
              location: routeLocation(to, state),
              navigationType: NavigationType.Replace,
            });
          });
        },
      }),
      [],
    );

    return (
      <Router location={route.location} navigationType={route.navigationType} navigator={navigator}>
        {children}
      </Router>
    );
  }

  return { Wrapper, routeUpdates };
}

describe("useAnalysisLine", () => {
  it("does not discard future moves when older scrub URLs arrive late", () => {
    const moves = allSquares().slice(0, 30);
    const { Wrapper, routeUpdates } = delayedRouter(analysisPath(moves));
    const { result } = renderHook(() => useAnalysisLine(), { wrapper: Wrapper });

    act(() => result.current.seek(23));
    act(() => result.current.seek(30));
    expect(routeUpdates).toHaveLength(2);

    act(() => routeUpdates[0]?.());
    expect(totalPly(result.current.line)).toBe(30);

    // This is the next native range event. Before the fix, the stale route above
    // lowered the range maximum to 23, so this event was clamped and queued 23.
    const nextPly = Math.min(30, totalPly(result.current.line));
    act(() => result.current.seek(nextPly));

    act(() => routeUpdates[1]?.());
    act(() => routeUpdates[2]?.());

    expect(result.current.line.game.moves).toHaveLength(30);
    expect(totalPly(result.current.line)).toBe(30);
  });
});
