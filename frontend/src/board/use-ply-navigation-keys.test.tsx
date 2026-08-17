import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { usePlyNavigationKeys } from "./use-ply-navigation-keys.ts";

describe("usePlyNavigationKeys", () => {
  it("moves one ply with unmodified Left and Right Arrow presses", () => {
    const onSeek = vi.fn();
    renderHook(() => usePlyNavigationKeys({ ply: 3, finalPly: 5, onSeek }));

    const backward = press("ArrowLeft");
    const forward = press("ArrowRight");

    expect(backward.defaultPrevented).toBe(true);
    expect(forward.defaultPrevented).toBe(true);
    expect(onSeek.mock.calls).toEqual([[2], [4]]);
  });

  it("stops at the line ends and leaves modified shortcuts alone", () => {
    const onSeek = vi.fn();
    const view = renderHook(
      ({ ply }: { readonly ply: number }) => usePlyNavigationKeys({ ply, finalPly: 5, onSeek }),
      { initialProps: { ply: 0 } },
    );

    expect(press("ArrowLeft").defaultPrevented).toBe(true);
    expect(onSeek).not.toHaveBeenCalled();

    view.rerender({ ply: 5 });
    expect(press("ArrowRight").defaultPrevented).toBe(true);
    press("ArrowLeft", { metaKey: true });
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("does not intercept arrows owned by a form control or board grid", () => {
    const onSeek = vi.fn();
    const input = document.createElement("input");
    const grid = document.createElement("div");
    const cell = document.createElement("button");
    grid.setAttribute("role", "grid");
    grid.append(cell);
    document.body.append(input, grid);
    renderHook(() => usePlyNavigationKeys({ ply: 3, finalPly: 5, onSeek }));

    try {
      expect(press("ArrowLeft", {}, input).defaultPrevented).toBe(false);
      expect(press("ArrowRight", {}, cell).defaultPrevented).toBe(false);
      expect(onSeek).not.toHaveBeenCalled();
    } finally {
      input.remove();
      grid.remove();
    }
  });
});

function press(
  key: string,
  init: KeyboardEventInit = {},
  target: Document | HTMLElement = document,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}
