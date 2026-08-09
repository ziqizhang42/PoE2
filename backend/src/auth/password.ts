import { Buffer } from "node:buffer";
import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

import type { KdfExecutor } from "./kdf-executor.js";

/**
 * The Argon2id cost parameters new hashes are written with. Changing these must
 * not lock existing users out, so every stored hash carries the parameters it
 * was produced with and is verified using those, then transparently upgraded on
 * the next successful login.
 */
export const CURRENT_PASSWORD_POLICY: PasswordPolicy = {
  memoryKiB: 65_536,
  passes: 3,
  parallelism: 4,
  saltBytes: 16,
  tagBytes: 32,
};

/** The only Argon2 version Node.js implements, and the only one accepted here. */
const ARGON2_VERSION = 19;

/**
 * Bounds every stored parameter is checked against before Argon2 is invoked. A
 * database value is untrusted input.
 */
const PARAMETER_BOUNDS = {
  memoryKiB: { min: 8_192, max: 262_144 },
  passes: { min: 1, max: 10 },
  parallelism: { min: 1, max: 16 },
  saltBytes: { min: 16, max: 64 },
  tagBytes: { min: 32, max: 64 },
} as const;

/** Digits only, no sign, no leading zero, and short enough not to overflow. */
const PARAMETER_NUMBER_PATTERN = /^(?:0|[1-9]\d{0,8})$/u;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+$/u;

/** Caps allocation before base64 decoding; 256 covers every accepted policy. */
const MAX_ENCODED_HASH_LENGTH = 256;

/** Strict PHC shape; parameter ranges are validated separately. */
const PHC_PATTERN = /^\$argon2id\$v=([^$,]+)\$m=([^$,]+),t=([^$,]+),p=([^$,]+)\$([^$]+)\$([^$]+)$/u;

export interface PasswordPolicy {
  readonly memoryKiB: number;
  readonly passes: number;
  readonly parallelism: number;
  readonly saltBytes: number;
  readonly tagBytes: number;
}

/**
 * `unusable_hash` identifies an untrusted stored value rejected before Argon2;
 * callers must report it and equalize the missing work.
 */
export type PasswordVerification =
  | { readonly outcome: "verified"; readonly needsRehash: boolean }
  | {
      readonly outcome: "mismatch";
      /** False means the caller must add current-policy work before rejecting. */
      readonly storedPolicyIsCurrent: boolean;
    }
  | { readonly outcome: "unusable_hash" };

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, encodedHash: string): Promise<PasswordVerification>;
}

/** Routes every derivation through the injected concurrency bound. */
export function createPasswordHasher(executor: KdfExecutor): PasswordHasher {
  return {
    hash(password) {
      return executor.run(async () => {
        const salt = randomBytes(CURRENT_PASSWORD_POLICY.saltBytes);
        const tag = await derivePassword(password, salt, CURRENT_PASSWORD_POLICY);

        return encodePasswordHash(CURRENT_PASSWORD_POLICY, salt, tag);
      });
    },

    async verify(password, encodedHash) {
      const stored = parsePasswordHash(encodedHash);
      if (stored === null) {
        // Reject malformed, unsupported, or out-of-bounds parameters before Argon2.
        return { outcome: "unusable_hash" };
      }

      const candidateTag = await executor.run(() =>
        derivePassword(password, stored.salt, stored.policy),
      );
      const storedPolicyIsCurrent = matchesCurrentPolicy(stored.policy);

      if (!timingSafeEqual(candidateTag, stored.tag)) {
        return { outcome: "mismatch", storedPolicyIsCurrent };
      }

      return { outcome: "verified", needsRehash: !storedPolicyIsCurrent };
    },
  };
}

interface ParsedPasswordHash {
  readonly policy: PasswordPolicy;
  readonly salt: Buffer;
  readonly tag: Buffer;
}

export function parsePasswordHash(encodedHash: string): ParsedPasswordHash | null {
  // Check before parsing or decoding to bound allocation from untrusted input.
  if (encodedHash.length > MAX_ENCODED_HASH_LENGTH) {
    return null;
  }

  const match = PHC_PATTERN.exec(encodedHash);
  if (match === null) {
    return null;
  }

  const [, versionText, memoryText, passesText, parallelismText, saltText, tagText] = match;

  if (parseParameter(versionText) !== ARGON2_VERSION) {
    return null;
  }

  const memoryKiB = parseBounded(memoryText, PARAMETER_BOUNDS.memoryKiB);
  const passes = parseBounded(passesText, PARAMETER_BOUNDS.passes);
  const parallelism = parseBounded(parallelismText, PARAMETER_BOUNDS.parallelism);

  if (memoryKiB === null || passes === null || parallelism === null) {
    return null;
  }

  // Preserve Argon2's floor if the accepted bounds change later.
  if (memoryKiB < 8 * parallelism) {
    return null;
  }

  const salt = saltText === undefined ? null : decodeBase64(saltText);
  const tag = tagText === undefined ? null : decodeBase64(tagText);

  if (salt === null || tag === null) {
    return null;
  }

  if (!isWithin(salt.length, PARAMETER_BOUNDS.saltBytes)) {
    return null;
  }

  if (!isWithin(tag.length, PARAMETER_BOUNDS.tagBytes)) {
    return null;
  }

  return {
    policy: { memoryKiB, passes, parallelism, saltBytes: salt.length, tagBytes: tag.length },
    salt,
    tag,
  };
}

export function encodePasswordHash(policy: PasswordPolicy, salt: Buffer, tag: Buffer): string {
  const parameters = `m=${policy.memoryKiB},t=${policy.passes},p=${policy.parallelism}`;

  return `$argon2id$v=${ARGON2_VERSION}$${parameters}$${encodeBase64(salt)}$${encodeBase64(tag)}`;
}

export function derivePassword(
  password: string,
  salt: Buffer,
  policy: PasswordPolicy,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      "argon2id",
      {
        message: password,
        nonce: salt,
        memory: policy.memoryKiB,
        passes: policy.passes,
        parallelism: policy.parallelism,
        tagLength: policy.tagBytes,
      },
      (error, derivedKey) => {
        if (error !== null) {
          reject(error);
          return;
        }

        resolve(derivedKey);
      },
    );
  });
}

function matchesCurrentPolicy(policy: PasswordPolicy): boolean {
  return (
    policy.memoryKiB === CURRENT_PASSWORD_POLICY.memoryKiB &&
    policy.passes === CURRENT_PASSWORD_POLICY.passes &&
    policy.parallelism === CURRENT_PASSWORD_POLICY.parallelism &&
    policy.saltBytes === CURRENT_PASSWORD_POLICY.saltBytes &&
    policy.tagBytes === CURRENT_PASSWORD_POLICY.tagBytes
  );
}

function parseParameter(value: string | undefined): number | null {
  if (value === undefined || !PARAMETER_NUMBER_PATTERN.test(value)) {
    return null;
  }

  return Number(value);
}

function parseBounded(
  value: string | undefined,
  bounds: { readonly min: number; readonly max: number },
): number | null {
  const parsed = parseParameter(value);

  return parsed !== null && isWithin(parsed, bounds) ? parsed : null;
}

function isWithin(value: number, bounds: { readonly min: number; readonly max: number }): boolean {
  return value >= bounds.min && value <= bounds.max;
}

function encodeBase64(value: Buffer): string {
  return value.toString("base64").replace(/=+$/u, "");
}

function decodeBase64(value: string): Buffer | null {
  if (!BASE64_PATTERN.test(value)) {
    return null;
  }

  const decoded = Buffer.from(value, "base64");
  return encodeBase64(decoded) === value ? decoded : null;
}
