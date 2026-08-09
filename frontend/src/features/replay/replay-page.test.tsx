import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GameReplay } from "@poe2/protocol";
import { beforeEach, describe, expect, it } from "vitest";

import { allSquares, CELL_COUNT, formatSquare, PLAYER_ONE } from "@poe2/rules";

import { GamesRequestError } from "../../games/errors.ts";
import {
  createFakeAuthClient,
  createSilentQueryClient,
  createTestRuntime,
  GAME_ID,
  gameReplay,
  USER_ONE,
  USER_TWO,
  type TestRuntime,
} from "../../test/fakes.ts";
import { renderApp } from "../../test/render.tsx";

const FULL_GAME = allSquares().map(formatSquare);
const MIDGAME = ["d4", "a1", "e4", "a2", "f4"];

let runtime: TestRuntime;

beforeEach(() => {
  runtime = createTestRuntime({
    authClient: createFakeAuthClient({ fetchSession: async () => USER_ONE }),
    queryClient: createSilentQueryClient(),
  });
});

async function openReplay(gameId = GAME_ID): Promise<void> {
  renderApp(runtime, `/replay/${gameId}`);
  await waitFor(() => {
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
}

function scrubber(): HTMLInputElement {
  return screen.getByRole("slider", { name: "Position after ply" }) as HTMLInputElement;
}

function timedReplay(): GameReplay & { clockHistory: NonNullable<GameReplay["clockHistory"]> } {
  const replay = gameReplay(MIDGAME);
  const balances = [
    { playerOne: 294_000, playerTwo: 300_000 },
    { playerOne: 294_000, playerTwo: 292_000 },
    { playerOne: 287_000, playerTwo: 292_000 },
    { playerOne: 287_000, playerTwo: 283_000 },
    { playerOne: 278_000, playerTwo: 283_000 },
  ];

  return {
    ...replay,
    timeControl: { kind: "timed", initialMs: 300_000, incrementMs: 3_000 },
    clockHistory: {
      moves: replay.moves.map((_move, index) => ({
        ply: index + 1,
        acceptedAt: new Date(Date.parse(replay.createdAt) + (index + 1) * 10_000).toISOString(),
        elapsedMs: 9_000,
        incrementAppliedMs: 3_000,
        remainingMs: balances[index] ?? { playerOne: 278_000, playerTwo: 283_000 },
      })),
      final: {
        remainingMs: { playerOne: 270_000, playerTwo: 275_000 },
        stoppedAt: replay.outcome.finishedAt,
      },
    },
  };
}

describe("replay screen", () => {
  it("names the screen without naming the game", async () => {
    runtime.gamesClient.fetchReplay.mockResolvedValue(gameReplay(FULL_GAME));

    await openReplay();

    expect(document.title).toBe("Replay — PoE2");
    expect(document.title).not.toContain(GAME_ID);
  });

  it("states who won and how before anything is touched", async () => {
    runtime.gamesClient.fetchReplay.mockResolvedValue(gameReplay(FULL_GAME));

    await openReplay();
    const heading = screen.getByRole("heading", { level: 1 });

    expect(heading).toHaveTextContent("beat");
    expect(heading).toHaveTextContent("by 34½");
    expect(screen.getByText("Board full")).toBeInTheDocument();
  });

  it("says a conceded game was conceded rather than giving it a margin", async () => {
    runtime.gamesClient.fetchReplay.mockResolvedValue(
      gameReplay(MIDGAME, { resignedBy: PLAYER_ONE }),
    );

    await openReplay();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("by resignation");
    expect(screen.getByText("Resigned")).toBeInTheDocument();
  });

  it("opens on the finished position rather than replaying it unasked", async () => {
    runtime.gamesClient.fetchReplay.mockResolvedValue(gameReplay(FULL_GAME));

    await openReplay();

    expect(scrubber().value).toBe(String(CELL_COUNT));
    expect(runtime.clock.pending()).toHaveLength(0);
  });

  it("says whether the game counted", async () => {
    runtime.gamesClient.fetchReplay.mockResolvedValue(gameReplay(FULL_GAME, { rated: true }));

    await openReplay();

    expect(screen.getByText("Rated")).toBeInTheDocument();
  });

  it("is a real range input, which is where its keyboard support comes from", async () => {
    // jsdom does not implement native range-key behavior; assert the native control itself.
    runtime.gamesClient.fetchReplay.mockResolvedValue(gameReplay(MIDGAME));

    await openReplay();
    const range = scrubber();

    expect(range.type).toBe("range");
    expect(range.min).toBe("0");
    expect(range.max).toBe(String(MIDGAME.length));
    expect(range.step).toBe("1");
    expect(range).toHaveAccessibleName("Position after ply");
  });

  it("takes focus, so the strip it drives shows the focus", async () => {
    runtime.gamesClient.fetchReplay.mockResolvedValue(gameReplay(MIDGAME));

    await openReplay();
    await userEvent.tab();

    for (let step = 0; step < 20 && document.activeElement !== scrubber(); step += 1) {
      await userEvent.tab();
    }

    expect(scrubber()).toHaveFocus();
  });

  it("announces the position and who was ahead there, not just a number", async () => {
    runtime.gamesClient.fetchReplay.mockResolvedValue(gameReplay(MIDGAME));

    await openReplay();

    expect(scrubber()).toHaveAttribute(
      "aria-valuetext",
      expect.stringContaining("Player") as never,
    );
    expect(scrubber().getAttribute("aria-valuetext")).toContain(`of ${String(MIDGAME.length)}`);
  });

  it("repriced every readout at the position it was scrubbed to", async () => {
    runtime.gamesClient.fetchReplay.mockResolvedValue(gameReplay(MIDGAME));

    await openReplay();
    fireEvent.change(scrubber(), { target: { value: "0" } });

    const readout = screen.getByRole("region", { name: "Score" });

    await waitFor(() => {
      expect(readout).toHaveTextContent("ply 0 of 5");
    });

    const playerOne = within(readout).getByRole("link", { name: USER_ONE.username }).closest("div");
    expect(playerOne).not.toBeNull();
    expect(within(playerOne as HTMLElement).getByText("0")).toBeInTheDocument();
    expect(within(playerOne as HTMLElement).getByText("no handicap")).toBeInTheDocument();

    expect(within(readout).getByText("0 + 5½")).toBeInTheDocument();
    expect(within(readout).getAllByText("5½")).toHaveLength(2);
  });

  it("selects initial, post-move, and final authoritative clock records by ply", async () => {
    runtime.gamesClient.fetchReplay.mockResolvedValue(timedReplay());

    await openReplay();
    const readout = screen.getByRole("region", { name: "Score" });

    expect(within(readout).getByText("4:30")).toBeInTheDocument();
    expect(within(readout).getByText("4:35")).toBeInTheDocument();

    fireEvent.change(scrubber(), { target: { value: "0" } });
    await waitFor(() => {
      expect(within(readout).getAllByText("5:00")).toHaveLength(2);
    });

    fireEvent.change(scrubber(), { target: { value: "1" } });
    await waitFor(() => {
      expect(within(readout).getByText("4:54")).toBeInTheDocument();
    });
    expect(within(readout).getByText("5:00")).toBeInTheDocument();
  });

  it("uses final clocks and a zero-move count when a timed game ends before ply one", async () => {
    const replay = gameReplay([]);
    runtime.gamesClient.fetchReplay.mockResolvedValue({
      ...replay,
      timeControl: { kind: "timed", initialMs: 300_000, incrementMs: 3_000 },
      outcome: { ...replay.outcome, reason: "timeout", winner: 2 },
      clockHistory: {
        moves: [],
        final: {
          remainingMs: { playerOne: 0, playerTwo: 240_000 },
          stoppedAt: replay.outcome.finishedAt,
        },
      },
    });

    await openReplay();

    const readout = within(screen.getByRole("region", { name: "Score" }));
    expect(readout.getByText("0:00")).toBeInTheDocument();
    expect(readout.getByText("4:00")).toBeInTheDocument();
    expect(readout.queryByText("5:00")).not.toBeInTheDocument();
    expect(screen.getByText("ply 0 / 0")).toBeInTheDocument();
  });

  it("prices every played move in the move list", async () => {
    runtime.gamesClient.fetchReplay.mockResolvedValue(timedReplay());

    await openReplay();
    const moves = screen.getByRole("region", { name: /Moves/u });

    expect(within(moves).getAllByText("9.0s")).toHaveLength(MIDGAME.length);

    fireEvent.change(scrubber(), { target: { value: "2" } });

    await waitFor(() => {
      expect(within(moves).getAllByText("9.0s")).toHaveLength(2);
    });
  });

  it("leaves the times out of a game that was never on a clock", async () => {
    runtime.gamesClient.fetchReplay.mockResolvedValue(gameReplay(MIDGAME));

    await openReplay();

    expect(
      within(screen.getByRole("region", { name: /Moves/u })).queryByText(/^\d+\.\d\s?s$/u),
    ).toBeNull();
    expect(
      within(screen.getByRole("region", { name: "Score" })).queryByText(/balances/u),
    ).toBeNull();
  });

  it("shows an authoritative timeout as a timeout rather than a board margin", async () => {
    const replay = timedReplay();
    runtime.gamesClient.fetchReplay.mockResolvedValue({
      ...replay,
      outcome: { ...replay.outcome, reason: "timeout", winner: 2 },
      clockHistory: {
        ...replay.clockHistory,
        final: {
          remainingMs: { playerOne: 0, playerTwo: 275_000 },
          stoppedAt: replay.outcome.finishedAt,
        },
      },
    });

    await openReplay();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("on time");
    expect(screen.getByText("Timeout")).toBeInTheDocument();
  });

  it("shows only the moves up to the position being read", async () => {
    runtime.gamesClient.fetchReplay.mockResolvedValue(gameReplay(MIDGAME));

    await openReplay();
    expect(screen.getByText("f4")).toBeInTheDocument();

    fireEvent.change(scrubber(), { target: { value: "0" } });

    await waitFor(() => {
      expect(screen.queryByText("f4")).not.toBeInTheDocument();
    });
  });

  it("describes the board for a reader who cannot see it", async () => {
    runtime.gamesClient.fetchReplay.mockResolvedValue(gameReplay(MIDGAME));

    await openReplay();

    expect(screen.getByRole("img", { name: /The board after ply 5/u })).toBeInTheDocument();
    expect(screen.queryAllByRole("gridcell")).toHaveLength(0);
  });

  it("says a game in play is simply not there, without hinting that it exists", async () => {
    runtime.gamesClient.fetchReplay.mockRejectedValue(
      new GamesRequestError({
        kind: "http",
        message: "No such game",
        status: 404,
        code: "game_not_found",
      }),
    );

    await openReplay();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("No such game");
    expect(screen.getByText(/not readable here until it is decided/u)).toBeInTheDocument();
  });

  it("reports a transport failure as itself rather than as a missing game", async () => {
    runtime.gamesClient.fetchReplay.mockRejectedValue(
      new GamesRequestError({
        kind: "network",
        message: "Could not reach the server.",
        status: null,
        code: null,
      }),
    );

    await openReplay();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("could not be fetched");
  });

  it("names both players, because both are entitled to read it", async () => {
    runtime.gamesClient.fetchReplay.mockResolvedValue(gameReplay(FULL_GAME));

    await openReplay();
    const mainElement = screen.getByRole("main");
    const main = mainElement.textContent ?? "";
    const replay = within(mainElement);

    expect(main).toContain(USER_ONE.username);
    expect(main).toContain(USER_TWO.username);
    for (const user of [USER_ONE, USER_TWO]) {
      const links = replay.getAllByRole("link", { name: user.username });
      expect(links.length).toBeGreaterThanOrEqual(2);
      for (const link of links) {
        expect(link).toHaveAttribute("href", `/player/${user.username}`);
      }
    }
  });

  it("offers nothing the server cannot do", async () => {
    runtime.gamesClient.fetchReplay.mockResolvedValue(gameReplay(FULL_GAME));
    await openReplay();

    const main = screen.getByRole("main").textContent ?? "";
    for (const pattern of [
      /\bbot\b/iu,
      /\brematch\b/iu,
      /\bplay again\b/iu,
      /\bstake/iu,
      /\bglicko/iu,
      /\bshare\b/iu,
    ]) {
      expect(main).not.toMatch(pattern);
    }
  });
});
