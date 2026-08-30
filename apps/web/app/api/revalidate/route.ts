import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { timingSafeEqual } from "node:crypto";

// Publish webhook: the content pipeline (or Hono API) calls this after inserting/
// updating a Blog row so the new/changed page is regenerated across ALL replicas
// (revalidatePath flows through the Valkey cacheHandler from Phase 0b). Optionally
// purges Cloudflare's edge cache too. Secret-gated with a constant-time compare.
export const runtime = "nodejs";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://electronicmailservices.com").replace(
  /\/$/,
  "",
);

// Only content surfaces the pipeline legitimately publishes may be revalidated.
const REVALIDATE_PREFIXES = ["/blog", "/features", "/pricing", "/deliverability", "/docs"];
function isRevalidatablePath(p: string): boolean {
  if (!p.startsWith("/") || p.includes("..")) return false;
  if (p === "/") return true;
  return REVALIDATE_PREFIXES.some((pre) => p === pre || p.startsWith(`${pre}/`));
}

function safeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false; // length-leak is acceptable; content is constant-time
  return timingSafeEqual(a, b);
}

// Purge-by-URL works on every Cloudflare plan. Fail-open: no creds → skip silently.
async function purgeCloudflare(paths: string[]): Promise<boolean> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zone = process.env.CLOUDFLARE_ZONE_ID;
  if (!token || !zone) return false;
  const files = paths.filter((p) => p.startsWith("/")).map((p) => `${SITE_URL}${p}`);
  if (!files.length) return false;
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ files }),
    },
  );
  return res.ok;
}

export async function POST(req: NextRequest) {
  const secret = process.env.REVALIDATE_SECRET;
  // Fail closed when no secret is configured — never expose an unauthenticated purge.
  if (!secret) {
    return Response.json({ error: "revalidation_disabled" }, { status: 503 });
  }
  const provided = req.headers.get("x-revalidate-secret") ?? "";
  if (!safeEqual(provided, secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { slug?: unknown; paths?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // empty/invalid body → just revalidate the index
  }

  const paths = new Set<string>(["/blog"]);
  if (typeof body.slug === "string" && /^[a-z0-9-]+$/i.test(body.slug)) {
    paths.add(`/blog/${body.slug}`);
  }
  if (Array.isArray(body.paths)) {
    for (const p of body.paths) {
      // Allowlist content surfaces only, so a leaked secret can't thrash arbitrary
      // routes (the apex, tenant pages, etc.) — just the content the pipeline owns.
      if (typeof p === "string" && isRevalidatablePath(p)) paths.add(p);
    }
  }

  for (const p of paths) {
    try {
      revalidatePath(p);
    } catch {
      // best-effort per path
    }
  }

  const cloudflarePurged = await purgeCloudflare([...paths]).catch(() => false);
  return Response.json({ revalidated: [...paths], cloudflarePurged });
}
