import type { MetadataRoute } from "next";

// Dynamic robots so the sitemap URL tracks the deployed origin. Replaces the static
// public/robots.txt (Next would 500 on a conflict between the two). Inlines the origin
// rather than importing the blog lib so this trivial route stays free of the DB client.
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://electronicmailservices.com").replace(
  /\/$/,
  "",
);

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
