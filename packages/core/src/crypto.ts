import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "./env.js";

// Authenticated encryption for secrets stored at rest (DKIM private keys —
// NFR-004). Format: "v1:<iv-hex>:<tag-hex>:<ciphertext-hex>". Versioned so the
// key can be rotated later. No insecure default — a missing/short DKIM_ENC_KEY
// makes encrypt/decrypt throw (fail closed) rather than silently weakening.

const ALGO = "aes-256-gcm";
const PREFIX = "v1:";

function key(): Buffer {
  const hex = env.DKIM_ENC_KEY;
  if (!hex) {
    throw new Error(
      "DKIM_ENC_KEY is not set — cannot encrypt/decrypt sending-domain secrets.",
    );
  }
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) {
    throw new Error("DKIM_ENC_KEY must be 64 hex characters (32 bytes).");
  }
  return buf;
}

/** True if the stored value is already in our versioned ciphertext envelope. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

export function decryptSecret(value: string): string {
  // Backward-compat: rows written before encryption shipped are plaintext PEM
  // ("-----BEGIN ..."), which never carries our prefix — return as-is.
  if (!isEncrypted(value)) return value;
  const [, ivHex, tagHex, ctHex] = value.split(":");
  if (!ivHex || !tagHex || !ctHex) {
    throw new Error("Malformed encrypted secret.");
  }
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(ctHex, "hex")),
    decipher.final(),
  ]);
  return pt.toString("utf8");
}
