/**
 * The four token buckets (E02-049, E07-030..E07-034). Invariant I3.
 *
 * Every emit decrements four buckets. If ANY of them lacks headroom the intent
 * defers and NONE of them are decremented — partial consumption would let a
 * mailbox spend its daily allowance on sends that never happened.
 *
 * That all-or-nothing property is why this is one Lua script rather than four
 * round trips: Valkey executes a script atomically, so there is no window in
 * which two workers both observe headroom and both spend it.
 *
 * The buckets are fixed-window counters keyed by period, not leaky buckets. A
 * cold-email cap is genuinely "40 in this calendar day", and a fixed window with
 * a jittered scheduler is both correct and trivially auditable against the
 * Postgres counters (E07-038).
 */

export type BucketName =
  | "mailbox-daily"
  | "mailbox-hourly"
  | "domain-daily"
  | "ip-hourly"
  | "esp-adaptive";

export interface BucketSpec {
  name: BucketName;
  key: string;
  limit: number;
  /** Seconds until this counter's window resets. */
  ttlSec: number;
}

export type ClaimResult =
  | { ok: true }
  | { ok: false; bindingConstraint: BucketName; observed: number; limit: number };

/**
 * Check every bucket, then increment every bucket — or increment none.
 *
 * KEYS  = bucket keys, in order
 * ARGV  = limit_1, ttl_1, limit_2, ttl_2, ...
 * Returns 0 on success, or the 1-based index of the first bucket that is full,
 * followed by its observed value.
 */
export const CLAIM_SCRIPT = `
local n = #KEYS
-- Pass 1: verify headroom everywhere before spending anything.
for i = 1, n do
  local limit = tonumber(ARGV[(i - 1) * 2 + 1])
  local current = tonumber(redis.call('GET', KEYS[i]) or '0')
  if current + 1 > limit then
    return { i, current }
  end
end
-- Pass 2: every bucket had room, so spend them all.
for i = 1, n do
  local ttl = tonumber(ARGV[(i - 1) * 2 + 2])
  local value = redis.call('INCR', KEYS[i])
  if value == 1 then
    redis.call('EXPIRE', KEYS[i], ttl)
  end
end
return { 0, 0 }
`;

/**
 * Release a previously claimed set of buckets. Used when the emit stage fails
 * before the message actually left the machine — the allowance was never spent,
 * so holding it would silently shrink the day's capacity.
 *
 * Floors at zero: an over-release must never mint capacity.
 */
export const RELEASE_SCRIPT = `
for i = 1, #KEYS do
  local current = tonumber(redis.call('GET', KEYS[i]) or '0')
  if current > 0 then
    redis.call('DECR', KEYS[i])
  end
end
return 1
`;

/** Minimal surface we need from an ioredis-compatible client. */
export interface BucketClient {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

function windowKeys(at: Date) {
  const iso = at.toISOString();
  return {
    day: iso.slice(0, 10),           // YYYY-MM-DD
    hour: iso.slice(0, 13),          // YYYY-MM-DDTHH
    quarter: `${iso.slice(0, 13)}:${String(Math.floor(at.getUTCMinutes() / 15) * 15).padStart(2, "0")}`,
  };
}

export interface BucketInputs {
  mailboxId: string;
  domainId: string;
  ipId: string;
  esp: string;
  mailboxDailyCap: number;
  mailboxHourlyCap: number;
  domainDailyCap: number;
  ipHourlyCap: number;
  /** Auto-tuned from the observed 4xx rate for this IP and ESP (E07-035). */
  espQuarterCap: number;
  at: Date;
}

export function buildSpecs(i: BucketInputs): BucketSpec[] {
  const w = windowKeys(i.at);
  return [
    { name: "mailbox-daily",  key: `ems:b:mbx:d:${i.mailboxId}:${w.day}`,   limit: i.mailboxDailyCap,  ttlSec: 172_800 },
    { name: "mailbox-hourly", key: `ems:b:mbx:h:${i.mailboxId}:${w.hour}`,  limit: i.mailboxHourlyCap, ttlSec: 7_200 },
    { name: "domain-daily",   key: `ems:b:dom:d:${i.domainId}:${w.day}`,    limit: i.domainDailyCap,   ttlSec: 172_800 },
    { name: "ip-hourly",      key: `ems:b:ip:h:${i.ipId}:${w.hour}`,        limit: i.ipHourlyCap,      ttlSec: 7_200 },
    { name: "esp-adaptive",   key: `ems:b:esp:${i.ipId}:${i.esp}:${w.quarter}`, limit: i.espQuarterCap, ttlSec: 3_600 },
  ];
}

export async function claim(client: BucketClient, specs: BucketSpec[]): Promise<ClaimResult> {
  const keys = specs.map((s) => s.key);
  const argv: (string | number)[] = [];
  for (const s of specs) argv.push(s.limit, s.ttlSec);

  const raw = (await client.eval(CLAIM_SCRIPT, keys.length, ...keys, ...argv)) as [number, number];
  const [failedIndex, observed] = raw;
  if (failedIndex === 0) return { ok: true };

  const spec = specs[failedIndex - 1];
  if (!spec) {
    // Should be unreachable; if the script ever returns an index we cannot map,
    // fail closed rather than letting the send through unmetered.
    return { ok: false, bindingConstraint: "mailbox-daily", observed, limit: 0 };
  }
  return { ok: false, bindingConstraint: spec.name, observed, limit: spec.limit };
}

export async function release(client: BucketClient, specs: BucketSpec[]): Promise<void> {
  const keys = specs.map((s) => s.key);
  await client.eval(RELEASE_SCRIPT, keys.length, ...keys);
}

/**
 * Adaptive per-ESP cap (E07-035..E07-037).
 *
 * Deliberately asymmetric: a sustained deferral signal cuts the rate hard and
 * immediately, but recovery is gradual. Backing off slowly and recovering fast
 * is how a soft degradation becomes a block.
 */
export function nextEspCap(current: number, deferRate: number, opts?: {
  floor?: number; ceiling?: number; cutTo?: number; recoverBy?: number; trigger?: number;
}): number {
  const floor = opts?.floor ?? 5;
  const ceiling = opts?.ceiling ?? 500;
  const cutTo = opts?.cutTo ?? 0.5;
  const recoverBy = opts?.recoverBy ?? 1.1;
  const trigger = opts?.trigger ?? 0.05;

  if (deferRate > trigger) {
    return Math.max(floor, Math.floor(current * cutTo));
  }
  if (deferRate === 0) {
    // floor(), not ceil(): 100 * 1.1 is 110.00000000000001 in IEEE-754, and
    // ceil() would turn a 10% recovery into 11%. The `current + 1` guard keeps
    // a small cap moving when the percentage rounds away to nothing.
    const grown = Math.max(current + 1, Math.floor(current * recoverBy));
    return Math.min(ceiling, Math.max(floor + 1, grown));
  }
  return current;
}
