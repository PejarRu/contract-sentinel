# PROMPTS/03 — Docker / VPS (opcional)

**Activar** solo con remote GitHub + fase 01 verde.

## Local Docker

- `docker-compose.yml` estilo morpho: servicio `sentinel`, env `${VAR:-default}`, volumes:
  - `./data:/app/data` (SQLite)
  - `./contracts:/app/contracts`
  - `./reports:/app/reports`
- `docker compose run --rm sentinel once` smoke.

## VPS (cuando exista host del equipo)

Patrón heredado de `morpho-liquidation`:

1. VPS **sin** SSH a GitHub → `git bundle create … HEAD --not <base>` local → scp → `git fetch` → `checkout -f --detach <SHA>`.
2. `/opt/contract-sentinel/{app,data,runtime,secrets}`.
3. `secrets/` o `shadow.env`-style solo en servidor: `ETHERSCAN_API_KEY`, SMTP — **nunca** en git.
4. `docker compose build && up -d sentinel`.
5. Verificar logs heartbeat + `reports/` + salida de un `--once`.

Host conocido del equipo (solo si el usuario lo confirma): `root@91.99.142.12` — mismo cuidado que morpho (no tocar morpho sin petición).

## Handoff

Documentar SHA desplegado, contenedor, env vars puestas, y “cómo se redespliega” en `SESSION_HANDOFF`.
