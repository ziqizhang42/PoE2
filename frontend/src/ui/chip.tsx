import type { ReactNode } from "react";

type ChipTone = "neutral" | "player-1" | "player-2";

const TONES: Record<ChipTone, string> = {
  neutral: "bg-sunken text-ink-2",
  "player-1": "bg-pen-1-soft text-pen-1-text",
  "player-2": "bg-pen-2-soft text-pen-2-text",
};

export function Chip({ tone = "neutral", children }: { tone?: ChipTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs leading-none font-medium whitespace-nowrap ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
