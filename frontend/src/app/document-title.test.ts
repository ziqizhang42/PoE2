import { describe, expect, it } from "vitest";

import {
  ANALYSIS_TITLE,
  GAME_TITLE,
  HOME_TITLE,
  LOBBY_TITLE,
  SIGN_IN_TITLE,
  SITE_NAME,
  titleFor,
} from "./document-title.ts";
import {
  ANALYSIS_PATH,
  gamePath,
  GAME_ROUTE,
  HOME_PATH,
  LOBBY_PATH,
  SIGN_IN_PATH,
} from "./routes.ts";

describe("titleFor", () => {
  it("names each screen the router has", () => {
    expect(titleFor(HOME_PATH)).toBe(HOME_TITLE);
    expect(titleFor(SIGN_IN_PATH)).toBe(SIGN_IN_TITLE);
    expect(titleFor(ANALYSIS_PATH)).toBe(ANALYSIS_TITLE);
    expect(titleFor(LOBBY_PATH)).toBe(LOBBY_TITLE);
    expect(titleFor(GAME_ROUTE)).toBe(GAME_TITLE);
  });

  it("titles a game by its route rather than by its id", () => {
    expect(titleFor(gamePath("6f1f4a52-3d6a-4a37-8f0d-1f1a0bb6b6c1"))).toBe(GAME_TITLE);
    expect(titleFor(gamePath("abc"))).not.toContain("abc");
  });

  it("falls back to the site name for anything the router redirects", () => {
    expect(titleFor("/nonsense")).toBe(SITE_NAME);
    expect(titleFor("/lobby/extra")).toBe(SITE_NAME);
    expect(titleFor("")).toBe(SITE_NAME);
  });

  it("names the site in every title, so a tab is identifiable either way round", () => {
    for (const path of [
      HOME_PATH,
      SIGN_IN_PATH,
      ANALYSIS_PATH,
      LOBBY_PATH,
      gamePath("abc"),
      "/nonsense",
    ]) {
      expect(titleFor(path)).toContain(SITE_NAME);
    }
  });

  it("never carries a username", () => {
    for (const title of [HOME_TITLE, SIGN_IN_TITLE, ANALYSIS_TITLE, LOBBY_TITLE, GAME_TITLE]) {
      expect(title).not.toMatch(/Player_One|Player_Two/);
      expect(title).toMatch(/^[\w\s—-]+$/u);
    }
  });
});
