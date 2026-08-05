import { describe, expect, it } from "vitest";

import { liveSocketUrl } from "./socket.ts";

describe("liveSocketUrl", () => {
  it("uses ws: on a plain-HTTP page", () => {
    expect(liveSocketUrl({ protocol: "http:", host: "localhost:5173" })).toBe(
      "ws://localhost:5173/api/ws",
    );
  });

  it("uses wss: on a secure page", () => {
    expect(liveSocketUrl({ protocol: "https:", host: "poe2.example" })).toBe(
      "wss://poe2.example/api/ws",
    );
  });

  it("keeps the page's own host, so the session cookie is in scope", () => {
    expect(liveSocketUrl(window.location)).toBe(`ws://${window.location.host}/api/ws`);
  });
});
