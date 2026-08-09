/** Injectable monotonic time and scheduling seams. */

export interface MonotonicClock {
  /** Milliseconds from an arbitrary monotonic origin. */
  now(): number;
}

export const systemClock: MonotonicClock = {
  now() {
    return performance.now();
  },
};

export interface Scheduler {
  schedule(callback: () => void, delayMs: number): () => void;
}

export const systemScheduler: Scheduler = {
  schedule(callback, delayMs) {
    // `unref` so a pending reservation timeout never holds the process open.
    const handle = setTimeout(callback, delayMs);
    handle.unref();

    return () => {
      clearTimeout(handle);
    };
  },
};
