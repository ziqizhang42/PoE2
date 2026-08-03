import { Buffer } from "node:buffer";
import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

const MEMORY_KIB = 65_536;
const PASSES = 3;
const PARALLELISM = 4;
const SALT_BYTES = 16;
const TAG_BYTES = 32;

const HASH_PREFIX = `$argon2id$v=19$m=${MEMORY_KIB},t=${PASSES},p=${PARALLELISM}$`;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+$/u;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derivePassword(password, salt);

  return `${HASH_PREFIX}${encodeBase64(salt)}$${encodeBase64(hash)}`;
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const stored = parsePasswordHash(encodedHash);
  if (stored === null) {
    return false;
  }

  const candidateHash = await derivePassword(password, stored.salt);

  return timingSafeEqual(candidateHash, stored.hash);
}

function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      "argon2id",
      {
        message: password,
        nonce: salt,
        memory: MEMORY_KIB,
        passes: PASSES,
        parallelism: PARALLELISM,
        tagLength: TAG_BYTES,
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

function parsePasswordHash(
  encodedHash: string,
): { readonly salt: Buffer; readonly hash: Buffer } | null {
  if (!encodedHash.startsWith(HASH_PREFIX)) {
    return null;
  }

  const parts = encodedHash.slice(HASH_PREFIX.length).split("$");
  const saltText = parts[0];
  const hashText = parts[1];

  if (parts.length !== 2 || saltText === undefined || hashText === undefined) {
    return null;
  }

  const salt = decodeBase64(saltText);
  const hash = decodeBase64(hashText);

  if (salt?.length !== SALT_BYTES || hash?.length !== TAG_BYTES) {
    return null;
  }

  return { salt, hash };
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
