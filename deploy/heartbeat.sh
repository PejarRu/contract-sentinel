#!/bin/sh
set -eu

ROOT=${ROOT:-/opt/contract-sentinel}
ENV_FILE=${ENV_FILE:-$ROOT/secrets/sentinel.env}
cd "$ROOT"

container_id=$(docker compose --env-file "$ENV_FILE" ps -q sentinel)
if [ -z "$container_id" ]; then
  echo "heartbeat: fail - sentinel container missing"
  exit 1
fi

health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")
if [ "$health" != "healthy" ]; then
  echo "heartbeat: fail - container $health"
  exit 1
fi

docker compose --env-file "$ENV_FILE" exec -T sentinel node --input-type=module -e '
  import Database from "better-sqlite3";
  const db = new Database(process.env.DATABASE_PATH);
  const run = db.prepare("SELECT id, status, started_at, finished_at, error FROM runs ORDER BY id DESC LIMIT 1").get();
  console.log(JSON.stringify({ heartbeat: "ok", lastRun: run ?? null }));
  db.close();
'
