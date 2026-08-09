import type { ReactNode } from "react";

import { STATUS_LAMPS, type StatusTone } from "./status-tone.ts";

const BORDERS: Record<StatusTone, string> = {
  info: "border-l-pen-1",
  wait: "border-l-ink-3",
  alarm: "border-l-pen-2",
};

type StatusNoteProps = {
  tone: StatusTone;
  title: string;
  detail?: string;
  /** `alert` interrupts; `status` waits for a pause. */
  live?: "status" | "alert" | "none";
  children?: ReactNode;
};

/**
 * The lamp is decorative: the title always states the condition in words, so
 * nothing here depends on telling the three colours apart.
 */
export function StatusNote({ tone, title, detail, live = "status", children }: StatusNoteProps) {
  return (
    <div
      {...(live === "none" ? {} : { role: live })}
      className={`flex items-start gap-3 rounded-lg border-l-[3px] bg-surface p-4 shadow-lift ${BORDERS[tone]}`}
    >
      <span
        className={`mt-1.5 h-2.5 w-2.5 flex-none rounded-full ${STATUS_LAMPS[tone]}`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <b className="block text-sm leading-snug font-semibold">{title}</b>
        {detail === undefined ? null : (
          <span className="block text-xs leading-relaxed text-ink-2">{detail}</span>
        )}
        {children}
      </div>
    </div>
  );
}
