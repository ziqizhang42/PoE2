import {
  MAX_INCREMENT_MS,
  MAX_INITIAL_MS,
  MIN_INITIAL_MS,
  UNTIMED,
  timedControl,
  type TimeControl,
} from "@poe2/protocol";

export type TimeControlField = "minutes" | "seconds" | "increment";

export interface TimeControlFields {
  readonly untimed: boolean;
  readonly minutes: string;
  readonly seconds: string;
  readonly increment: string;
}

export type TimeControlParse =
  | { readonly ok: true; readonly control: TimeControl }
  | { readonly ok: false; readonly field: TimeControlField; readonly message: string };

export const DEFAULT_TIME_CONTROL_FIELDS: TimeControlFields = {
  untimed: false,
  minutes: "5",
  seconds: "0",
  increment: "3",
};

export const QUICK_CONTROLS: readonly {
  readonly label: string;
  readonly minutes: number;
  readonly seconds: number;
  readonly increment: number;
}[] = [
  { label: "10 + 5", minutes: 10, seconds: 0, increment: 5 },
  { label: "5 + 3", minutes: 5, seconds: 0, increment: 3 },
  { label: "3 + 2", minutes: 3, seconds: 0, increment: 2 },
  { label: "1 + 0", minutes: 1, seconds: 0, increment: 0 },
];

export function quickFill(quick: (typeof QUICK_CONTROLS)[number]): TimeControlFields {
  return {
    untimed: false,
    minutes: String(quick.minutes),
    seconds: String(quick.seconds),
    increment: String(quick.increment),
  };
}

function wholeCount(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") {
    return 0;
  }
  if (!/^\d+$/u.test(trimmed)) {
    return null;
  }
  return Number(trimmed);
}

export function parseTimeControl(fields: TimeControlFields): TimeControlParse {
  if (fields.untimed) {
    return { ok: true, control: UNTIMED };
  }

  const minutes = wholeCount(fields.minutes);
  if (minutes === null) {
    return { ok: false, field: "minutes", message: "Minutes must be a whole number." };
  }

  const seconds = wholeCount(fields.seconds);
  if (seconds === null) {
    return { ok: false, field: "seconds", message: "Seconds must be a whole number." };
  }

  const increment = wholeCount(fields.increment);
  if (increment === null) {
    return { ok: false, field: "increment", message: "Increment must be a whole number." };
  }

  const initialMs = (minutes * 60 + seconds) * 1_000;
  if (initialMs < MIN_INITIAL_MS) {
    return {
      ok: false,
      field: "seconds",
      message: `Each player needs at least ${describe(MIN_INITIAL_MS)} to start with.`,
    };
  }
  if (initialMs > MAX_INITIAL_MS) {
    return {
      ok: false,
      field: "minutes",
      message: `A clock cannot start above ${describe(MAX_INITIAL_MS)}.`,
    };
  }

  const incrementMs = increment * 1_000;
  if (incrementMs > MAX_INCREMENT_MS) {
    return {
      ok: false,
      field: "increment",
      message: `An increment cannot be above ${describe(MAX_INCREMENT_MS)}.`,
    };
  }

  const control = timedControl(initialMs, incrementMs);
  if (control === null) {
    // Fail safely if the field checks ever drift from the shared schema.
    return {
      ok: false,
      field: "minutes",
      message: "That is not a time control this server takes.",
    };
  }

  return { ok: true, control };
}

function describe(milliseconds: number): string {
  const seconds = milliseconds / 1_000;
  if (seconds % 3_600 === 0) {
    return `${String(seconds / 3_600)} hours`;
  }
  if (seconds % 60 === 0) {
    return `${String(seconds / 60)} minutes`;
  }
  return `${String(seconds)} seconds`;
}
