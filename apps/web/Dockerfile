# Next.js 16 standalone build for Coolify. BUILD CONTEXT = the monorepo root
# (so workspace packages resolve), e.g.  docker build -f apps/web/Dockerfile .
# `output: 'standalone'` traces only what's needed; public/ + .next/static are NOT
# included by standalone and must be copied in explicitly (else assets 404).
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# ---- deps ----
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages ./packages
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM base AS builder
# Copy the FULL installed tree from deps: root node_modules AND every workspace's
# node_modules (apps/web/node_modules holds the `next` bin — copying only root +
# packages/ left it out, so `next build` failed with "next: not found"). The clean
# git checkout has no node_modules, so the source COPY below won't clobber these.
COPY --from=deps /app ./
COPY . .
# Prisma client must exist before the Next build imports @ems/db.
# env.ts is strict in production, so these must be PRESENT at build — but no DB query
# runs at build (data routes are force-dynamic / try-catch), so server-only secrets use
# safe placeholders here and are overridden by real RUNTIME env in the runner. The
# NEXT_PUBLIC_* vars are baked into the client bundle, so their real values must be set
# at build (defaults below; override via --build-arg from Coolify build-time vars).
ARG DATABASE_URL="postgresql://build:build@localhost:5432/build"
ARG AUTH_SECRET="build-time-placeholder-secret-not-used-at-runtime"
ARG NEXT_PUBLIC_ROOT_DOMAIN="electronicmailservices.com"
ARG NEXT_PUBLIC_SITE_URL="https://electronicmailservices.com"
ARG GIT_HASH=""
ENV DATABASE_URL=$DATABASE_URL \
    AUTH_SECRET=$AUTH_SECRET \
    NEXT_PUBLIC_ROOT_DOMAIN=$NEXT_PUBLIC_ROOT_DOMAIN \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    GIT_HASH=$GIT_HASH
RUN pnpm --filter @ems/db generate \
 && pnpm --filter @ems/web build

# ---- runner ----
FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
# Monorepo standalone output places the server under apps/web/.
CMD ["node", "apps/web/server.js"]
