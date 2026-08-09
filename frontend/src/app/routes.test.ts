import { describe, expect, it } from "vitest";

import { gamePath, LOBBY_PATH, playerPath, returnPath } from "./routes.ts";

describe("returnPath", () => {
  it("honours a same-origin path", () => {
    expect(returnPath({ from: "/lobby?filter=open" })).toBe("/lobby?filter=open");
  });

  it("falls back when history state carries nothing usable", () => {
    expect(returnPath(undefined)).toBe(LOBBY_PATH);
    expect(returnPath(null)).toBe(LOBBY_PATH);
    expect(returnPath({})).toBe(LOBBY_PATH);
    expect(returnPath({ from: 42 })).toBe(LOBBY_PATH);
  });

  it("refuses anything that could leave the origin", () => {
    expect(returnPath({ from: "//evil.example/lobby" })).toBe(LOBBY_PATH);
    expect(returnPath({ from: "https://evil.example" })).toBe(LOBBY_PATH);
    expect(returnPath({ from: "lobby" })).toBe(LOBBY_PATH);
  });
});

describe("gamePath", () => {
  it("addresses a game by its id", () => {
    expect(gamePath("6f1f4a52-3d6a-4a37-8f0d-1f1a0bb6b6c1")).toBe(
      "/game/6f1f4a52-3d6a-4a37-8f0d-1f1a0bb6b6c1",
    );
  });

  it("escapes an id rather than letting it shape the path", () => {
    expect(gamePath("../lobby")).toBe("/game/..%2Flobby");
  });
});

describe("playerPath", () => {
  it("preserves a real username while encoding path separators", () => {
    expect(playerPath("Player/One")).toBe("/player/Player%2FOne");
  });
});
