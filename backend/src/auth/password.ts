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

/**
 * `password_hash` is an unbounded `text` column, so a corrupt or tampered row
 * could hold megabytes of otherwise alphabet-valid base64. Length is therefore
 * checked before anything is decoded, because `Buffer.from` would allocate the
 * whole field first and only then meet the salt and tag byte bounds.
 *
 * A canonical hash is a little over 100 characters; the ceiling is generous
 * enough for any policy inside {@link PARAMETER_BOUNDS} and still caps decoding
 * at a few hundred bytes.
 */
const MAX_ENCODED_HASH_LENGTH = 256;

/**
 * `$argon2id$v=<version>$m=<memory>,t=<passes>,p=<parallelism>$<salt>$<tag>`,
 * anchored so no trailing `$`-separated field can be smuggled in. Numeric
 * ranges are checked separately, after the shape matches.
 */
const PHC_PATTERN = /^\$argon2id\$v=([^$,]+)\$m=([^$,]+),t=([^$,]+),p=([^$,]+)\$([^$]+)\$([^$]+)$/u;

export interface PasswordPolicy {
  readonly memoryKiB: number;
  readonly passes: number;
  readonly parallelism: number;
  readonly saltBytes: number;
  readonly tagBytes: number;
}

/**
 * `unusable_hash` is kept distinct from `mismatch` on purpose. It means the
 * stored value could not be parsed at all, which is a corrupt or tampered row
 * rather than a wrong password, and it costs no Argon2 work so the caller has
 * to both report it and make up the missing work itself.
 */
export type PasswordVerification =
  | { readonly outcome: "verified"; readonly needsRehash: boolean }
  | {
      readonly outcome: "mismatch";
      /**
       * False when the hash was stored under some older, cheaper policy, which
       * means this rejection cost less Argon2 work than one against a
       * current-policy hash. The caller has to even that out.
       */
      readonly storedPolicyIsCurrent: boolean;
    }
  | { readonly outcome: "unusable_hash" };

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, encodedHash: string): Promise<PasswordVerification>;
}

/**
 * Builds a hasher whose Argon2 work all flows through `executor`, so the number
 * of simultaneous derivations is bounded no matter how many requests arrive.
 */
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
        // Malformed, unsupported, or out-of-bounds: rejected without ever
        // handing the stored parameters to Argon2.
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

/** Exported for tests; production code goes through {@link PasswordHasher}. */
export function parsePasswordHash(encodedHash: string): ParsedPasswordHash | null {
  // Before the regex and before any decoding, so an oversized stored value is
  // rejected without allocating decoded buffers.
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

  // Argon2's own floor. The bounds above already guarantee it, but keeping the
  // check means a future bound change degrades to a clean rejection rather than
  // a thrown error from the crypto layer.
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

/** Exported for tests, which need to produce hashes under an older policy. */
export function encodePasswordHash(policy: PasswordPolicy, salt: Buffer, tag: Buffer): string {
  const parameters = `m=${policy.memoryKiB},t=${policy.passes},p=${policy.parallelism}`;

  return `$argon2id$v=${ARGON2_VERSION}$${parameters}$${encodeBase64(salt)}$${encodeBase64(tag)}`;
}

/** Exported for tests, which need to produce hashes under an older policy. */
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
