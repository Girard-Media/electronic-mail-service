import { connection } from "./queue.js";
import { errors } from "./errors.js";

// Per-key rate limit (FR-021): fixed-window counter in the shared cache store keyed by
// API key id. Cheap (one INCR + conditional EXPIRE) and shared across API
// instances. Throws errors.rateLimited() (429) when the per-second cap is hit.
export async function enforceRateLimit(
  keyId: string,
  perSecond: number,
): Promise<void> {
  if (!perSecond || perSecond <= 0) return;
  const windowKey = `rl:${keyId}:${Math.floor(Date.now() / 1000)}`;
  const count = await connection.incr(windowKey);
  if (count === 1) await connection.expire(windowKey, 2);
  if (count > perSecond) throw errors.rateLimited();
}

// General fixed-window limiter for non-API-key flows (e.g. login brute-force
// protection). `limit` requests per `windowSeconds`, keyed by an arbitrary id
// (IP, email, …). Throws errors.rateLimited() (429) when exceeded.
export async function enforceFixedWindow(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  if (!limit || limit <= 0) return;
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const windowKey = `fw:${key}:${bucket}`;
  const count = await connection.incr(windowKey);
  if (count === 1) await connection.expire(windowKey, windowSeconds + 1);
  if (count > limit) throw errors.rateLimited();
}
