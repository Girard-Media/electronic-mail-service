import { createHmac, randomBytes } from "node:crypto";

/** RFC 6238 TOTP (SHA-1, 30s, 6 digits) for God Mode step-up. */

const ALPH = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_MS = 30_000;
const DIGITS = 6;
const WINDOW = 1; // accept previous/next step

export function generateTotpSecret(): string {
  return toBase32(randomBytes(20));
}

export function totpAuthUrl(account: string, secret: string, issuer = "EMS"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: "30",
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}

export function totpCode(secret: string, atMs = Date.now()): string {
  return hotp(fromBase32(secret), Math.floor(atMs / STEP_MS));
}

export function verifyTotp(secret: string, code: string, atMs = Date.now()): boolean {
  const trimmed = (code ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(trimmed)) return false;
  const key = fromBase32(secret);
  const counter = Math.floor(atMs / STEP_MS);
  for (let w = -WINDOW; w <= WINDOW; w++) {
    if (hotp(key, counter + w) === trimmed) return true;
  }
  return false;
}

function hotp(key: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

function toBase32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPH[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPH[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const idx = ALPH.indexOf(c);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
