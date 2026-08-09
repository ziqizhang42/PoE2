/** Shared modal with focus entry, restoration, and tab containment. */

import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function Modal({
  labelledBy,
  panelClassName = "",
  onDismiss,
  children,
}: {
  readonly labelledBy: string;
  readonly panelClassName?: string;
  /** Omit to disable Escape and backdrop dismissal. */
  readonly onDismiss?: () => void;
  readonly children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  // Move focus only on open, not when dialog contents change.
  useEffect(() => {
    const returnTo = document.activeElement;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();

    return () => {
      if (returnTo instanceof HTMLElement && returnTo.isConnected) {
        returnTo.focus();
      }
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/35 p-4 backdrop-blur-[2px]"
      onPointerDown={(event) => {
        // Ignore drags that began inside the panel.
        if (event.target === event.currentTarget) {
          onDismiss?.();
        }
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`w-full max-w-sm rounded-lg border border-card-line bg-surface p-5 shadow-lift-2 outline-none sm:p-6 ${panelClassName}`}
        onKeyDown={(event) => {
          if (event.key === "Escape" && onDismiss !== undefined) {
            event.stopPropagation();
            onDismiss();
            return;
          }
          if (event.key !== "Tab") {
            return;
          }

          const stops = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
          if (stops.length === 0) {
            // A reconnect can disable every control. Keep focus inside the
            // aria-modal until one becomes available again.
            event.preventDefault();
            panel.current?.focus();
            return;
          }
          const edge = event.shiftKey ? stops.at(0) : stops.at(-1);
          if (document.activeElement !== edge) {
            return;
          }
          // Wrap focus instead of letting Tab reach the page underneath.
          event.preventDefault();
          (event.shiftKey ? stops.at(-1) : stops.at(0))?.focus();
        }}
      >
        {children}
      </div>
    </div>
  );
}
