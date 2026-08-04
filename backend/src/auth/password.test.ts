import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { createKdfExecutor, type KdfExecutor } from "./kdf-executor.js";
import {
  createPasswordHasher,
  CURRENT_PASSWORD_POLICY,
  derivePassword,
  encodePasswordHash,
  parsePasswordHash,
  type PasswordPolicy,
} from "./password.js";

const PASSWORD = "correct horse battery staple";

/**
 * A parameter set that predates the current policy: cheaper, and using the
 * smallest salt and tag the parser accepts, so both a cost change and a length
 * change are covered.
 */
const LEGACY_POLICY: PasswordPolicy = {
  memoryKiB: 19_456,
  passes: 2,
  parallelism: 1,
  saltBytes: 16,
  tagBytes: 32,
};

const executor = createKdfExecutor({ maxConcurrent: 2, maxQueued: 16 });
const hasher = createPasswordHasher(executor);

async function hashUnder(policy: PasswordPolicy, password: string): Promise<string> {
  const salt = randomBytes(policy.saltBytes);
  const tag = await derivePassword(password, salt, policy);

  return encodePasswordHash(policy, salt, tag);
}

describe("password hashing", () => {
  it("hashes and verifies a password under the current policy", async () => {
    const encodedHash = await hasher.hash(PASSWORD);

    expect(encodedHash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$/u);
    expect(encodedHash).not.toContain(PASSWORD);
    await expect(hasher.verify(PASSWORD, encodedHash)).resolves.toEqual({
      outcome: "verified",
      needsRehash: false,
    });
  });

  it("rejects an incorrect password", async () => {
    const encodedHash = await hasher.hash(PASSWORD);

    await expect(hasher.verify("incorrect password", encodedHash)).resolves.toEqual({
      outcome: "mismatch",
      storedPolicyIsCurrent: true,
    });
  });

  it("uses a unique salt for every hash", async () => {
    const firstHash = await hasher.hash(PASSWORD);
    const secondHash = await hasher.hash(PASSWORD);

    expect(firstHash).not.toBe(secondHash);
  });

  it("verifies an older parameter set using the parameters stored with it", async () => {
    const legacyHash = await hashUnder(LEGACY_POLICY, PASSWORD);

    expect(legacyHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/u);
    await expect(hasher.verify(PASSWORD, legacyHash)).resolves.toEqual({
      outcome: "verified",
      needsRehash: true,
    });
    // Flagged as not-current so the caller can even out the cheaper work this
    // rejection just cost.
    await expect(hasher.verify("incorrect password", legacyHash)).resolves.toEqual({
      outcome: "mismatch",
      storedPolicyIsCurrent: false,
    });
  });

  it.each([
    { name: "a larger salt", policy: { ...CURRENT_PASSWORD_POLICY, saltBytes: 32 } },
    { name: "a larger tag", policy: { ...CURRENT_PASSWORD_POLICY, tagBytes: 64 } },
    { name: "more passes", policy: { ...CURRENT_PASSWORD_POLICY, passes: 4 } },
  ])("reports that $name needs rehashing", async ({ policy }) => {
    const encodedHash = await hashUnder(policy, PASSWORD);

    await expect(hasher.verify(PASSWORD, encodedHash)).resolves.toEqual({
      outcome: "verified",
      needsRehash: true,
    });
  });

  it("propagates capacity exhaustion instead of reporting a failed verification", async () => {
    const saturated = createKdfExecutor({ maxConcurrent: 1, maxQueued: 0 });
    const saturatedHasher = createPasswordHasher(saturated);
    const encodedHash = await hasher.hash(PASSWORD);

    const blocking = saturatedHasher.hash(PASSWORD);

    await expect(saturatedHasher.verify(PASSWORD, encodedHash)).rejects.toThrow(
      "Password hashing capacity is exhausted",
    );

    await blocking;
  });
});

describe("stored hash parsing", () => {
  const validSalt = "A".repeat(24); // 24 base64 characters decode to 18 bytes
  const validTag = "B".repeat(44); // 44 base64 characters decode to 33 bytes

  it("parses the parameters stored with a hash", async () => {
    const encodedHash = await hashUnder(LEGACY_POLICY, PASSWORD);
    const parsed = parsePasswordHash(encodedHash);

    expect(parsed?.policy).toEqual(LEGACY_POLICY);
    expect(parsed?.salt).toHaveLength(LEGACY_POLICY.saltBytes);
    expect(parsed?.tag).toHaveLength(LEGACY_POLICY.tagBytes);
  });

  it.each([
    ["empty", ""],
    ["plain text", "plain text"],
    ["a bcrypt hash", "$2b$12$abcdefghijklmnopqrstuv"],
    ["a scrypt hash", "$scrypt$ln=16,r=8,p=1$c2FsdA$aGFzaA"],
    ["another argon2 variant", `$argon2i$v=19$m=65536,t=3,p=4$${validSalt}$${validTag}`],
    ["an unsupported version", `$argon2id$v=16$m=65536,t=3,p=4$${validSalt}$${validTag}`],
    ["a missing version", `$argon2id$m=65536,t=3,p=4$${validSalt}$${validTag}`],
    ["reordered parameters", `$argon2id$v=19$t=3,m=65536,p=4$${validSalt}$${validTag}`],
    ["a missing field", `$argon2id$v=19$m=65536,t=3,p=4$${validSalt}`],
    ["a trailing field", `$argon2id$v=19$m=65536,t=3,p=4$${validSalt}$${validTag}$extra`],
    ["a non-numeric cost", `$argon2id$v=19$m=lots,t=3,p=4$${validSalt}$${validTag}`],
    ["a negative cost", `$argon2id$v=19$m=-65536,t=3,p=4$${validSalt}$${validTag}`],
    ["a padded cost", `$argon2id$v=19$m=065536,t=3,p=4$${validSalt}$${validTag}`],
    ["memory one above the bound", `$argon2id$v=19$m=262145,t=3,p=4$${validSalt}$${validTag}`],
    [
      "memory with more digits than allowed",
      `$argon2id$v=19$m=4294967296,t=3,p=4$${validSalt}$${validTag}`,
    ],
    ["memory below the bound", `$argon2id$v=19$m=1024,t=3,p=4$${validSalt}$${validTag}`],
    ["passes beyond the bound", `$argon2id$v=19$m=65536,t=1000,p=4$${validSalt}$${validTag}`],
    ["zero passes", `$argon2id$v=19$m=65536,t=0,p=4$${validSalt}$${validTag}`],
    ["parallelism beyond the bound", `$argon2id$v=19$m=65536,t=3,p=64$${validSalt}$${validTag}`],
    ["zero parallelism", `$argon2id$v=19$m=65536,t=3,p=0$${validSalt}$${validTag}`],
    ["a short salt", `$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$${validTag}`],
    ["a short tag", `$argon2id$v=19$m=65536,t=3,p=4$${validSalt}$aGFzaA`],
    ["an over-long salt", `$argon2id$v=19$m=65536,t=3,p=4$${"C".repeat(96)}$${validTag}`],
    ["an over-long tag", `$argon2id$v=19$m=65536,t=3,p=4$${validSalt}$${"D".repeat(96)}`],
    ["non-base64 encoding", `$argon2id$v=19$m=65536,t=3,p=4$not base64!$${validTag}`],
    ["padded base64", `$argon2id$v=19$m=65536,t=3,p=4$${"A".repeat(22)}==$${validTag}`],
  ])("rejects %s", (_name, encodedHash) => {
    expect(parsePasswordHash(encodedHash)).toBeNull();
  });

  it.each([
    ["salt", 8_000_000, 44],
    ["tag", 24, 8_000_000],
  ])("rejects a huge but alphabet-valid %s without decoding it", (_field, saltSize, tagSize) => {
    // `password_hash` is unbounded `text`, so a tampered row could hold
    // megabytes of valid base64. Rejection has to happen on length, before
    // `Buffer.from` allocates the decoded field.
    const encodedHash = `$argon2id$v=19$m=65536,t=3,p=4$${"A".repeat(saltSize)}$${"B".repeat(tagSize)}`;

    expect(encodedHash.length).toBeGreaterThan(1_000_000);
    expect(parsePasswordHash(encodedHash)).toBeNull();
  });

  it("accepts the longest hash the parameter bounds allow", () => {
    // Guards the ceiling from being tightened below a legitimate hash. Only the
    // encoded length is under test, so the salt and tag are filled rather than
    // derived.
    const largest: PasswordPolicy = {
      memoryKiB: 262_144,
      passes: 10,
      parallelism: 16,
      saltBytes: 64,
      tagBytes: 64,
    };
    const encoded = encodePasswordHash(
      largest,
      Buffer.alloc(largest.saltBytes, 1),
      Buffer.alloc(largest.tagBytes, 2),
    );

    expect(parsePasswordHash(encoded)?.policy).toEqual(largest);
  });
});

describe("verification of an unsafe stored hash", () => {
  let calls = 0;
  const countingExecutor: KdfExecutor = {
    run(operation) {
      calls += 1;
      return operation();
    },
  };
  const countingHasher = createPasswordHasher(countingExecutor);

  beforeAll(() => {
    calls = 0;
  });

  it.each([
    "",
    "plain text",
    "$argon2id$v=19$m=65536,t=3,p=4$invalid$invalid",
    "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA",
    `$argon2id$v=19$m=262145,t=3,p=4$${"A".repeat(24)}$${"B".repeat(44)}`,
    `$argon2id$v=19$m=65536,t=999999,p=4$${"A".repeat(24)}$${"B".repeat(44)}`,
  ])("rejects %s as unusable without invoking Argon2", async (encodedHash) => {
    // `unusable_hash`, not `mismatch`: the caller must be able to tell a corrupt
    // row from a wrong password, because only the former needs reporting and
    // compensating work.
    await expect(countingHasher.verify(PASSWORD, encodedHash)).resolves.toEqual({
      outcome: "unusable_hash",
    });
    expect(calls).toBe(0);
  });
});

describe("encodePasswordHash", () => {
  it("round-trips through the parser", () => {
    const salt = Buffer.alloc(CURRENT_PASSWORD_POLICY.saltBytes, 1);
    const tag = Buffer.alloc(CURRENT_PASSWORD_POLICY.tagBytes, 2);
    const encoded = encodePasswordHash(CURRENT_PASSWORD_POLICY, salt, tag);
    const parsed = parsePasswordHash(encoded);

    expect(parsed?.policy).toEqual(CURRENT_PASSWORD_POLICY);
    expect(parsed?.salt).toEqual(salt);
    expect(parsed?.tag).toEqual(tag);
  });
});
