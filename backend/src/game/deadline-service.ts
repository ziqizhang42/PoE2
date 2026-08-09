/** Schedules persisted deadlines; the locked database processor remains authoritative. */

import type { GameSnapshot } from "@poe2/protocol";

import type { MonotonicClock, Scheduler } from "../limits/clock.js";
import type { ActiveGameDeadline } from "./repository.js";
import type {
  DeadlineProcessingResult,
  DeadlineReservation,
  GameDeadlineController,
} from "./service.js";

const RETRY_AFTER_ERROR_MS = 1_000;

interface DeadlineEntry {
  readonly gameId: string;
  readonly deadline: Date;
  readonly generation: number;
  dueAtMs: number;
  inHeap: boolean;
}

export interface DeadlineServiceOptions {
  readonly capacity: number;
  readonly clock: MonotonicClock;
  readonly scheduler: Scheduler;
  readonly process: (gameId: string, expectedDeadline: Date) => Promise<DeadlineProcessingResult>;
  readonly onFinished: (game: GameSnapshot) => void | Promise<void>;
  /** Notifies the released player, who is absent from the reopened snapshot. */
  readonly onAbandoned: (game: GameSnapshot, releasedPlayerId: string) => void | Promise<void>;
  readonly onError?: (error: unknown) => void;
}

export interface DeadlineService extends GameDeadlineController {
  restore(entries: readonly ActiveGameDeadline[]): void;
  stop(): void;
  activeCount(): number;
  reservedCount(): number;
}

export function createDeadlineService(options: DeadlineServiceOptions): DeadlineService {
  if (!Number.isInteger(options.capacity) || options.capacity < 1) {
    throw new RangeError("deadline capacity must be a positive integer");
  }

  const onError = options.onError ?? (() => {});
  const entries = new Map<string, DeadlineEntry>();
  const heap: DeadlineEntry[] = [];
  const indexes = new Map<string, number>();
  let reservations = 0;
  let generation = 0;
  let cancelTimer: (() => void) | null = null;
  let stopped = false;

  const capacityUsed = (): number => entries.size + reservations;

  const removeTimer = (): void => {
    cancelTimer?.();
    cancelTimer = null;
  };

  const arm = (): void => {
    removeTimer();
    if (stopped) {
      return;
    }

    const next = heap[0];
    if (next === undefined) {
      return;
    }

    const expectedGeneration = next.generation;
    cancelTimer = options.scheduler.schedule(
      () => {
        cancelTimer = null;
        void fire(next.gameId, expectedGeneration);
      },
      Math.max(0, next.dueAtMs - options.clock.now()),
    );
  };

  const put = (gameId: string, deadline: Date, serverNow: Date): void => {
    const existing = entries.get(gameId);
    if (existing === undefined && capacityUsed() >= options.capacity) {
      throw new Error(`deadline capacity exhausted while installing game ${gameId}`);
    }
    if (existing?.inHeap === true) {
      removeHeap(gameId);
    }

    const entry: DeadlineEntry = {
      gameId,
      deadline,
      generation: ++generation,
      dueAtMs: options.clock.now() + Math.max(0, deadline.getTime() - serverNow.getTime()),
      inHeap: true,
    };
    entries.set(gameId, entry);
    pushHeap(entry);
    arm();
  };

  const fire = async (gameId: string, expectedGeneration: number): Promise<void> => {
    const entry = entries.get(gameId);
    if (
      entry === undefined ||
      entry.generation !== expectedGeneration ||
      !entry.inHeap ||
      stopped
    ) {
      return;
    }

    removeHeap(gameId);
    entry.inHeap = false;
    arm();

    let result: DeadlineProcessingResult;
    try {
      result = await options.process(gameId, entry.deadline);
    } catch (error) {
      onError(error);
      const current = entries.get(gameId);
      if (current?.generation === expectedGeneration && !stopped) {
        current.dueAtMs = options.clock.now() + RETRY_AFTER_ERROR_MS;
        current.inHeap = true;
        pushHeap(current);
        arm();
      }
      return;
    }

    const current = entries.get(gameId);
    if (current?.generation !== expectedGeneration) {
      return;
    }

    if (result.kind === "reschedule") {
      put(result.gameId, result.deadline, result.serverNow);
      return;
    }

    entries.delete(gameId);
    if (result.kind === "finished" || result.kind === "abandoned") {
      try {
        await (result.kind === "finished"
          ? options.onFinished(result.game)
          : options.onAbandoned(result.game, result.releasedPlayerId));
      } catch (error) {
        // Reconnect recovers committed state if publication fails.
        onError(error);
      }
    }
    arm();
  };

  function pushHeap(entry: DeadlineEntry): void {
    indexes.set(entry.gameId, heap.length);
    heap.push(entry);
    bubbleUp(heap.length - 1);
  }

  function removeHeap(gameId: string): void {
    const index = indexes.get(gameId);
    if (index === undefined) {
      return;
    }

    const last = heap.pop();
    indexes.delete(gameId);
    if (last === undefined || index === heap.length) {
      return;
    }

    heap[index] = last;
    indexes.set(last.gameId, index);
    if (!bubbleUp(index)) {
      bubbleDown(index);
    }
  }

  function bubbleUp(start: number): boolean {
    let index = start;
    let moved = false;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!before(heap[index], heap[parent])) {
        break;
      }
      swap(index, parent);
      index = parent;
      moved = true;
    }
    return moved;
  }

  function bubbleDown(start: number): void {
    let index = start;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let first = index;
      if (left < heap.length && before(heap[left], heap[first])) {
        first = left;
      }
      if (right < heap.length && before(heap[right], heap[first])) {
        first = right;
      }
      if (first === index) {
        return;
      }
      swap(index, first);
      index = first;
    }
  }

  function swap(left: number, right: number): void {
    const leftEntry = heap[left];
    const rightEntry = heap[right];
    if (leftEntry === undefined || rightEntry === undefined) {
      throw new Error("deadline heap index is out of range");
    }
    heap[left] = rightEntry;
    heap[right] = leftEntry;
    indexes.set(rightEntry.gameId, left);
    indexes.set(leftEntry.gameId, right);
  }

  return {
    reserve() {
      if (stopped || capacityUsed() >= options.capacity) {
        return null;
      }

      reservations += 1;
      let open = true;
      const close = (): boolean => {
        if (!open) {
          return false;
        }
        open = false;
        // Outstanding handles may unwind after stop() resets the aggregate count.
        if (!stopped) {
          reservations -= 1;
        }
        return true;
      };

      const reservation: DeadlineReservation = {
        commit(gameId, deadline, serverNow) {
          if (!close() || stopped) {
            return;
          }
          put(gameId, deadline, serverNow);
        },
        release() {
          close();
        },
      };
      return reservation;
    },

    replace(gameId, deadline, serverNow) {
      if (!stopped) {
        put(gameId, deadline, serverNow);
      }
    },

    remove(gameId) {
      const entry = entries.get(gameId);
      if (entry?.inHeap === true) {
        removeHeap(gameId);
      }
      entries.delete(gameId);
      arm();
    },

    restore(restored) {
      if (entries.size > 0 || reservations > 0) {
        throw new Error("deadlines may only be restored into an empty service");
      }
      if (restored.length > options.capacity) {
        throw new Error(
          `active timed games (${String(restored.length)}) exceed deadline capacity (${String(options.capacity)})`,
        );
      }

      for (const entry of restored) {
        put(entry.gameId, entry.deadline, entry.serverNow);
      }
    },

    stop() {
      stopped = true;
      removeTimer();
      heap.length = 0;
      indexes.clear();
      entries.clear();
      reservations = 0;
    },

    activeCount: () => entries.size,
    reservedCount: () => reservations,
  };
}

function before(left: DeadlineEntry | undefined, right: DeadlineEntry | undefined): boolean {
  if (left === undefined || right === undefined) {
    return false;
  }
  return left.dueAtMs === right.dueAtMs ? left.gameId < right.gameId : left.dueAtMs < right.dueAtMs;
}
