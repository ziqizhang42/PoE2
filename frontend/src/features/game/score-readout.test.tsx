import { act, render, screen } from "@testing-library/react";
import type { GameSnapshot } from "@poe2/protocol";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import {
  createTestRuntime,
  GAME_ID,
  OTHER_GAME_ID,
  timedActiveGame,
  timedOutGame,
  waitingGame,
} from "../../test/fakes.ts";
import { TestProviders } from "../../test/providers.tsx";
import { ScoreReadout } from "./score-readout.tsx";

function mount(game: GameSnapshot = timedActiveGame()) {
  const runtime = createTestRuntime();
  const result = render(
    <MemoryRouter>
      <TestProviders runtime={runtime}>
        <ScoreReadout game={game} seat={1} />
      </TestProviders>
    </MemoryRouter>,
  );
  return { runtime, ...result };
}

describe("live clock interpolation", () => {
  it("anchors a snapshot to monotonic receipt time and ticks every 250 ms", () => {
    const { runtime } = mount(
      timedActiveGame(undefined, {
        remainingMs: { playerOne: 60_000, playerTwo: 90_000 },
      }),
    );

    expect(screen.getByText("1:00")).toBeInTheDocument();
    expect(runtime.clock.pending()[0]?.delayMs).toBe(250);

    act(() => {
      runtime.clock.advance(1_250);
      runtime.clock.fire();
    });
    expect(screen.getByText("0:59")).toBeInTheDocument();
    expect(screen.getByText("1:30")).toBeInTheDocument();
  });

  it("resynchronizes from every authoritative snapshot after a background jump", () => {
    const game = timedActiveGame(undefined, {
      remainingMs: { playerOne: 60_000, playerTwo: 90_000 },
    });
    const { runtime, rerender } = mount(game);

    act(() => {
      runtime.clock.advance(20_000);
      runtime.clock.fire();
    });
    expect(screen.getByText("0:40")).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <TestProviders runtime={runtime}>
          <ScoreReadout
            game={timedActiveGame(undefined, {
              remainingMs: { playerOne: 52_000, playerTwo: 90_000 },
              serverNow: "2026-08-04T12:00:08.000Z",
            })}
            seat={1}
          />
        </TestProviders>
      </MemoryRouter>,
    );
    expect(screen.getByText("0:52")).toBeInTheDocument();
  });

  it("clamps visual time at zero without declaring a result", () => {
    const { runtime } = mount(
      timedActiveGame(undefined, { remainingMs: { playerOne: 500, playerTwo: 90_000 } }),
    );
    act(() => {
      runtime.clock.advance(5_000);
      runtime.clock.fire();
    });

    expect(screen.getByText("0:00")).toBeInTheDocument();
    expect(screen.queryByText(/won on time/u)).not.toBeInTheDocument();
  });

  it("uses one-second updates under reduced motion", () => {
    const runtime = createTestRuntime();
    runtime.motion.set(true);
    render(
      <MemoryRouter>
        <TestProviders runtime={runtime}>
          <ScoreReadout game={timedActiveGame()} seat={1} />
        </TestProviders>
      </MemoryRouter>,
    );

    expect(runtime.clock.pending()[0]?.delayMs).toBe(1_000);
  });

  it("shows configured balances without running while a timed lobby waits", () => {
    const game = {
      ...waitingGame(),
      timeControl: { kind: "timed", initialMs: 180_000, incrementMs: 2_000 } as const,
    };
    const { runtime } = mount(game);

    expect(screen.getAllByText("3:00")).toHaveLength(2);
    expect(runtime.clock.pending()).toEqual([]);
  });

  it("prints no balance at all on an untimed game", () => {
    mount(waitingGame());
    expect(screen.queryByText(/left on the clock/u)).not.toBeInTheDocument();
  });
});

describe("clock announcements", () => {
  it("announces a running-player change, not each visual tick", () => {
    const game = timedActiveGame();
    const { runtime, rerender } = mount(game);
    act(() => {
      runtime.clock.advance(500);
      runtime.clock.fire();
    });
    expect(screen.queryByText(/clock is now running/u)).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <TestProviders runtime={runtime}>
          <ScoreReadout
            game={timedActiveGame(undefined, {
              runningPlayer: 2,
              serverNow: "2026-08-04T12:00:01.000Z",
            })}
            seat={1}
          />
        </TestProviders>
      </MemoryRouter>,
    );
    expect(screen.getByText("Player 2 clock is now running.")).toBeInTheDocument();
  });

  it("announces the first 30-second crossing for a player", () => {
    const { runtime } = mount(
      timedActiveGame(undefined, { remainingMs: { playerOne: 31_000, playerTwo: 90_000 } }),
    );
    act(() => {
      runtime.clock.advance(1_250);
      runtime.clock.fire();
    });
    expect(screen.getByText("Player 1 has 30 seconds or less remaining.")).toBeInTheDocument();
  });

  it("keeps both warnings when both clocks are already low", () => {
    mount(timedActiveGame(undefined, { remainingMs: { playerOne: 20_000, playerTwo: 25_000 } }));

    expect(
      screen.getByText(
        "Player 1 has 30 seconds or less remaining. Player 2 has 30 seconds or less remaining.",
      ),
    ).toBeInTheDocument();
  });

  it("announces only an authoritative timeout result", () => {
    mount(timedOutGame());
    expect(screen.getByText("Player 2 won on time.")).toBeInTheDocument();
  });

  it("starts announcements fresh when the route changes to another game", () => {
    const bothLow =
      "Player 1 has 30 seconds or less remaining. Player 2 has 30 seconds or less remaining.";
    const first = timedActiveGame(GAME_ID, {
      remainingMs: { playerOne: 20_000, playerTwo: 25_000 },
    });
    const { runtime, rerender } = mount(first);
    expect(screen.getByText(bothLow)).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <TestProviders runtime={runtime}>
          <ScoreReadout
            game={timedActiveGame(OTHER_GAME_ID, {
              remainingMs: { playerOne: 20_000, playerTwo: 90_000 },
            })}
            seat={1}
          />
        </TestProviders>
      </MemoryRouter>,
    );

    expect(screen.getByText("Player 1 has 30 seconds or less remaining.")).toBeInTheDocument();
    expect(screen.queryByText(bothLow)).not.toBeInTheDocument();
  });
});
