# syntax=docker/dockerfile:1
# ems — one image for api + web + workers on the hostssh fleet.
# The .223 pipeline builds this once; the deploy hook runs web and workers as
# --command siblings from the same image. Real env is staged as .env.production (G11).
FROM node:22-bookworm-slim
WORKDIR /app
# openssl/ca-certificates: Prisma engines + TLS. curl: container healthchecks.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
# --prod=false: devDeps (tsx, typescript) are needed at build and runtime even
# though the staged env carries NODE_ENV=production.
RUN pnpm install --frozen-lockfile --prod=false
# The pipeline stages env at the repo root; Next only reads it from the app dir.
RUN [ -f .env.production ] && cp .env.production apps/web/.env.production || true
RUN pnpm --filter @ems/db generate \
  && NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @ems/web build
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
# Default service = API; root `pnpm start` applies Prisma migrations first.
# Siblings: `pnpm --filter @ems/web start` · `pnpm --filter @ems/workers start`
CMD ["pnpm", "start"]
