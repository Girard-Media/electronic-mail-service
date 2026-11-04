import type { Metadata } from "next";
import Link from "next/link";
import { listPublished, formatDate, type BlogCard } from "@/lib/blog";

// Blog index. ISR — regenerated periodically and on publish (via /api/revalidate). The
// query is wrapped so an unreachable DB at BUILD time degrades to an empty list rather
// than failing the build; runtime revalidation fills it in.
export const revalidate = 600;

export const metadata: Metadata = {
  title: "Blog — cold outreach deliverability and infrastructure",
  description:
    "Notes on running cold B2B outreach on owned infrastructure: sender authentication (SPF/DKIM/DMARC), warmup, placement, and reputation.",
  alternates: { canonical: "/blog" },
};

async function safeList(): Promise<BlogCard[]> {
  try {
    return await listPublished({ take: 48 });
  } catch {
    return [];
  }
}

export default async function BlogIndex() {
  const posts = await safeList();
  return (
    <>
      <section className="hero" style={{ paddingBottom: 40 }}>
        <div className="wrap">
          <span className="eyebrow">EMS Blog</span>
          <h1 style={{ marginTop: 12 }}>
            Email that <span className="g">lands</span>, explained.
          </h1>
          <p className="sub">
            Deliverability and infrastructure notes from the team building cold B2B
            outreach on servers, IPs, and a mail log we own.
          </p>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          {posts.length === 0 ? (
            <p className="muted center">New posts are on the way — check back soon.</p>
          ) : (
            <div className="grid g3">
              {posts.map((p) => (
                <Link key={p.slug} href={`/blog/${p.slug}`} className="card post-card">
                  {p.category ? <span className="eyebrow">{p.category}</span> : null}
                  <h3 style={{ marginTop: 8 }}>{p.title}</h3>
                  {p.excerpt ? <p>{p.excerpt}</p> : null}
                  <div className="post-meta muted">
                    {formatDate(p.publishedAt)}
                    {p.readingMin ? ` · ${p.readingMin} min read` : ""}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
