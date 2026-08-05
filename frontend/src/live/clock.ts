export type CancelTimer = () => void;

export interface LiveClock {
  /** Returns a canceller rather than a handle, so no timer type escapes. */
  schedule(callback: () => void, delayMs: number): CancelTimer;
}

export const browserClock: LiveClock = {
  schedule(callback, delayMs) {
    const handle = setTimeout(callback, delayMs);
    return () => {
      clearTimeout(handle);
    };
  },
};
