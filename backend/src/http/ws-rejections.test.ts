import { WsErrorCodeSchema, WS_ERROR_CODES } from "@poe2/protocol";
import { describe, expect, it } from "vitest";

import { REJECTION_MESSAGES } from "./ws.js";

/** Runtime guard that the server rejection map and Zod enum accept identical codes. */
describe("rejection code coverage", () => {
  it("can put every rejection the server can send on the wire", () => {
    for (const code of Object.keys(REJECTION_MESSAGES)) {
      expect(WsErrorCodeSchema.safeParse(code).success, `${code} is not in the wire schema`).toBe(
        true,
      );
    }
  });

  it("has wording for every code the wire schema accepts", () => {
    for (const code of WS_ERROR_CODES) {
      expect(REJECTION_MESSAGES[code]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("describes the same number of codes on both sides", () => {
    expect(Object.keys(REJECTION_MESSAGES)).toHaveLength(WS_ERROR_CODES.length);
  });
});
