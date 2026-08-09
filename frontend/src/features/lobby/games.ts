const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function formatOpenedAt(createdAt: string, now: number): string {
  const started = Date.parse(createdAt);

  if (Number.isNaN(started)) {
    return "—";
  }

  const elapsed = Math.max(0, now - started);

  if (elapsed < MINUTE_MS) {
    return "just now";
  }
  if (elapsed < HOUR_MS) {
    return `${Math.floor(elapsed / MINUTE_MS)} min`;
  }
  if (elapsed < DAY_MS) {
    return `${Math.floor(elapsed / HOUR_MS)} h`;
  }

  return `${Math.floor(elapsed / DAY_MS)} d`;
}
