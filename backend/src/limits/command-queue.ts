/** Serial FIFO queue that isolates command failures and enforces a depth limit. */

export interface CommandQueueOptions {
  readonly maxDepth: number;
  readonly onError: (error: unknown) => void;
}

export interface CommandQueue {
  /** Returns false without enqueuing when at capacity. */
  enqueue(work: () => Promise<void>): boolean;
  depth(): number;
}

export function createCommandQueue(options: CommandQueueOptions): CommandQueue {
  if (!Number.isInteger(options.maxDepth) || options.maxDepth < 1) {
    throw new RangeError("maxDepth must be a positive integer");
  }

  let tail: Promise<void> = Promise.resolve();
  let depth = 0;

  return {
    enqueue(work) {
      if (depth >= options.maxDepth) {
        return false;
      }

      depth += 1;

      tail = tail.then(async () => {
        try {
          await work();
        } catch (error: unknown) {
          options.onError(error);
        } finally {
          depth -= 1;
        }
      });

      return true;
    },

    depth() {
      return depth;
    },
  };
}
