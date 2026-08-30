import type { MetadataRoute } from "next";
import { SITE_URL, getSitemapRows } from "@/lib/blog";

// Single sitemap served at /sitemap.xml (where robots.ts points + Google expects it).
// Google caps a sitemap at 50k URLs / 50MB; our near-term catalog (~10k blog posts +
// the marketing routes) is comfortably under that, so chunking would be premature —
// and a single default-export sitemap avoids the generateSitemaps id-coercion + missing
// /sitemap.xml-index pitfalls. If the catalog ever approaches ~45k, switch to chunked
// generateSitemaps + an explicit index route. DB access is wrapped: an unreachable DB
// at build degrades to the static routes only.
const MAX_BLOG_URLS = 45_000; // safety margin under the 50k cap (leaves room for static)

const STATIC_ROUTES: { path: string; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]; priority: number }[] = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/features", changeFrequency: "weekly", priority: 0.8 },
  { path: "/pricing", changeFrequency: "weekly", priority: 0.8 },
  { path: "/deliverability", changeFrequency: "weekly", priority: 0.7 },
  { path: "/docs", changeFrequency: "weekly", priority: 0.7 },
  { path: "/docs/user", changeFrequency: "monthly", priority: 0.5 },
  { path: "/docs/dev", changeFrequency: "monthly", priority: 0.5 },
  { path: "/blog", changeFrequency: "daily", priority: 0.7 },
  { path: "/status", changeFrequency: "hourly", priority: 0.4 },
  { path: "/privacy", changeFrequency: "monthly", priority: 0.3 },
  { path: "/terms", changeFrequency: "monthly", priority: 0.3 },
  { path: "/security", changeFrequency: "monthly", priority: 0.3 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((r) => ({
    url: `${SITE_URL}${r.path}`,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  let rows: { slug: string; updatedAt: Date }[] = [];
  try {
    rows = await getSitemapRows(0, MAX_BLOG_URLS);
  } catch {
    rows = [];
  }
  if (rows.length >= MAX_BLOG_URLS) {
    // No silent truncation — surface that the catalog outgrew a single sitemap.
    console.warn(
      `[sitemap] hit MAX_BLOG_URLS=${MAX_BLOG_URLS}; switch to chunked generateSitemaps.`,
    );
  }

  const blogEntries: MetadataRoute.Sitemap = rows.map((r) => ({
    url: `${SITE_URL}/blog/${r.slug}`,
    lastModified: r.updatedAt,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [...staticEntries, ...blogEntries];
}
