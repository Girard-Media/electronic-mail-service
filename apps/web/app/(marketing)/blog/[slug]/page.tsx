import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getPostBySlug,
  getRecentPublishedSlugs,
  getRelated,
  renderBody,
  isThin,
  formatDate,
  SITE_URL,
} from "@/lib/blog";

// Prebuild the top-N recent posts; the long tail renders on demand and is then cached
// (dynamicParams stays true). The try/catch keeps the BUILD hermetic — if the DB is
// unreachable at build time we prebuild nothing and everything becomes on-demand ISR.
export async function generateStaticParams() {
  try {
    const slugs = await getRecentPublishedSlugs();
    return slugs.map((slug) => ({ slug }));
  } catch {
    return [];
  }
}

export const dynamicParams = true; // allow slugs outside the prebuilt set (on-demand ISR)
export const revalidate = 3600;

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug).catch(() => null);
  if (!post) return { title: "Post not found", robots: { index: false } };

  const title = post.seoTitle || post.title;
  const description = post.seoDescription || post.excerpt || undefined;
  const canonical = post.canonicalUrl || `/blog/${post.slug}`;
  const images = post.coverImageUrl ? [post.coverImageUrl] : undefined;

  return {
    title,
    description,
    alternates: { canonical },
    // Thin/flagged posts stay out of the index (but remain crawlable for link equity)
    // so a flood of low-value pages can't sink the domain's overall quality signal.
    robots: isThin(post) ? { index: false, follow: true } : undefined,
    openGraph: {
      type: "article",
      title,
      description,
      url: `${SITE_URL}/blog/${post.slug}`,
      publishedTime: post.publishedAt?.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
      authors: post.authorName ? [post.authorName] : undefined,
      images,
    },
    twitter: { card: "summary_large_image", title, description, images },
  };
}

export default async function BlogPost({ params }: Params) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) notFound();

  const related = await getRelated(post).catch(() => []);
  const html = renderBody(post);

  // Escape the HTML-significant sequences in the JSON-LD before it goes into a <script>.
  // JSON.stringify escapes quotes/backslashes but NOT `<`/`>`/`&`, so a field containing
  // `</script>` (even a benign post title) would break out of the script element. Also
  // escape U+2028/U+2029 (valid JSON, invalid in inline scripts).
  const ldJson = (obj: unknown) =>
    JSON.stringify(obj)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");

  // BlogPosting structured data — helps rich results + entity understanding.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.seoTitle || post.title,
    description: post.seoDescription || post.excerpt || undefined,
    datePublished: post.publishedAt?.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    author: post.authorName
      ? { "@type": "Person", name: post.authorName }
      : { "@type": "Organization", name: "EMS" },
    publisher: { "@type": "Organization", name: "EMS" },
    image: post.coverImageUrl || undefined,
    mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE_URL}/blog/${post.slug}` },
    articleSection: post.category || undefined,
    keywords: post.tags.length ? post.tags.join(", ") : undefined,
  };

  return (
    <article>
      <script
        type="application/ld+json"
        // HTML-escaped so no field can break out of the <script> via </script>.
        dangerouslySetInnerHTML={{ __html: ldJson(jsonLd) }}
      />
      <section className="hero" style={{ paddingBottom: 32 }}>
        <div className="wrap" style={{ maxWidth: 820 }}>
          <div style={{ marginBottom: 14 }}>
            <Link className="btn" href="/blog">
              <i className="ti ti-arrow-left" /> All posts
            </Link>
          </div>
          {post.category ? <span className="eyebrow">{post.category}</span> : null}
          <h1 style={{ marginTop: 12, fontSize: "clamp(30px,5vw,48px)" }}>{post.title}</h1>
          <div className="post-meta muted" style={{ marginTop: 16 }}>
            {post.authorName ? `${post.authorName} · ` : ""}
            {formatDate(post.publishedAt)}
            {post.readingMin ? ` · ${post.readingMin} min read` : ""}
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          {/* Platform-owned content (we author it) — see renderBody for the trust note. */}
          <div className="post-body" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </section>

      {related.length > 0 ? (
        <div className="band">
          <div className="wrap" style={{ padding: "56px 24px" }}>
            <div className="section-head" style={{ marginBottom: 28 }}>
              <h2 style={{ fontSize: "clamp(22px,3vw,30px)" }}>Keep reading</h2>
            </div>
            <div className="grid g3">
              {related.map((p) => (
                <Link key={p.slug} href={`/blog/${p.slug}`} className="card post-card">
                  {p.category ? <span className="eyebrow">{p.category}</span> : null}
                  <h3 style={{ marginTop: 8 }}>{p.title}</h3>
                  {p.excerpt ? <p>{p.excerpt}</p> : null}
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
