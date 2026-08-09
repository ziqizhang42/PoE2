export const CREATE_KEY = "create";

export function joinKey(gameId: string): string {
  return `join:${gameId}`;
}
