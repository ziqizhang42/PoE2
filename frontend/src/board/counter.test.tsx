import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Counter } from "./counter.tsx";

describe("Counter", () => {
  it("uses player color without repeating the seat number", () => {
    const view = render(<Counter player={1} isSingleton={false} isLastMove={false} />);
    const counter = view.container.querySelector('[data-player-color="1"]');

    expect(counter).not.toBeNull();
    expect(counter).toHaveTextContent("");
    expect(counter).toHaveClass("bg-pen-1");

    view.rerender(<Counter player={2} isSingleton isLastMove />);
    const updated = view.container.querySelector('[data-player-color="2"]');
    expect(updated).not.toBeNull();
    expect(updated).toHaveTextContent("");
    expect(updated).toHaveClass("bg-pen-2");
  });
});
