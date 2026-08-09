import type { MonotonicClock, Scheduler } from "./clock.js";

export interface FakeClock extends MonotonicClock {
  advance(ms: number): void;
}

export function createFakeClock(startMs = 0): FakeClock {
  let current = startMs;

  return {
    now() {
      return current;
    },
    advance(ms) {
      current += ms;
    },
  };
}

export interface FakeTimer {
  readonly delayMs: number;
  readonly cancelled: boolean;
  readonly fired: boolean;
}

export interface FakeScheduler extends Scheduler {
  pending(): readonly FakeTimer[];
  fireAll(): void;
}

interface MutableTimer {
  readonly callback: () => void;
  readonly delayMs: number;
  cancelled: boolean;
  fired: boolean;
}

export function createFakeScheduler(): FakeScheduler {
  const timers: MutableTimer[] = [];

  return {
    schedule(callback, delayMs) {
      const timer: MutableTimer = { callback, delayMs, cancelled: false, fired: false };
      timers.push(timer);

      return () => {
        timer.cancelled = true;
      };
    },

    pending() {
      return timers
        .filter((timer) => !timer.cancelled && !timer.fired)
        .map((timer) => ({ delayMs: timer.delayMs, cancelled: false, fired: false }));
    },

    fireAll() {
      for (const timer of timers) {
        if (timer.cancelled || timer.fired) {
          continue;
        }

        timer.fired = true;
        timer.callback();
      }
    },
  };
}
