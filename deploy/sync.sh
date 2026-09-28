#!/bin/sh
# Google Sheet tracker sync cron wrapper (host side, mirrors digest.sh).
# crontab: 10 8,20 * * * root /opt/contract-sentinel/sync.sh >> /opt/contract-sentinel/runtime/sync.log 2>&1
set -eu

ROOT=${ROOT:-/opt/contract-sentinel}
ENV_FILE=${ENV_FILE:-$ROOT/secrets/sentinel.env}
cd "$ROOT"

docker compose --env-file "$ENV_FILE" exec -T sentinel npm run sync-sheet
