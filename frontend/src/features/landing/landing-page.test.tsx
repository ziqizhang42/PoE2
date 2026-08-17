import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { CELL_COUNT } from "@poe2/rules";

import {
  createFakeAuthClient,
  createTestRuntime,
  USER_ONE,
  USER_TWO,
  type TestRuntime,
} from "../../test/fakes.ts";
import { renderApp } from "../../test/render.tsx";

function visitor(reducedMotion = false): TestRuntime {
  const runtime = createTestRuntime({
    authClient: createFakeAuthClient({ fetchSession: async () => null }),
  });
  runtime.motion.set(reducedMotion);
  return runtime;
}

function demo(): HTMLElement {
  return screen.getByRole("region", { name: /One recorded game/ });
}

function tick(runtime: TestRuntime): void {
  act(() => {
    runtime.clock.fire();
  });
}

describe("the landing page's demonstration", () => {
  let runtime: TestRuntime;

  beforeEach(() => {
    runtime = visitor();
  });

  it("says it is a demonstration rather than letting it look like a game", async () => {
    renderApp(runtime, "/");
    await screen.findByRole("link", { name: "Sign in to play" });

    expect(within(demo()).getByText("A demonstration, not a live game")).toBeInTheDocument();
  });

  it("names nobody, because the record names nobody", async () => {
    renderApp(runtime, "/");
    await screen.findByRole("link", { name: "Sign in to play" });

    const page = screen.getByRole("main").textContent ?? "";
    expect(page).not.toContain(USER_ONE.username);
    expect(page).not.toContain(USER_TWO.username);
    expect(within(demo()).getByText("Player 1")).toBeInTheDocument();
  });

  it("draws the board as a picture, not as forty-nine things to tab through", async () => {
    renderApp(runtime, "/");
    await screen.findByRole("link", { name: "Sign in to play" });

    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    expect(screen.queryByRole("gridcell")).not.toBeInTheDocument();
  });

  it("can be paused from the first frame, not only replayed at the end", async () => {
    const user = userEvent.setup();
    renderApp(runtime, "/");
    await screen.findByRole("link", { name: "Sign in to play" });

    const pause = within(demo()).getByRole("button", { name: "Pause" });
    expect(pause).toBeInTheDocument();

    await user.click(pause);

    expect(within(demo()).getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(runtime.clock.pending()).toHaveLength(0);
  });

  it("shows the board developing and the readout following it", async () => {
    renderApp(runtime, "/");
    await screen.findByRole("link", { name: "Sign in to play" });

    expect(within(demo()).getByText(`move 0 of ${String(CELL_COUNT)}`)).toBeInTheDocument();

    tick(runtime);
    tick(runtime);

    expect(within(demo()).getByText(`move 2 of ${String(CELL_COUNT)}`)).toBeInTheDocument();
  });

  it("moves the lead strip along with the playback", async () => {
    renderApp(runtime, "/");
    await screen.findByRole("link", { name: "Sign in to play" });

    const strip = within(demo()).getByRole("img", { name: /Who leads/ });
    expect(strip).toHaveAccessibleName(/No moves played yet/);

    tick(runtime);
    tick(runtime);

    expect(within(demo()).getByRole("img", { name: /Who leads/ })).toHaveAccessibleName(
      /after move 2/,
    );
  });

  it("reaches an understandable conclusion and offers to run it again", async () => {
    renderApp(runtime, "/");
    await screen.findByRole("link", { name: "Sign in to play" });

    for (let played = 0; played < CELL_COUNT; played += 1) {
      tick(runtime);
    }

    const card = within(demo());
    expect(card.getByText("won by")).toBeInTheDocument();
    expect(card.getByRole("button", { name: "Watch it again" })).toBeInTheDocument();
    expect(card.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
  });

  it("starts over when asked to run it again", async () => {
    const user = userEvent.setup();
    renderApp(runtime, "/");
    await screen.findByRole("link", { name: "Sign in to play" });

    for (let played = 0; played < CELL_COUNT; played += 1) {
      tick(runtime);
    }

    await user.click(within(demo()).getByRole("button", { name: "Watch it again" }));

    expect(within(demo()).getByText(`move 0 of ${String(CELL_COUNT)}`)).toBeInTheDocument();
  });

  it("derives both totals rather than reciting them", async () => {
    renderApp(runtime, "/");
    await screen.findByRole("link", { name: "Sign in to play" });

    for (let played = 0; played < CELL_COUNT; played += 1) {
      tick(runtime);
    }

    const card = within(demo());
    expect(card.getByText("102")).toBeInTheDocument();
    expect(card.getByText("101½")).toBeInTheDocument();
    expect(card.getByText("96 + 5½")).toBeInTheDocument();
  });

  describe("under prefers-reduced-motion", () => {
    it("opens on the finished board with nothing moving", async () => {
      const still = visitor(true);
      renderApp(still, "/");
      await screen.findByRole("link", { name: "Sign in to play" });

      expect(within(demo()).getByText(`move 49 of ${String(CELL_COUNT)}`)).toBeInTheDocument();
      expect(within(demo()).getByText("won by")).toBeInTheDocument();
      expect(still.clock.timers).toHaveLength(0);
    });

    it("offers to play it anyway, without making that the default", async () => {
      const user = userEvent.setup();
      const still = visitor(true);
      renderApp(still, "/");
      await screen.findByRole("link", { name: "Sign in to play" });

      expect(within(demo()).queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();

      await user.click(within(demo()).getByRole("button", { name: "Watch it again" }));

      expect(within(demo()).getByText(`move 0 of ${String(CELL_COUNT)}`)).toBeInTheDocument();
    });
  });

  describe("what the landing page does not claim", () => {
    it("advertises nothing the server cannot do", async () => {
      renderApp(runtime, "/");
      await screen.findByRole("link", { name: "Sign in to play" });

      const page = screen.getByRole("main").textContent ?? "";
      for (const absent of [
        /\brating\b/i,
        /\bclock\b/i,
        /\btime control/i,
        /\bbot\b/i,
        /\brated\b/i,
        /\bcasual\b/i,
        /\btournament/i,
        /\bprofile\b/i,
        /\bresign/i,
      ]) {
        expect(page).not.toMatch(absent);
      }
    });

    it("links only to routes that exist", async () => {
      renderApp(runtime, "/");
      await screen.findByRole("link", { name: "Sign in to play" });

      const targets = screen
        .getAllByRole("link")
        .map((link) => link.getAttribute("href"))
        .filter((href): href is string => href !== null);

      for (const href of targets) {
        expect(href).toMatch(/^(#main|\/|\/analysis|\/signin(\?mode=register)?|\/lobby)$/);
      }
    });
  });
});
