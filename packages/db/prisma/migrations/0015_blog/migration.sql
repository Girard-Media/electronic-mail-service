-- Programmatic SEO: platform-owned blog posts rendered at the root domain by apps/web.
-- Not tenant-scoped (decoupled from Organization). A content pipeline fills this; Next
-- renders + SSGs it (top-N prebuilt, long tail via on-demand ISR).
CREATE TABLE "Blog" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT,
    "bodyMd" TEXT NOT NULL,
    "bodyHtml" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "canonicalUrl" TEXT,
    "coverImageUrl" TEXT,
    "noindex" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "authorName" TEXT,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "readingMin" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Blog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Blog_slug_key" ON "Blog"("slug");
CREATE INDEX "Blog_status_publishedAt_idx" ON "Blog"("status", "publishedAt");
CREATE INDEX "Blog_category_status_idx" ON "Blog"("category", "status");
