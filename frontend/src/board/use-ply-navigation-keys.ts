import { useEffect } from "react";

export interface PlyNavigationKeysOptions {
  readonly ply: number;
  readonly finalPly: number;
  readonly onSeek: (ply: number) => void;
}

/**
 * Gives read-only page chrome the familiar Left/Right position shortcuts.
 * Controls that already own horizontal arrows, including the board grid and
 * native timeline slider, keep their native keyboard behavior.
 */
export function usePlyNavigationKeys({ ply, finalPly, onSeek }: PlyNavigationKeysOptions): void {
  useEffect(() => {
    const navigate = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        ownsHorizontalArrows(event.target)
      ) {
        return;
      }

      const step = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      if (step === 0) {
        return;
      }

      event.preventDefault();
      const target = Math.min(Math.max(ply + step, 0), finalPly);
      if (target !== ply) {
        onSeek(target);
      }
    };

    document.addEventListener("keydown", navigate);
    return () => {
      document.removeEventListener("keydown", navigate);
    };
  }, [finalPly, onSeek, ply]);
}

function ownsHorizontalArrows(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return (
    target.closest(
      'input, select, textarea, [contenteditable="true"], [role="grid"], [role="slider"]',
    ) !== null
  );
}
