import { MAX_INCREMENT_MS, MAX_INITIAL_MS, MIN_INITIAL_MS, UNTIMED } from "@poe2/protocol";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_TIME_CONTROL_FIELDS,
  parseTimeControl,
  QUICK_CONTROLS,
  quickFill,
  type TimeControlFields,
} from "./time-control-form.ts";

function fields(overrides: Partial<TimeControlFields> = {}): TimeControlFields {
  return { untimed: false, minutes: "5", seconds: "0", increment: "3", ...overrides };
}

describe("parseTimeControl", () => {
  it("reads the untimed box before anything else, so stale digits cannot leak", () => {
    expect(parseTimeControl(fields({ untimed: true, minutes: "nonsense" }))).toEqual({
      ok: true,
      control: UNTIMED,
    });
  });

  it("adds the two boxes into one initial duration", () => {
    expect(parseTimeControl(fields({ minutes: "2", seconds: "30" }))).toEqual({
      ok: true,
      control: { kind: "timed", initialMs: 150_000, incrementMs: 3_000 },
    });
  });

  it("treats an empty box as zero", () => {
    expect(parseTimeControl(fields({ minutes: "3", seconds: "", increment: "" }))).toEqual({
      ok: true,
      control: { kind: "timed", initialMs: 180_000, incrementMs: 0 },
    });
  });

  it.each([
    ["minutes", fields({ minutes: "two" })],
    ["seconds", fields({ seconds: "-5" })],
    ["increment", fields({ increment: "1.5" })],
  ])("refuses %s that is not a whole count, and names the box", (field, input) => {
    const parsed = parseTimeControl(input);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.field).toBe(field);
  });

  it("refuses a clock shorter than a game can be played in", () => {
    const parsed = parseTimeControl(fields({ minutes: "0", seconds: "5" }));
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.field).toBe("seconds");
  });

  it("accepts exactly the shortest clock the protocol allows", () => {
    const parsed = parseTimeControl(
      fields({ minutes: "0", seconds: String(MIN_INITIAL_MS / 1_000) }),
    );
    expect(parsed.ok && parsed.control.initialMs).toBe(MIN_INITIAL_MS);
  });

  it("accepts exactly the longest clock the protocol allows", () => {
    const parsed = parseTimeControl(
      fields({
        minutes: String(MAX_INITIAL_MS / 60_000),
        seconds: "0",
        increment: String(MAX_INCREMENT_MS / 1_000),
      }),
    );
    expect(parsed.ok && parsed.control.initialMs).toBe(MAX_INITIAL_MS);
  });

  it.each([
    ["a clock past the ceiling", fields({ minutes: "181" }), "minutes"],
    ["an increment past the ceiling", fields({ increment: "181" }), "increment"],
  ])("refuses %s", (_label, input, field) => {
    const parsed = parseTimeControl(input);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.field).toBe(field);
  });

  it("opens on a clock that parses", () => {
    expect(DEFAULT_TIME_CONTROL_FIELDS.untimed).toBe(false);
    expect(parseTimeControl(DEFAULT_TIME_CONTROL_FIELDS).ok).toBe(true);
  });
});

describe("quickFill", () => {
  it.each(QUICK_CONTROLS)("turns $label into a control the same boxes would make", (quick) => {
    const filled = quickFill(quick);
    expect(filled.untimed).toBe(false);

    const parsed = parseTimeControl(filled);
    expect(parsed.ok && parsed.control).toEqual({
      kind: "timed",
      initialMs: (quick.minutes * 60 + quick.seconds) * 1_000,
      incrementMs: quick.increment * 1_000,
    });
  });
});
