// Blog data layer for the programmatic-SEO engine. Server-only: imports the Prisma
// client and reads Postgres directly (the SSG-ideal path from the plan). Writes happen
// through the content pipeline / Hono API, never here.
import { prisma } from "@ems/db";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

// Prebuild the N most-recent posts at build time; the long tail (toward 10k) renders
// on-demand via ISR. Keep this modest so builds stay fast.
export const TOP_N_PREBUILD = 100;

// Thin-content quality gate (Google scaled-content/doorway policy). Posts under this
// word count are noindex'd so a flood of thin pages can't drag down the whole domain.
export const THIN_WORD_THRESHOLD = 300;

// Sitemaps cap at 50k URLs each; chunk well under that.
export const SITEMAP_CHUNK_SIZE = 5000;

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://electronicmailservices.com"
).replace(/\/$/, "");

const PUBLISHED = { status: "published" } as const;

// Card shape for lists (index + related) — only the columns a card needs.
export type BlogCard = {
  slug: string;
  title: string;
  excerpt: string | null;
  category: string | null;
  coverImageUrl: string | null;
  authorName: string | null;
  readingMin: number;
  publishedAt: Date | null;
};

const CARD_SELECT = {
  slug: true,
  title: true,
  excerpt: true,
  category: true,
  coverImageUrl: true,
  authorName: true,
  readingMin: true,
  publishedAt: true,
} as const;

export async function getRecentPublishedSlugs(limit = TOP_N_PREBUILD): Promise<string[]> {
  const rows = await prisma.blog.findMany({
    where: PUBLISHED,
    orderBy: { publishedAt: "desc" },
    take: limit,
    select: { slug: true },
  });
  return rows.map((r) => r.slug);
}

export async function getAllPublishedSlugs(skip: number, take: number): Promise<string[]> {
  const rows = await prisma.blog.findMany({
    where: PUBLISHED,
    orderBy: { publishedAt: "desc" },
    skip,
    take,
    select: { slug: true, updatedAt: true },
  });
  return rows.map((r) => r.slug);
}

export async function countPublished(): Promise<number> {
  return prisma.blog.count({ where: PUBLISHED });
}

// Rows for a sitemap chunk: slug + updatedAt (for <lastmod>), newest first.
export async function getSitemapRows(skip: number, take: number) {
  return prisma.blog.findMany({
    where: PUBLISHED,
    orderBy: { publishedAt: "desc" },
    skip,
    take,
    select: { slug: true, updatedAt: true },
  });
}

export async function listPublished(opts: {
  skip?: number;
  take?: number;
  category?: string;
} = {}): Promise<BlogCard[]> {
  return prisma.blog.findMany({
    where: { ...PUBLISHED, ...(opts.category ? { category: opts.category } : {}) },
    orderBy: { publishedAt: "desc" },
    skip: opts.skip ?? 0,
    take: opts.take ?? 24,
    select: CARD_SELECT,
  });
}

export type FullPost = NonNullable<Awaited<ReturnType<typeof getPostBySlug>>>;

export async function getPostBySlug(slug: string) {
  const post = await prisma.blog.findUnique({ where: { slug } });
  // Only published posts are publicly visible — drafts 404 even by direct slug.
  if (!post || post.status !== "published") return null;
  return post;
}

// Hub-spoke internal linking: same-category recent posts (fallback to any recent) so
// every post links out to siblings — both for UX and to distribute crawl/link equity.
export async function getRelated(
  post: { slug: string; category: string | null },
  limit = 6,
): Promise<BlogCard[]> {
  const sameCategory = post.category
    ? await prisma.blog.findMany({
        where: { ...PUBLISHED, category: post.category, slug: { not: post.slug } },
        orderBy: { publishedAt: "desc" },
        take: limit,
        select: CARD_SELECT,
      })
    : [];
  if (sameCategory.length >= limit) return sameCategory;
  // Top up with other recent posts (excluding self + ones already chosen).
  const have = new Set([post.slug, ...sameCategory.map((p) => p.slug)]);
  const fill = await prisma.blog.findMany({
    where: { ...PUBLISHED, slug: { notIn: [...have] } },
    orderBy: { publishedAt: "desc" },
    take: limit - sameCategory.length,
    select: CARD_SELECT,
  });
  return [...sameCategory, ...fill];
}

// Allowlist for rendered post HTML. Permits the rich elements a blog post needs
// (headings, lists, code, tables, images, links) and strips everything else —
// crucially <script>/<style>/event handlers/javascript: URLs.
const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    "img",
    "h1",
    "h2",
    "figure",
    "figcaption",
  ],
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    a: ["href", "name", "target", "rel"],
    img: ["src", "alt", "title", "width", "height", "loading"],
    "*": ["id"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["https"] }, // post images come from our https CDN
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
  },
};

// Render body to HTML, then SANITIZE. Content is platform-owned, but it's generated by
// an automated pipeline at scale (toward 10k posts) and rendered via
// dangerouslySetInnerHTML on the APEX domain — "we author it" is not a security
// boundary. Sanitizing both branches makes stored XSS impossible regardless of how a
// row got written. marked v14 passes raw HTML through (it dropped its sanitize option),
// so this is the only barrier.
export function renderBody(post: { bodyHtml: string | null; bodyMd: string }): string {
  const raw =
    post.bodyHtml && post.bodyHtml.trim()
      ? post.bodyHtml
      : (marked.parse(post.bodyMd, { async: false }) as string);
  return sanitizeHtml(raw, SANITIZE_OPTS);
}

// Thin-content gate: explicit noindex flag OR below the word-count threshold.
export function isThin(post: { noindex: boolean; wordCount: number }): boolean {
  return post.noindex || post.wordCount < THIN_WORD_THRESHOLD;
}

export function formatDate(d: Date | null): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}
