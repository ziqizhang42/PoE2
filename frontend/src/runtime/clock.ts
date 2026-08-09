export type CancelTimer = () => void;

export interface Clock {
  now(): number;
  schedule(callback: () => void, delayMs: number): CancelTimer;
}

export const browserClock: Clock = {
  now: () => performance.now(),
  schedule(callback, delayMs) {
    const handle = setTimeout(callback, delayMs);
    return () => {
      clearTimeout(handle);
    };
  },
};
