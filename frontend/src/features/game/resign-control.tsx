import { useEffect, useRef, useState } from "react";

import { Button } from "../../ui/button.tsx";
import { HINT } from "../../ui/classes.ts";

type ResignControlProps = {
  canResign: boolean;
  pending: boolean;
  onResign: () => void;
};

/** Inline two-step resignation control with focus transfer and Escape cancellation. */
export function ResignControl({ canResign, pending, onResign }: ResignControlProps) {
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) {
      confirmRef.current?.focus();
    }
  }, [confirming]);

  if (!confirming) {
    return (
      <Button
        variant="danger"
        size="sm"
        disabled={!canResign}
        onClick={() => {
          setConfirming(true);
        }}
      >
        Resign
      </Button>
    );
  }

  return (
    <div
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setConfirming(false);
        }
      }}
    >
      <p className="mb-2 text-sm font-medium text-ink">Resign this game?</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          ref={confirmRef}
          variant="danger"
          size="sm"
          disabled={!canResign || pending}
          onClick={onResign}
        >
          {pending ? "Resigning…" : "Yes, resign"}
        </Button>
        <Button
          variant="quiet"
          size="sm"
          onClick={() => {
            setConfirming(false);
          }}
        >
          Keep playing
        </Button>
      </div>
      <p className={HINT}>Your opponent wins, whatever the board is worth.</p>
    </div>
  );
}
