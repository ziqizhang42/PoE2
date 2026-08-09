import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { PlayerLink } from "./player-link.tsx";

describe("PlayerLink", () => {
  it("encodes the username as one path segment", () => {
    render(
      <MemoryRouter>
        <PlayerLink username="Player/One" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Player/One" })).toHaveAttribute(
      "href",
      "/player/Player%2FOne",
    );
  });

  it("can keep the canonical username in the URL while presenting contextual copy", () => {
    render(
      <MemoryRouter>
        <PlayerLink username="Player_One">The winner</PlayerLink>
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "The winner" })).toHaveAttribute(
      "href",
      "/player/Player_One",
    );
  });
});
