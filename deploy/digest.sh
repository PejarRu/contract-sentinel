#!/bin/sh
# 12h digest cron wrapper (host side, mirrors heartbeat.sh).
# crontab: 0 8,20 * * * root /opt/contract-sentinel/digest.sh >> /opt/contract-sentinel/runtime/digest.log 2>&1
set -eu

ROOT=${ROOT:-/opt/contract-sentinel}
ENV_FILE=${ENV_FILE:-$ROOT/secrets/sentinel.env}
cd "$ROOT"

docker compose --env-file "$ENV_FILE" exec -T sentinel npm run digest
