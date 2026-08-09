import { describe, expect, it } from "vitest";

import type { LiveStatus } from "../live/store.ts";
import { describeConnection } from "./connection.ts";

describe("describeConnection", () => {
  it("only allows commands once the connection is ready", () => {
    const statuses: LiveStatus[] = [
      "idle",
      "connecting",
      "reconnecting",
      "disconnected",
      "unauthenticated",
    ];

    for (const status of statuses) {
      expect(describeConnection(status, 0).canCommand).toBe(false);
    }

    expect(describeConnection("ready", 0).canCommand).toBe(true);
  });

  it("names the attempt while reconnecting", () => {
    const description = describeConnection("reconnecting", 3);

    expect(description.tone).toBe("alarm");
    expect(description.detail).toContain("Attempt 3");
  });

  it("names what the reader is actually waiting for on each screen", () => {
    expect(describeConnection("connecting", 0, "lobby").detail).toContain("Lobbies");
    expect(describeConnection("connecting", 0, "game").detail).toContain("board");
    expect(describeConnection("ready", 0, "game").detail).toContain("board");
  });

  it("describes every status in words rather than by colour alone", () => {
    const statuses: LiveStatus[] = [
      "idle",
      "connecting",
      "ready",
      "reconnecting",
      "disconnected",
      "unauthenticated",
    ];

    for (const status of statuses) {
      const description = describeConnection(status, 1);
      expect(description.title.length).toBeGreaterThan(0);
      expect(description.detail.length).toBeGreaterThan(0);
    }
  });
});
