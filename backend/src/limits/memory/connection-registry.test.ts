import { describe, expect, it } from "vitest";

import { createFakeScheduler } from "../test-doubles.js";
import {
  createMemoryConnectionRegistry,
  type MemoryConnectionRegistryOptions,
} from "./connection-registry.js";

const USER = "user-one";
const ADDRESS = "198.51.100.7";

function build(overrides: Partial<MemoryConnectionRegistryOptions> = {}) {
  const scheduler = createFakeScheduler();
  const registry = createMemoryConnectionRegistry({
    maxPerUser: 2,
    maxPerAddress: 3,
    claimTimeoutMs: 5_000,
    scheduler,
    ...overrides,
  });

  return { scheduler, registry };
}

describe("in-memory connection registry", () => {
  it("admits up to the per-user cap and then refuses", async () => {
    const { registry } = build();

    expect(await registry.admit({ userId: USER, address: ADDRESS })).not.toBeNull();
    expect(await registry.admit({ userId: USER, address: ADDRESS })).not.toBeNull();
    expect(await registry.admit({ userId: USER, address: ADDRESS })).toBeNull();
  });

  it("caps one address across different accounts", async () => {
    const { registry } = build({ maxPerUser: 5, maxPerAddress: 2 });

    expect(await registry.admit({ userId: "a", address: ADDRESS })).not.toBeNull();
    expect(await registry.admit({ userId: "b", address: ADDRESS })).not.toBeNull();
    expect(await registry.admit({ userId: "c", address: ADDRESS })).toBeNull();
    expect(await registry.admit({ userId: "c", address: "203.0.113.9" })).not.toBeNull();
  });

  it("frees the slot when a socket closes", async () => {
    const { registry } = build();

    const first = await registry.admit({ userId: USER, address: ADDRESS });
    await registry.admit({ userId: USER, address: ADDRESS });
    expect(await registry.admit({ userId: USER, address: ADDRESS })).toBeNull();

    expect(first?.claim()).toBe(true);
    first?.release();

    expect(registry.countForUser(USER)).toBe(1);
    expect(await registry.admit({ userId: USER, address: ADDRESS })).not.toBeNull();
  });

  it("holds the slot on a reservation timer until it is claimed", async () => {
    const { scheduler, registry } = build();

    await registry.admit({ userId: USER, address: ADDRESS });

    expect(scheduler.pending()).toHaveLength(1);
    expect(scheduler.pending().at(0)?.delayMs).toBe(5_000);
  });

  it("frees a reservation nobody claimed, for an upgrade that never arrived", async () => {
    const { scheduler, registry } = build();

    await registry.admit({ userId: USER, address: ADDRESS });
    expect(registry.countForUser(USER)).toBe(1);

    scheduler.fireAll();

    expect(registry.countForUser(USER)).toBe(0);
    expect(registry.countForAddress(ADDRESS)).toBe(0);
  });

  it("stops the reservation timer once a socket claims the slot", async () => {
    const { scheduler, registry } = build();

    const admission = await registry.admit({ userId: USER, address: ADDRESS });
    expect(admission?.claim()).toBe(true);

    expect(scheduler.pending()).toHaveLength(0);

    scheduler.fireAll();
    expect(registry.countForUser(USER)).toBe(1);
  });

  it("refuses to claim a reservation after its timer released the slot", async () => {
    const { scheduler, registry } = build();

    const admission = await registry.admit({ userId: USER, address: ADDRESS });
    scheduler.fireAll();

    expect(admission?.claim()).toBe(false);
    expect(registry.countForUser(USER)).toBe(0);
    expect(registry.countForAddress(ADDRESS)).toBe(0);
  });

  it("gives a slot back exactly once however many times it is released", async () => {
    const { scheduler, registry } = build();

    const first = await registry.admit({ userId: USER, address: ADDRESS });
    const second = await registry.admit({ userId: USER, address: ADDRESS });
    expect(second?.claim()).toBe(true);

    first?.release();
    first?.release();
    scheduler.fireAll();

    expect(registry.countForUser(USER)).toBe(1);
    expect(registry.countForAddress(ADDRESS)).toBe(1);
  });

  it("stops tracking an address once nothing holds it", async () => {
    const { registry } = build();

    const admission = await registry.admit({ userId: USER, address: ADDRESS });
    admission?.release();

    expect(registry.countForAddress(ADDRESS)).toBe(0);
  });

  it("refuses nonsense configuration outright", () => {
    expect(() => build({ maxPerUser: 0 })).toThrow(RangeError);
    expect(() => build({ maxPerAddress: 0 })).toThrow(RangeError);
  });
});
