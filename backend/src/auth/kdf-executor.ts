/**
 * Argon2 is deliberately expensive in both CPU and memory. Node.js runs it on
 * the libuv threadpool, so an unbounded number of concurrent password
 * operations would exhaust that pool (starving every other threadpool user,
 * including DNS and file I/O) and multiply the configured Argon2 memory cost by
 * the number of in-flight requests.
 *
 * This executor puts an explicit ceiling on both dimensions: how many
 * operations may run at once, and how many may wait. It is constructed and
 * injected rather than living in module state, so tests can build their own
 * with deterministic limits.
 */

/** Thrown when the queue is full, so the caller should shed load immediately. */
export class KdfCapacityError extends Error {
  constructor() {
    super("Password hashing capacity is exhausted");
    this.name = "KdfCapacityError";
  }
}

export function isKdfCapacityError(error: unknown): error is KdfCapacityError {
  return error instanceof KdfCapacityError;
}

export interface KdfExecutor {
  /**
   * Runs `operation` once capacity is available.
   *
   * Rejects with a {@link KdfCapacityError} without ever starting `operation`
   * when the queue is already full.
   */
  run<T>(operation: () => Promise<T>): Promise<T>;
}

export interface KdfExecutorOptions {
  /** Maximum operations running at the same time. */
  readonly maxConcurrent: number;
  /** Maximum operations waiting for a slot. */
  readonly maxQueued: number;
}

export function createKdfExecutor(options: KdfExecutorOptions): KdfExecutor {
  if (!Number.isInteger(options.maxConcurrent) || options.maxConcurrent < 1) {
    throw new RangeError("maxConcurrent must be a positive integer");
  }

  if (!Number.isInteger(options.maxQueued) || options.maxQueued < 0) {
    throw new RangeError("maxQueued must be a non-negative integer");
  }

  const queue: Array<() => void> = [];
  let active = 0;

  function releaseSlot(): void {
    active -= 1;

    // FIFO: the operation that has waited longest starts first.
    const startNext = queue.shift();
    startNext?.();
  }

  // `async` so an operation that throws synchronously still releases its slot.
  async function runNow<T>(operation: () => Promise<T>): Promise<T> {
    active += 1;

    try {
      return await operation();
    } finally {
      releaseSlot();
    }
  }

  return {
    run(operation) {
      if (active < options.maxConcurrent) {
        return runNow(operation);
      }

      if (queue.length >= options.maxQueued) {
        return Promise.reject(new KdfCapacityError());
      }

      return new Promise((resolve) => {
        queue.push(() => {
          resolve(runNow(operation));
        });
      });
    },
  };
}
