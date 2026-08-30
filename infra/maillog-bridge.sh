#!/usr/bin/env bash
# Run (or recreate) the maillog-bridge on the fleet hub box.
#
# The bridge tails Postfix's delivery log out of the MTA's spool volume and
# turns `status=sent` lines into `delivered` events. It runs from the SAME
# hostssh/ems image as the API, so re-run this after a ems deploy to
# pick up new bridge code — `--restart unless-stopped` keeps the old container
# alive across reboots but pins it to the image it started from.
#
#   ssh root@31.220.104.223 'bash -s' < infra/maillog-bridge.sh
set -euo pipefail

NAME=ems-maillog-bridge
IMAGE=${IMAGE:-hostssh/ems:latest}
ENV_FILE=${ENV_FILE:-/srv/hostssh/ems/env}

VOL=$(docker inspect ems-mta \
  --format '{{range .Mounts}}{{if eq .Destination "/var/spool/postfix"}}{{.Name}}{{end}}{{end}}')
[ -n "$VOL" ] || { echo "ERROR: could not find the MTA spool volume"; exit 1; }

SECRET=$(grep -m1 '^MTA_FEEDBACK_SECRET=' "$ENV_FILE" | cut -d= -f2-)
[ -n "$SECRET" ] || { echo "ERROR: MTA_FEEDBACK_SECRET missing from $ENV_FILE"; exit 1; }

# Postfix must be writing a log where the bridge can see it. /etc/postfix is a
# volume, so this setting survives an MTA container recreate.
docker exec ems-mta sh -lc \
  'postconf -e maillog_file=/var/spool/postfix/maillog && postfix reload >/dev/null 2>&1' || true

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --restart unless-stopped \
  --network hostssh \
  -v "$VOL":/var/spool/postfix:ro \
  -e MAILLOG_PATH=/var/spool/postfix/maillog \
  -e MAILLOG_API_URL=http://ems:8787 \
  -e MTA_FEEDBACK_SECRET="$SECRET" \
  -w /app "$IMAGE" \
  pnpm --filter @ems/maillog-bridge start >/dev/null

sleep 5
docker logs --tail 3 "$NAME"
