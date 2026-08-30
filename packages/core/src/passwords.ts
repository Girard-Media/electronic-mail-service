import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

// Password hashing with scrypt (Node built-in — no native dep). Format: salt:hash (hex).
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${dk.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const dk = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  const h = Buffer.from(hashHex, "hex");
  return dk.length === h.length && timingSafeEqual(dk, h);
}
