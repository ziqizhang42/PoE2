import type { TimeControl } from "@poe2/protocol";

export function formatTimeControl(control: TimeControl): string {
  if (control.kind === "untimed") {
    return "Untimed";
  }
  if (control.incrementMs === 0) {
    return `${formatDuration(control.initialMs)}, no increment`;
  }
  return `${formatDuration(control.initialMs)} + ${formatDuration(control.incrementMs)}/move`;
}

/** Formats protocol-valid whole-second durations in their largest useful unit. */
export function formatDuration(milliseconds: number): string {
  if (milliseconds % 1_000 !== 0) {
    return `${String(milliseconds)} ms`;
  }

  const totalSeconds = milliseconds / 1_000;
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${String(hours)} h`);
  }
  if (minutes > 0) {
    parts.push(`${String(minutes)} min`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${String(seconds)} sec`);
  }
  return parts.join(" ");
}

/** Formats short move durations with tenths, unlike countdown balances. */
export function formatMoveTime(milliseconds: number): string {
  const safe = Math.max(0, milliseconds);
  return safe < 60_000 ? `${(safe / 1_000).toFixed(1)}s` : formatClock(safe);
}

export function formatClock(milliseconds: number): string {
  const seconds = Math.ceil(Math.max(0, milliseconds) / 1_000);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}:${String(seconds % 60).padStart(2, "0")}`;
}
