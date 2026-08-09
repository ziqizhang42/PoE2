/** Opaque, validated history position. It is an encoding, not a secret. */

import { Buffer } from "node:buffer";

import { z } from "zod";

export interface HistoryCursor {
  readonly finishedAt: Date;
  readonly id: string;
}

const cursorPayloadSchema = z.strictObject({
  f: z.iso.datetime(),
  i: z.uuid(),
});

export function encodeHistoryCursor(cursor: HistoryCursor): string {
  const payload = { f: cursor.finishedAt.toISOString(), i: cursor.id };

  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeHistoryCursor(encoded: string): HistoryCursor | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  const payload = cursorPayloadSchema.safeParse(parsed);
  if (!payload.success) {
    return null;
  }

  const finishedAt = new Date(payload.data.f);

  // Schema shape validation does not reject every impossible calendar date.
  return Number.isNaN(finishedAt.getTime()) ? null : { finishedAt, id: payload.data.i };
}
