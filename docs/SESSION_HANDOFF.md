# Session Handoff — contract-sentinel

> **STATUS: LATEST / ACTUAL** — this is the current handoff. Older handoffs are invalid.
> **Date:** 2026-09-24 16:50 Europe/Madrid  
> **Git:** main tip at last content refresh — **always re-check** `git log -1 --oneline`.  
> **Previous handoffs:** supersede entirely (do not merge).

New session: read `START.md` → this file → active `PROMPTS/`.

## Goal

Read-only bot: discover newly listed protocols/tokens (Ethereum), resolve verified Solidity (+ proxy), run auditor (fase 2 real rules), persist SQLite, report/email. No signing.

## Canonical paths

| What | Path |
|------|------|
| Repo | `/mnt/shared/work_projects/Proyectos de trabajo/_activos/contract-sentinel` |
| Style ref | `.../_activos/morpho-liquidation` |
| Remote | `github.com:PejarRu/contract-sentinel` |

## Current state

- Phase: **03 done** — reproducible Docker deployment live on VPS at SHA `19427ae`.
- Tests: **22/22 passing** | typecheck: **green**
- Smoke: `MOCK_MODE=1 docker compose run --rm --no-deps sentinel once` — 2 candidates, 2 contracts, 0 findings.
- Docker: container `contract-sentinel-sentinel-1` running on `root@91.99.142.12`, healthy, with no published ports.
- Non-mock `--once`: completed as run 2 with 0 candidates, 0 contracts and 0 findings. `ETHERSCAN_API_KEY` is currently empty, so this does not validate live Etherscan discovery.

## Deploy

| Item | Value |
|------|-------|
| Host | `root@91.99.142.12` (Hetzner) |
| SHA deployed | `19427ae` (fix: parameterize Docker build context) |
| Node | `v22.23.3` |
| Docker image | Compose image `contract-sentinel-sentinel` (`node:22-slim` + native build dependencies) |
| DB | `/app/data/contract-sentinel.sqlite` (volume-mounted from `/opt/contract-sentinel/data`) |
| Container name | `contract-sentinel-sentinel-1` |
| Restart policy | `unless-stopped` |
| Ports | none published (exec-only) |

## Exact resume point

- Local deployment artifacts now exist: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, and `deploy/heartbeat.sh`. They contain no secrets.
- Compose uses `${VAR:-default}`, publishes no ports, mounts `data/contracts/reports`, and supports `docker compose run --rm sentinel once` through the image entrypoint.
- `tsx` was moved to runtime dependencies; the Docker image uses a multi-stage `node:22-slim` build for `better-sqlite3`.
- Local `docs/SESSION_HANDOFF.md` is modified and uncommitted.
- Secrets remain only in `/opt/contract-sentinel/secrets/sentinel.env` (`0600`). `ETHERSCAN_API_KEY` is empty, `EMAIL_ENABLED=false`, and SMTP values have not been configured.
- Heartbeat cron exists at `/etc/cron.d/contract-sentinel`; the container healthcheck only verifies that the SQLite file exists.
- Host Node was upgraded to `v22.23.3` because `better-sqlite3@13.0.3` segfaulted under Node 18.
- Checkpoint validation: `docker compose config --quiet`, typecheck, and 22/22 tests passed. Local Docker access was unavailable, so the image was built in `/opt/contract-sentinel/runtime/phase03-build` on the VPS; build and Compose smoke both passed.
- First production rebuild attempt at SHA `136ce48` failed before replacing the healthy container: root Compose used `build: .` while source lives in `/opt/contract-sentinel/app`. Compose is being corrected to `${APP_DIR:-.}`; VPS must set `APP_DIR=./app`.
- Do not touch `morpho-shadow` or `opportunity-radar`.

## Deploy verification (2026-09-24)

- SHA `19427ae` built and deployed via Git bundle; container `contract-sentinel-sentinel-1` **healthy**, watch mode running.
- Heartbeat: `{"heartbeat":"ok","lastRun":{"id":6,"status":"completed",...}}`
- Build context: root Compose uses `${APP_DIR:-.}`; VPS sets `APP_DIR=./app`.
- VPS does **not** push to GitHub (no SSH key there) — all pushes originate locally.

## Remaining (user action)

- Set `ETHERSCAN_API_KEY` and SMTP in `/opt/contract-sentinel/secrets/sentinel.env`, then `docker compose exec sentinel npm run once` (non-mock) to validate live discovery + email.

## Redeploy by bundle

```bash
# 1. Local: create and transfer bundle (VPS has no GitHub SSH access)
cd "/mnt/shared/work_projects/Proyectos de trabajo/_activos/contract-sentinel"
git bundle create /tmp/contract-sentinel.bundle HEAD
scp /tmp/contract-sentinel.bundle root@91.99.142.12:/opt/contract-sentinel/runtime/

# 2. VPS: fetch bundle and detach at its HEAD
ssh root@91.99.142.12
cd /opt/contract-sentinel/app
git fetch /opt/contract-sentinel/runtime/contract-sentinel.bundle HEAD
git checkout -f --detach FETCH_HEAD

# 3. Rebuild and start
cd /opt/contract-sentinel
docker compose up -d sentinel --build

# 4. Verify
docker compose ps
docker compose logs sentinel | tail -5
docker compose exec sentinel npm run once

# 5. Heartbeat
/opt/contract-sentinel/heartbeat.sh
```

## Heartbeat

Cron: `*/5 * * * * root /opt/contract-sentinel/heartbeat.sh >> /opt/contract-sentinel/runtime/heartbeat.log 2>&1`

## Feature state

| Feature | Status |
|---------|--------|
| Scanner | done |
| Linker | done |
| Resolver | done |
| Auditor | **done (fase 2 real)** |
| Orchestrator + email | done |

## Auditor rules (fase 2)

| Rule | Severity | Description |
|------|----------|-------------|
| delegatecall | high | delegatecall usage |
| tx.origin | high | tx.origin auth |
| selfdestruct | critical | selfdestruct/suicide |
| reentrancy | high | .call() without guard |
| ecrecover | medium | ecrecover without EIP-712 |
| Ownable two-step | medium | renounce without transfer |
| block.timestamp oracle | medium | block.timestamp in oracle |
| mint/burn cap | medium | mint/burn without supply cap |
| proxy initializer | medium | initializer without reinitializer |

## Safety

Read-only; no keys; no `.env` in git; Etherscan key env-only.

## Open work

- [x] Fase 01
- [x] Fase 02 auditor
- [x] Fase 03 deploy (Docker + VPS + heartbeat verificado)
- [ ] Credenciales reales (ETHERSCAN/SMTP) — pendiente de usuario

## Commands

```bash
npm run typecheck && npm test
MOCK_MODE=1 npm run once
docker compose up -d sentinel                          # local
APP_DIR=./app docker compose --env-file secrets/sentinel.env up -d sentinel --build   # VPS
/opt/contract-sentinel/heartbeat.sh                     # VPS heartbeat
```
