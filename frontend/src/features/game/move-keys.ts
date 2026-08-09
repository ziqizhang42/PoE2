import { formatSquare, parseSquare, type Square } from "@poe2/rules";

const MOVE_PREFIX = "move:";

export function moveKey(square: Square): string {
  return `${MOVE_PREFIX}${formatSquare(square)}`;
}

/** Recovers the pending square from the command runner's single key. */
export function pendingMoveSquare(pending: string | null): Square | null {
  if (pending === null || !pending.startsWith(MOVE_PREFIX)) {
    return null;
  }
  return parseSquare(pending.slice(MOVE_PREFIX.length));
}
