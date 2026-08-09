export type StatusTone = "info" | "wait" | "alarm";

export const STATUS_LAMPS: Record<StatusTone, string> = {
  info: "bg-pen-1",
  wait: "bg-ink-3",
  alarm: "bg-pen-2",
};
