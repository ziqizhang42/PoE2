import type { Scheduler } from "../clock.js";
import type {
  ConnectionAdmission,
  ConnectionKey,
  ConnectionRegistry,
} from "../connection-registry.js";

export interface MemoryConnectionRegistryOptions {
  readonly maxPerUser: number;
  readonly maxPerAddress: number;
  readonly claimTimeoutMs: number;
  readonly scheduler: Scheduler;
}

export interface MemoryConnectionRegistry extends ConnectionRegistry {
  countForUser(userId: string): number;
  countForAddress(address: string): number;
}

export function createMemoryConnectionRegistry(
  options: MemoryConnectionRegistryOptions,
): MemoryConnectionRegistry {
  if (!Number.isInteger(options.maxPerUser) || options.maxPerUser < 1) {
    throw new RangeError("maxPerUser must be a positive integer");
  }
  if (!Number.isInteger(options.maxPerAddress) || options.maxPerAddress < 1) {
    throw new RangeError("maxPerAddress must be a positive integer");
  }

  const byUser = new Map<string, number>();
  const byAddress = new Map<string, number>();

  const countIn = (counts: Map<string, number>, key: string): number => counts.get(key) ?? 0;

  const take = (counts: Map<string, number>, key: string): void => {
    counts.set(key, countIn(counts, key) + 1);
  };

  const give = (counts: Map<string, number>, key: string): void => {
    const remaining = countIn(counts, key) - 1;

    if (remaining > 0) {
      counts.set(key, remaining);
    } else {
      counts.delete(key);
    }
  };

  const reserve = (key: ConnectionKey): ConnectionAdmission | null => {
    if (
      countIn(byUser, key.userId) >= options.maxPerUser ||
      countIn(byAddress, key.address) >= options.maxPerAddress
    ) {
      return null;
    }

    take(byUser, key.userId);
    take(byAddress, key.address);

    let state: "reserved" | "claimed" | "released" = "reserved";
    // Initialize before `release` closes over it; test schedulers may fire synchronously.
    let cancelTimeout: () => void = () => {};

    const release = (): void => {
      // The claim timeout and socket close may race.
      if (state === "released") {
        return;
      }

      state = "released";
      cancelTimeout();
      give(byUser, key.userId);
      give(byAddress, key.address);
    };

    cancelTimeout = options.scheduler.schedule(release, options.claimTimeoutMs);

    return {
      claim() {
        if (state !== "reserved") {
          return false;
        }
        state = "claimed";
        cancelTimeout();
        return true;
      },
      release,
    };
  };

  return {
    admit(key) {
      return Promise.resolve(reserve(key));
    },

    countForUser(userId) {
      return countIn(byUser, userId);
    },

    countForAddress(address) {
      return countIn(byAddress, address);
    },
  };
}
