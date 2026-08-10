import type { PlayerDirectoryEntry, PublicPlayerProfile } from "@poe2/protocol";
import { describe, expect, it, vi } from "vitest";

import type { FetchLike } from "../http/fetch.ts";
import { createPlayersClient } from "./client.ts";
import { PlayerRequestError } from "./errors.ts";

const PROFILE: PublicPlayerProfile = {
  username: "Player_One",
  createdAt: "2026-08-04T12:00:00.000Z",
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
};

const DIRECTORY: readonly PlayerDirectoryEntry[] = [
  {
    id: "e4aa457e-7620-4f14-ae26-6c20f3995ee1",
    username: "Player_One",
    rating: 1513,
    colorPercentile: 72,
  },
];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function captureError(operation: Promise<unknown>): Promise<PlayerRequestError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(PlayerRequestError);
    return error as PlayerRequestError;
  }
  throw new Error("expected the player request to reject");
}

describe("public player client", () => {
  it("loads the authenticated directory and validates every entry", async () => {
    const fetch = vi.fn<FetchLike>(async () => jsonResponse(200, DIRECTORY));
    const controller = new AbortController();

    await expect(createPlayersClient({ fetch }).fetchDirectory(controller.signal)).resolves.toEqual(
      DIRECTORY,
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/players",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        signal: controller.signal,
      }),
    );
  });

  it("rejects a directory entry that leaks a private field", async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      jsonResponse(200, [{ ...DIRECTORY[0], ratingDeviation: 80 }]),
    );

    const error = await captureError(createPlayersClient({ fetch }).fetchDirectory());
    expect(error.kind).toBe("protocol");
  });

  it("encodes the username, forwards cancellation, and validates the public DTO", async () => {
    const fetch = vi.fn<FetchLike>(async () => jsonResponse(200, PROFILE));
    const controller = new AbortController();

    await expect(
      createPlayersClient({ fetch }).fetchProfile("Player/One", controller.signal),
    ).resolves.toEqual(PROFILE);
    expect(fetch).toHaveBeenCalledWith(
      "/api/players/Player%2FOne",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        signal: controller.signal,
      }),
    );
  });

  it.each([
    ["an extra private field", { ...PROFILE, id: "6f1f4a52-3d6a-4a37-8f0d-1f1a0bb6b6c1" }],
    [
      "inconsistent aggregates",
      { ...PROFILE, statistics: { ...PROFILE.statistics, totalFinishedGames: 4 } },
    ],
  ])("rejects %s as a protocol failure", async (_label, body) => {
    const fetch = vi.fn<FetchLike>(async () => jsonResponse(200, body));
    const error = await captureError(createPlayersClient({ fetch }).fetchProfile("Player_One"));

    expect(error.kind).toBe("protocol");
    expect(error.status).toBe(200);
  });

  it("preserves a schema-valid missing-player response", async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      jsonResponse(404, { code: "player_not_found", message: "No such player" }),
    );
    const error = await captureError(createPlayersClient({ fetch }).fetchProfile("Missing"));

    expect(error.kind).toBe("http");
    expect(error.status).toBe(404);
    expect(error.code).toBe("player_not_found");
    expect(error.message).toBe("No such player");
  });

  it("distinguishes network failures while preserving AbortError", async () => {
    const fetch = vi.fn<FetchLike>().mockRejectedValueOnce(new TypeError("offline"));
    const error = await captureError(createPlayersClient({ fetch }).fetchProfile("Player_One"));
    expect(error.kind).toBe("network");

    const abort = new DOMException("aborted", "AbortError");
    fetch.mockRejectedValueOnce(abort);
    await expect(createPlayersClient({ fetch }).fetchProfile("Player_One")).rejects.toBe(abort);
  });
});
