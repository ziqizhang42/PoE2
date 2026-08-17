import { useEffect, useState } from "react";

import { formatSquare, type Square } from "@poe2/rules";

import { Button } from "../../ui/button.tsx";

type CopyState = "idle" | "copied" | "failed";

export function AnalysisControls({
  moves,
  future,
  sharePath,
  resetAvailable = false,
  onUndo,
  onRedo,
  onReset,
}: {
  readonly moves: readonly Square[];
  readonly future: readonly Square[];
  readonly sharePath: string;
  readonly resetAvailable?: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onReset: () => void;
}) {
  const [copyState, setCopyState] = useState<CopyState>("idle");

  useEffect(() => {
    setCopyState("idle");
  }, [sharePath]);

  const copy = async (): Promise<void> => {
    const clipboard = navigator.clipboard;
    if (clipboard === undefined) {
      setCopyState("failed");
      return;
    }

    try {
      await clipboard.writeText(new URL(sharePath, window.location.origin).href);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  const redoMove = future.at(0);

  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={moves.length === 0} onClick={onUndo}>
          Undo
        </Button>
        <Button size="sm" disabled={redoMove === undefined} onClick={onRedo}>
          {redoMove === undefined ? "Redo" : `Redo ${formatSquare(redoMove)}`}
        </Button>
        <Button
          variant="quiet"
          size="sm"
          disabled={!resetAvailable && moves.length === 0 && future.length === 0}
          onClick={onReset}
        >
          Reset
        </Button>
        <Button
          variant="quiet"
          size="sm"
          onClick={() => {
            void copy();
          }}
        >
          Copy position link
        </Button>
      </div>

      {copyState === "copied" ? (
        <p role="status" className="mt-2 text-xs text-ink-3">
          Position link copied.
        </p>
      ) : copyState === "failed" ? (
        <p role="alert" className="mt-2 text-xs text-pen-2-text">
          The link could not be copied. Copy it from the address bar instead.
        </p>
      ) : null}
    </div>
  );
}
