import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Per-arm credential storage (Wave 5)
//
// Per-arm secrets are encrypted at rest with AES-256-GCM keyed by
// QUEENSYNC_CREDENTIAL_KEY. We store ciphertext (not a one-way hash) because
// we need the plaintext both to verify inbound callbacks AND to forward as
// the outbound dispatch bearer/api-key header. DB compromise alone does not
// leak the secrets unless the key is also compromised.
//
// Format: base64(iv (12 bytes) || ciphertext || authTag (16 bytes))
// ---------------------------------------------------------------------------

const KEY_ENV = "QUEENSYNC_CREDENTIAL_KEY";

let cachedKey: Buffer | null = null;
let warned = false;

function loadKey(): Buffer | null {
  if (cachedKey) return cachedKey;
  const raw = process.env[KEY_ENV];
  if (!raw) {
    if (!warned) {
      logger.warn(
        `${KEY_ENV} not set — per-arm credentials are disabled. ` +
          "Onboarding will reject any 'secret' field and rotation will fail. " +
          "Set a 32-byte hex or base64 key to enable per-arm credentials.",
      );
      warned = true;
    }
    return null;
  }
  let buf: Buffer;
  try {
    if (/^[0-9a-fA-F]+$/.test(raw) && raw.length === 64) {
      buf = Buffer.from(raw, "hex");
    } else {
      buf = Buffer.from(raw, "base64");
    }
  } catch {
    throw new Error(
      `${KEY_ENV} is not valid hex or base64 — provide a 32-byte key`,
    );
  }
  if (buf.length !== 32) {
    throw new Error(
      `${KEY_ENV} must decode to exactly 32 bytes (got ${buf.length})`,
    );
  }
  cachedKey = buf;
  return buf;
}

/**
 * Strip `credentialCipher` from any arm row before it leaves the server.
 * The encrypted blob is server-only — we only ever expose the 4-char hint
 * and the rotation timestamp on the wire (HTTP responses + WS broadcasts).
 *
 * Accepts a plain arm row OR an arm-shaped object with extra fields
 * spread on (e.g. `recentTasks`, `memoryContributionCount`, `oneTimeSecret`).
 */
export function sanitizeArm<T extends { credentialCipher?: unknown } | null | undefined>(
  arm: T,
): T extends null | undefined ? T : Omit<NonNullable<T>, "credentialCipher"> {
  if (arm == null) return arm as never;
  const { credentialCipher: _omit, ...rest } = arm as Record<string, unknown>;
  void _omit;
  return rest as never;
}

export function sanitizeArms<T extends { credentialCipher?: unknown }>(
  arms: T[],
): Array<Omit<T, "credentialCipher">> {
  return arms.map((a) => sanitizeArm(a)) as Array<Omit<T, "credentialCipher">>;
}

export function isCredentialStorageEnabled(): boolean {
  return loadKey() !== null;
}

export function generateArmSecret(): string {
  // 32 random bytes → base64url (~43 chars). Safe to log only the hint.
  return randomBytes(32).toString("base64url");
}

export function hintFor(secret: string): string {
  if (secret.length <= 4) return "*".repeat(secret.length);
  return `…${secret.slice(-4)}`;
}

export function encryptArmSecret(secret: string): string {
  const key = loadKey();
  if (!key) {
    throw new Error(
      `${KEY_ENV} is not configured — cannot store per-arm credential`,
    );
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString("base64");
}

export function decryptArmSecret(cipherB64: string): string | null {
  const key = loadKey();
  if (!key) return null;
  let buf: Buffer;
  try {
    buf = Buffer.from(cipherB64, "base64");
  } catch {
    return null;
  }
  if (buf.length < 12 + 16 + 1) return null;
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const enc = buf.subarray(12, buf.length - 16);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(enc), decipher.final()]);
    return out.toString("utf8");
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "decryptArmSecret failed");
    return null;
  }
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * HMAC-sign a (taskId, status) tuple with a per-arm secret. Mirrors the
 * shared-secret signCallback() shape so the arm can echo the same header.
 */
export function signCallbackWithArmSecret(
  secret: string,
  taskId: string,
  status: string,
): string {
  const h = createHmac("sha256", secret);
  h.update(`${taskId}:${status}`);
  return `sha256=${h.digest("hex")}`;
}
