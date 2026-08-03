import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password.js";

const PASSWORD = "correct horse battery staple";

describe("password hashing", () => {
  it("hashes and verifies a password", async () => {
    const encodedHash = await hashPassword(PASSWORD);

    expect(encodedHash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$/u);
    expect(encodedHash).not.toContain(PASSWORD);
    await expect(verifyPassword(PASSWORD, encodedHash)).resolves.toBe(true);
    await expect(verifyPassword("incorrect password", encodedHash)).resolves.toBe(false);
  });

  it("uses a unique salt for every hash", async () => {
    const firstHash = await hashPassword(PASSWORD);
    const secondHash = await hashPassword(PASSWORD);

    expect(firstHash).not.toBe(secondHash);
  });

  it.each([
    "",
    "plain text",
    "$argon2id$v=19$m=65536,t=3,p=4$invalid$invalid",
    "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA",
  ])("rejects malformed or unsupported hash %s", async (encodedHash) => {
    await expect(verifyPassword(PASSWORD, encodedHash)).resolves.toBe(false);
  });
});
