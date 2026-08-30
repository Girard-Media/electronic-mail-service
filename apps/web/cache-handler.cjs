// Custom Next.js 16 ISR cache handler backed by the fleet Valkey (Redis-compatible).
//
// Uses the CLASSIC singular `cacheHandler` interface (get/set/revalidateTag/
// resetRequestCache) — NOT the plural `cacheHandlers` for `'use cache'` (refreshTags/
// getExpiration/updateTags), which we defer (planning/NEXTJS_FRONTEND.md). The classic
// interface is the right one for `export const revalidate` + `generateStaticParams`.
//
// WHY: with >1 container, the default in-memory ISR cache is per-instance, so a
// publish/revalidate on container A leaves B/C serving stale pages. A shared store
// makes one revalidate visible to every replica.
//
// Tag-invalidation model (standard shared-store pattern): each cached entry stores its
// tags + lastModified. revalidateTag(t) writes `tag:t -> now` into Redis. On get(), if
// ANY of the entry's tags carries an invalidation timestamp newer than the entry's
// lastModified, we return a MISS so Next regenerates. revalidatePath flows through
// revalidateTag here, so it Just Works across replicas too.
//
// FAIL-OPEN: every Redis interaction is wrapped — any error (or no REDIS_URL) degrades
// to a cache miss (Next regenerates locally). Cache I/O must never take down a request.
// CommonJS (.cjs) because Next `require()`s the handler in the Node server runtime.

// Namespace every entry by build id. Without this, keys outlive a deploy: a page
// cached before a code change keeps being served from Valkey even though the new
// build is on disk and correct. That silently shipped a stale 404 page across a
// deploy once — the artifacts were right, the served bytes were 24h old.
// Orphaned keys from prior builds self-evict on DEFAULT_TTL_SECONDS.
function resolveBuildId() {
  if (process.env.GIT_HASH) return process.env.GIT_HASH;
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    // `next start` runs from apps/web; the standalone server keeps the same layout.
    const id = fs.readFileSync(path.join(__dirname, ".next", "BUILD_ID"), "utf8").trim();
    if (id) return id;
  } catch {
    // Fall through — a shared namespace is still better than crashing the handler.
  }
  return "nobuildid";
}

const KEY_PREFIX = process.env.NEXT_CACHE_PREFIX ?? `umweb:isr:${resolveBuildId()}:`;
const ENTRY = (k) => `${KEY_PREFIX}entry:${k}`;
const TAG = (t) => `${KEY_PREFIX}tag:${t}`;
const DEFAULT_TTL_SECONDS = 60 * 60 * 24; // self-evict dead keys after 24h

// Buffers (e.g. an APP_PAGE's RSC payload) serialize to {type:'Buffer',data:[...]} via
// their default toJSON; this reviver turns them back into real Buffers on read so Next
// gets the exact structure it stored. (Array form is space-inefficient vs base64 — fine
// for v1; revisit if Valkey memory becomes a constraint at scale.)
function reviver(_key, value) {
  if (
    value &&
    typeof value === "object" &&
    value.type === "Buffer" &&
    Array.isArray(value.data)
  ) {
    return Buffer.from(value.data);
  }
  return value;
}

let client = null;
function getClient() {
  if (client !== null) return client || null;
  const url = process.env.REDIS_URL ?? process.env.QUEUE_URL;
  if (!url) {
    client = false; // sentinel: "checked, none configured" — don't re-check every call
    return null;
  }
  // Lazy require so `next build` (which loads this module) never hard-fails on a
  // missing/uninstalled ioredis — we only touch it when actually serving.
  const Redis = require("ioredis");
  const Ctor = Redis.default ?? Redis;
  const c = new Ctor(url, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
  c.on("error", () => {}); // swallow; callers already guard with try/catch
  client = c;
  return c;
}

module.exports = class EMSCacheHandler {
  constructor(options) {
    this.options = options;
    // Per-request memo layer (cleared by resetRequestCache) so one render doesn't hit
    // Redis repeatedly for the same key.
    this.local = new Map();
  }

  async get(key) {
    if (this.local.has(key)) return this.local.get(key);
    const redis = getClient();
    if (!redis) return null;
    try {
      const raw = await redis.get(ENTRY(key));
      if (!raw) return null;
      const parsed = JSON.parse(raw, reviver);
      const tags = parsed.tags ?? [];
      const lastModified = parsed.lastModified ?? 0;
      if (tags.length) {
        const stamps = await redis.mget(tags.map(TAG));
        for (const s of stamps) {
          // A tag invalidated after this entry was written → entry is stale.
          if (s && Number(s) > lastModified) return null;
        }
      }
      const entry = { value: parsed.value, lastModified };
      this.local.set(key, entry);
      return entry;
    } catch {
      return null; // fail-open → Next regenerates
    }
  }

  async set(key, data, ctx) {
    const lastModified = Date.now();
    const tags = (ctx && ctx.tags) ?? [];
    // Local memo holds the runtime shape; Redis holds the serialized shape + tags.
    this.local.set(key, { value: data, lastModified });
    const redis = getClient();
    if (!redis) return;
    try {
      const ttl = Number(process.env.NEXT_CACHE_TTL_SECONDS ?? DEFAULT_TTL_SECONDS);
      const payload = JSON.stringify({ value: data, lastModified, tags });
      await redis.set(ENTRY(key), payload, "EX", ttl);
    } catch {
      // ignore — other replicas will just regenerate
    }
  }

  async revalidateTag(tags) {
    const redis = getClient();
    if (!redis) return;
    const list = Array.isArray(tags) ? tags : [tags];
    const real = list.filter(Boolean);
    if (!real.length) return;
    const now = Date.now();
    try {
      const pipe = redis.pipeline();
      // Tag markers outlive entries (longer TTL) so a late-arriving stale entry is
      // still caught by its tag stamp.
      for (const t of real) pipe.set(TAG(t), String(now), "EX", DEFAULT_TTL_SECONDS * 7);
      await pipe.exec();
    } catch {
      // ignore
    }
  }

  resetRequestCache() {
    this.local.clear();
  }
};
