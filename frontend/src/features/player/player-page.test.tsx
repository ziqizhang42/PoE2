import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { PlayerRequestError } from "../../players/errors.ts";
import { playerGamesKey, playerProfileKey } from "../../players/queries.ts";
import {
  createFakeAuthClient,
  createSilentQueryClient,
  createTestRuntime,
  historyEntry,
  historyPage,
  USER_ONE,
  USER_TWO,
  type TestRuntime,
} from "../../test/fakes.ts";
import { renderApp } from "../../test/render.tsx";

let runtime: TestRuntime;

beforeEach(() => {
  runtime = createTestRuntime({
    queryClient: createSilentQueryClient(),
    authClient: createFakeAuthClient({ fetchSession: async () => null }),
  });
});

function profileFixture() {
  return {
    username: "Player_One",
    createdAt: "2026-08-04T10:00:00.000Z",
    rating: { value: 1513, deviation: 87, percentile: null },
    ratingHistory: [],
    statistics: {
      totalFinishedGames: 3,
      wins: 2,
      losses: 1,
      ratedWins: 1,
      ratedLosses: 1,
      ratedGames: 2,
      casualGames: 1,
      boardFullGames: 1,
      resignationGames: 1,
      timeoutGames: 1,
    },
  } as const;
}

describe("public player page", () => {
  it("says where a rating sits in words and colours it by its exact percentile", async () => {
    runtime.playersClient.fetchProfile.mockResolvedValue({
      ...profileFixture(),
      rating: { value: 1642, deviation: 68, percentile: 88 },
    });

    renderApp(runtime, "/player/Player_One");

    expect(await screen.findByText("Higher than 88% of rated players.")).toBeInTheDocument();
    expect(screen.getByText("1642")).toHaveStyle({
      color: "color-mix(in oklab, var(--tier-7), var(--tier-8) 16%)",
    });
  });

  it("says an unranked player is unranked rather than giving them a share", async () => {
    runtime.playersClient.fetchProfile.mockResolvedValue(profileFixture());

    renderApp(runtime, "/player/Player_One");

    expect(
      await screen.findByText("Not ranked yet — a rated game places this rating."),
    ).toBeInTheDocument();
  });

  it("draws the rating line and labels it with the shape in words", async () => {
    runtime.playersClient.fetchProfile.mockResolvedValue({
      ...profileFixture(),
      rating: { value: 1560, deviation: 90, percentile: 60 },
      ratingHistory: [
        { at: "2026-08-01T10:00:00.000Z", rating: 1500 },
        { at: "2026-08-02T10:00:00.000Z", rating: 1560 },
      ],
    });

    renderApp(runtime, "/player/Player_One");

    const sentence = "Rating over 1 rated game: now 1560, up from 1500. Highest 1560, lowest 1500.";
    expect(await screen.findByRole("img", { name: sentence })).toBeInTheDocument();
  });

  it("says there is nothing to draw rather than drawing an empty picture", async () => {
    runtime.playersClient.fetchProfile.mockResolvedValue(profileFixture());

    renderApp(runtime, "/player/Player_One");

    expect(await screen.findByText(/Nothing to draw yet/u)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Rating over/u })).not.toBeInTheDocument();
  });

  it("loads while signed out and keeps canonical casing", async () => {
    runtime.playersClient.fetchProfile.mockResolvedValue({
      username: "Player_One",
      createdAt: "2026-08-04T10:00:00.000Z",
      rating: { value: 1513, deviation: 87, percentile: null },
      ratingHistory: [],
      statistics: {
        totalFinishedGames: 3,
        wins: 2,
        losses: 1,
        ratedWins: 1,
        ratedLosses: 1,
        ratedGames: 2,
        casualGames: 1,
        boardFullGames: 1,
        resignationGames: 1,
        timeoutGames: 1,
      },
    });

    renderApp(runtime, "/player/pLaYeR_oNe");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Player_One" }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Player — PoE2");
    expect(window.location.pathname).toBe("/player/pLaYeR_oNe");
    expect(screen.getByText("1513")).toBeInTheDocument();
    expect(screen.getByText("±87")).toBeInTheDocument();
    expect(screen.getByText("Timeout")).toBeInTheDocument();
  });

  it("uses ASCII-normalized cache keys, with no viewer in them", () => {
    expect(playerProfileKey("PlAyEr_One")).toEqual(["players", "player_one", "profile"]);
    expect(playerGamesKey("PlAyEr_One")).toEqual(["players", "player_one", "games"]);
  });

  it("shows one generic missing state without a retry action", async () => {
    runtime.playersClient.fetchProfile.mockRejectedValue(
      new PlayerRequestError({
        kind: "http",
        status: 404,
        code: "player_not_found",
        message: "No such player",
      }),
    );
    renderApp(runtime, "/player/Missing");

    expect(await screen.findByText("No such player")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it.each([
    ["network", "The profile server could not be reached"],
    ["protocol", "That profile could not be read"],
  ] as const)("distinguishes %s failures and offers retry", async (kind, heading) => {
    runtime.playersClient.fetchProfile.mockRejectedValue(
      new PlayerRequestError({
        kind,
        status: kind === "protocol" ? 200 : null,
        code: null,
        message: kind === "protocol" ? "Unreadable response" : "Offline",
      }),
    );
    renderApp(runtime, "/player/Player_One");

    expect(await screen.findByText(heading)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("retries explicitly after a transient failure", async () => {
    runtime.playersClient.fetchProfile
      .mockRejectedValueOnce(
        new PlayerRequestError({
          kind: "network",
          status: null,
          code: null,
          message: "Offline",
        }),
      )
      .mockResolvedValueOnce({
        username: "Player_One",
        createdAt: "2026-08-04T10:00:00.000Z",
        rating: { value: 1500, deviation: 350, percentile: null },
        ratingHistory: [],
        statistics: {
          totalFinishedGames: 0,
          wins: 0,
          losses: 0,
          ratedWins: 0,
          ratedLosses: 0,
          ratedGames: 0,
          casualGames: 0,
          boardFullGames: 0,
          resignationGames: 0,
          timeoutGames: 0,
        },
      });
    renderApp(runtime, "/player/Player_One");

    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Player_One" }),
    ).toBeInTheDocument();
  });
});

describe("the games on a public profile", () => {
  beforeEach(() => {
    runtime.playersClient.fetchProfile.mockResolvedValue(profileFixture());
  });

  it("lists a signed-out reader every finished game, each one openable", async () => {
    runtime.playersClient.fetchGames.mockResolvedValue(
      historyPage([historyEntry({ opponent: USER_TWO, seat: 1, winner: 1 })]),
    );

    renderApp(runtime, "/player/Player_One");

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: USER_TWO.username })).toBeInTheDocument();
    expect(screen.getByText("Won")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Read" })).toHaveAttribute(
      "href",
      expect.stringContaining("/replay/"),
    );
  });

  it("reads a loss as a loss on the loser's profile", async () => {
    runtime.playersClient.fetchGames.mockResolvedValue(
      historyPage([historyEntry({ opponent: USER_ONE, seat: 2, winner: 1 })]),
    );

    renderApp(runtime, "/player/Player_One");

    expect(await screen.findByText("Lost")).toBeInTheDocument();
  });

  it("says an account has no games rather than showing an empty table", async () => {
    runtime.playersClient.fetchGames.mockResolvedValue(historyPage([]));

    renderApp(runtime, "/player/Player_One");

    expect(await screen.findByText(/No finished games yet/u)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("pages on demand, passing the cursor the server issued back", async () => {
    runtime.playersClient.fetchGames
      .mockResolvedValueOnce(
        historyPage([historyEntry({ gameId: "0f1a4e2c-3b5d-4a7f-9c1e-2d3b4a5c6d7e" })], {
          nextCursor: "opaque-cursor",
        }),
      )
      .mockResolvedValueOnce(historyPage([historyEntry()]));

    renderApp(runtime, "/player/Player_One");

    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));

    expect(runtime.playersClient.fetchGames.mock.calls.at(1)?.at(1)).toMatchObject({
      cursor: "opaque-cursor",
    });
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("keeps a failed games list from taking the rest of the profile down with it", async () => {
    runtime.playersClient.fetchGames.mockRejectedValue(
      new PlayerRequestError({ kind: "network", status: null, code: null, message: "Offline" }),
    );

    renderApp(runtime, "/player/Player_One");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Player_One" }),
    ).toBeInTheDocument();
    expect(screen.getByText("These games could not be fetched")).toBeInTheDocument();
  });
});
