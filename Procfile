# ems — app-box processes (E01-043). One container image (Dockerfile),
# siblings launched from the same checkout. Ports: web 3000, api 8787.
web: pnpm --filter @ems/web start
api: pnpm start
workers: pnpm --filter @ems/workers start
dmarc-ingest: pnpm --filter @ems/dmarc-ingest start
feedback-ingest: pnpm --filter @ems/feedback-ingest start
maillog-bridge: pnpm --filter @ems/maillog-bridge start
# NOT here: fleet-agent (runs on each blast node, beside Postfix) and
# seedbox (runs on its own host — no host may hold both seed credentials
# and campaign sending, E21-094).
