import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./app.tsx";

describe("App", () => {
  it("renders the application shell", () => {
    render(<App />);

    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});
