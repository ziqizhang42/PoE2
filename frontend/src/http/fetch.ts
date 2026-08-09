export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const OK = 200;
export const CREATED = 201;
export const NO_CONTENT = 204;
export const BAD_REQUEST = 400;
export const UNAUTHORIZED = 401;
export const NOT_FOUND = 404;

export function browserFetch(input: string, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init);
}

/** Accepts only the delta-seconds form emitted by these routes. */
export function parseRetryAfterSeconds(header: string | null): number | null {
  if (header === null) {
    return null;
  }

  const trimmed = header.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const seconds = Number(trimmed);
  return Number.isInteger(seconds) && seconds >= 0 ? seconds : null;
}

export async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

/** Structural check covers DOMException implementations not derived from Error. */
export function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return false;
  }

  const { name } = error;
  return name === "AbortError";
}

export function jsonHeaders(): HeadersInit {
  return { accept: "application/json" };
}
