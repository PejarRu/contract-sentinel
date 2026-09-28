# Session Handoff — contract-sentinel

> **STATUS: LATEST / ACTUAL** — this is the current handoff. Older handoffs are invalid.
> **Date:** 2026-09-26 17:00 Europe/Madrid  
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

- Phase: **03 done + scanner fix + auditor FP reduction** — live at SHA `425c8f7` (VPS verified, run 101 clean).
- Tests: **33/33 passing** | typecheck: **green**
- Smoke: `MOCK_MODE=1 docker compose run --rm --no-deps sentinel once` — 2 candidates, 2 contracts, 0 findings.
- Docker: container `contract-sentinel-sentinel-1` on `root@91.99.142.12`, healthy, no published ports.
- Live data (run 90, first real with fixed scanner): **16 candidates, 16 contracts resolved, 10 findings** (pre-FP-reduction rules).

## Deploy

| Item | Value |
|------|-------|
| Host | `root@91.99.142.12` (Hetzner) |
| SHA deployed | `5884751` (fix(scanner): discovery real) |
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
- Secrets remain only in `/opt/contract-sentinel/secrets/sentinel.env` (`0600`). `ETHERSCAN_API_KEY`, SMTP y `EMAIL_ENABLED=true` configurados (2026-09-26); nunca en git.
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

## Bug (fixed 2026-09-25): scanner descubría 0 candidatos

- **Causa raíz:** Etherscan `action=contractlist` no existe → respuesta NOTOK silenciosa → 89 runs "completed" con 0 candidatos. Tampoco existía `getbytecode` (detección de proxy muerta).
- **Fix en `5884751`:**
  - Discovery: GeckoTerminal `GET /api/v2/networks/eth/new_pools?include=base_token` (primario, sin key), DexScreener `token-profiles/latest/v1` + `tokens/v1` (fallback). Errores de ambas fuentes ahora **fallan el run** en vez de silenciar.
  - Resolver: migrado a `api.etherscan.io/v2/api?chainid=1` (getsourcecode OK verificado en vivo).
  - Proxy: `eth_getStorageAt` en slots EIP-1967 (impl + admin), en vez del endpoint inexistente.
  - Dedupe intra-batch (mismo token en varios pools).
- Verificado end-to-end en local y VPS: 16 candidatos → 16 contratos con source → 10 findings.

## Auditor FP reduction + pentest manual (2026-09-25, `f79a16a`)

- **Pentest de los 6 `.sol` con source verificado:** los 10 findings originales eran falsos positivos (verificados línea a línea): delegatecall todo en libs OZ (incluso un comentario NatSpec `@custom:oz-upgrades-unsafe-allow`), mint/burn solo constructor sin entrada pública, Ownable single-step = patrón estándar. `setMarket`/`enableHolderFees`/`notifyReward` (FINE) y `reduceFee`/`manualSwap` (B-MISHA) tienen guard inline verificado — sin bug explotable. Sin bug bounty programs en estos tokens; contacto directo solo si aparece bug real.
- **Fix en auditor (`f79a16a`):** expand de wrappers Etherscan `{{...}}` a ficheros con paths reales → exclusión de vendored (`lib/`, `@`, `openzeppelin`, `contracts/{proxy,upgradeability,util}/`, markers de contenido) → strip de comentarios antes de las reglas → mint/burn exige entrada pública (function public/external o ABI) → Ownable de medium→low con detección real de two-step (`acceptOwnership`/`pendingOwner`) → dedupe por título.
- **Validación empírica con los 6 reales:** 10 findings → 2 (FINE reentrancy high por `.call{value}` en `claim()` sin guard — CEI manualmente correcto, es señal de revisión; TEST Ownable low). 4 contratos → 0.
- Tests: 33/33 (8 nuevos de regresión FP).

## Implementation de proxies auditado (2026-09-25, `5cc57a5`)

- Script `/tmp/opencode/fetch_impls.ts`: lee slot EIP-1967 impl+admin de los 21 proxies marcados + EURI/JPYC, baja source de cada implementation vía Etherscan v2, audita. Resultado: 4 implementations reales (EURI `0x039a26c8…` 93 líneas, JPYC `0xafac17fc…` 75 líneas, `0xb5276c43…`, `0x6890cde2…`), 19 direcciones no son proxies de verdad.
- **EURI y JPYC impl: [medium] Mint/burn without supply cap** — verificado manualmente: ambos tienen `mint(...) external` con solo `onlyOwner`/`onlyMinters`+allowance, sin cap de supply. Centralización/diseño, no bug explotable. EURI además: `freeze`/`unpause`/`setTrustForwarder` onlyOwner (ERC2771). JPYC: fork de USDC FiatTokenV2 (blocklist, pausable, minters+minterAllowance).
- Otros 2 impls: 0 findings.
- **Bugs corregidos en `5cc57a5`** (34/34 tests):
  1. Resolver: `eth_getStorageAt` con rate-limit de Etherscan devolvía texto libre → se guardaba como `implementation` corrupta en 21 filas. Fix: regex `^0x[0-9a-f]{64}$`.
  2. Auditor: `isVendored` filtraba por contenido `openzeppelin-contracts` — un fichero de proyecto con `import "openzeppelin-contracts-upgradeable/…"` se excluía entero (falso negativo: EURI no disparaba). Fix: strip de líneas `import` antes del test de contenido.
- Findings históricos corruptos en DB (`implementation = "0xcalls per sec…"`) — limpiables con UPDATE cuando convenga.

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
| delegatecall | high | delegatecall en código propio (libs excluidas) |
| tx.origin | high | tx.origin auth |
| selfdestruct | critical | selfdestruct/suicide |
| reentrancy | high | .call() without guard |
| ecrecover | medium | ecrecover without EIP-712 |
| Ownable two-step | **low** | sin acceptOwnership (nota centralización) |
| block.timestamp oracle | medium | block.timestamp in oracle |
| mint/burn cap | medium | entrada pública mint/burn sin cap |
| proxy initializer | medium | initializer without reinitializer |

Preprocesado: expand wrappers, excluir vendored, strip comentarios, dedupe. Solo código propio del proyecto.

## Digesto email 12h (`86da960`, desplegado 2026-09-26)

- `src/digest.ts` (`npm run digest`, `--dry-run` imprime sin enviar): consulta candidatos + findings de las últimas `DIGEST_WINDOW_H` (12h) → HTML+texto → artifact en `reports/digest-*.html|txt` → envía si `EMAIL_ENABLED=true`. Prioriza filas con hallazgos ordenadas por severidad; enlaces a explorer por chainId.
- `src/report/email.ts`: cliente SMTP propio (node:net/tls, sin dependencias — estilo `morpho-liquidation/src/report/email.ts`). Config `SMTP_URL` o `SMTP_HOST/PORT/USER/PASSWORD` + `EMAIL_ENABLED/TO/FROM`. AUTH redactado en errores.
- `deploy/digest.sh` + cron VPS: `0 8,20 * * * root /opt/contract-sentinel/digest.sh >> runtime/digest.log`.
- Tests 49/49 (email 9 + digest 6 + base 34). Validado en VPS: 103 filas/12h, 23 con hallazgos (14 high, 5 medium, 8 low).
- **Sin duplicados (`079c819`, desplegado 2026-09-26 22:04)**: tabla `digest_state` (id=1, `last_sent_at`) — cada digesto arranca desde el último envío confirmado (nunca reenvía contenido), solo se avanza el marcador tras envío SMTP exitoso; `SELECT DISTINCT` en findings (colapsa los 2 pares legacy duplicados por era rate-limit); si 0 filas nuevas → `digest skipped: nothing new since …` sin enviar. Fallback a ventana 12h fija solo en el primer run. Verificado: 1er envío → 2ª ejecución `digest skipped`. Tests 49/49.
- **SMTP configurado (2026-09-26)**: credenciales copiadas de `/opt/morpho-shadow/secrets/shadow.env` (método SMTP idéntico, plantillas propias) → `/opt/contract-sentinel/secrets/sentinel.env` (0600, gitignored). `EMAIL_ENABLED=true`, `EMAIL_TO=berzinsanton@gmail.com`, `smtp.gmail.com:587`. Primer envío real verificado: `digest sent (120 contratos, 21 con hallazgos)`.

## Google Sheet tracker (`27f378b`, desplegado 2026-09-28)

- **Sync bidireccional** `npm run sync-sheet` (`src/sync_sheet.ts`): SQL → Sheet (todas las columnas A–H, M) y Sheet → SQL (columnas humanas I–L → tabla `reviews`). Fuente de verdad única: el bot solo añade columnas A–H+M; I–L (`ESTADO`, `revisado_en`, `notas`, `bounty`) las escribe el humano y el pull las conserva en la DB.
- Sheet: **«Contract Sentinel — Tracker de revisión»**, `SHEET_ID=1V8Gq7TPGXaC4JF1bYMRxu0V7XQcjrB_s6iutt8Y0g3s`. Cabeceras: `address,nombre,simbolo,chain,visto,src,findings,sev_max,ESTADO,revisado_en,notas,bounty,etherscan`.
- Tabla `reviews (address PK, status, reviewed_at, notes, bounty, updated_at)` — SIN FK (hoja editable; filas huérfanas no rompen pull). `normalizeStatus` acepta aliases (`falso positivo`→fp, `bug real`→bug_real); desconocido→`pendiente`.
- `mergeSheetRows`: preserva orden humano + I–L del existing, actualiza A–H+M, stale intactas, nuevas al final. **Rango PUT = `A2:M${merged.length+1}`** (fila 1 = cabecera; el `merged.length` a secas daba `tried writing to row 805`).
- `src/lib/sheets.ts`: cliente fetch cero-dep; token refresh con **retry 3× backoff** (Google devuelve 400 intermitente `Invalid JSON payload` — curl siempre OK, era transitorio Google-side, no creds). Error serializa `JSON.stringify(data)` (antes `[object Object]`).
- OAuth: client web `941748425000-tq8e9lkeb8r0qihcp819941s0i28rr7l.apps.googleusercontent.com`, redirect `http://localhost:8765` (SIN trailing barra). Creds en `secrets/sentinel.env` (0600, gitignored). **Compose whitelist**: `docker-compose.yml` debe listar `GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN`, `SHEET_ID` en `environment:` (sin eso el container no los ve).
- Cron VPS: `10 8,20 * * * root /opt/contract-sentinel/sync.sh >> runtime/sync.log` (5 min tras cada digesto).
- Primer sync real: **804 filas push + 804 pull**. Tests 54/54.
- **Bidireccional verificado en vivo (2026-09-28)**: edición simulada en Sheet → pull → `reviews` OK; edición sobrevive al push siguiente (merge preserva I–L); 827 filas a las 10:33.
- **Pestaña `Revisiones` (dominio de la sesión de revisión, 2026-09-28)**: pestaña 2 del Sheet, creada vía API (sheetId 1294271795). A–G = clon live por `=ARRAYFORMULA(IF(...;"";...))` de la pestaña principal (address, nombre, sev_max, findings, etherscan, visto, ESTADO_tracker) — **locale es_ES ⇒ separador `;` en fórmulas** (con `,` daba #ERROR!). H–L editables por esa sesión: veredicto, pruebas_ejecutadas, explotable, notas_detalladas, fecha_revision. Grids ampliados a 5000 filas (PUT falla al superar grid). Pestaña principal renombrada por el usuario a **«Contrato encontrados»** (el sync usa rangos sin calificar → indiferente). Dominios: bot toca solo pestaña 1 (A–H,M + pull I–L); sesión de revisión solo H–L de Revisiones.
- **Credenciales locales**: `secrets/local.env` (0600, gitignored) = GOOGLE_* + SHEET_ID + ETHERSCAN_API_KEY copiadas del VPS — para sesiones locales de revisión.

## Safety

Read-only; no keys; no `.env` in git; Etherscan key env-only.

## Open work

- [x] Fase 01
- [x] Fase 02 auditor
- [x] Fase 03 deploy (Docker + VPS + heartbeat verificado)
- [x] Fix scanner discovery (GeckoTerminal/DexScreener + Etherscan v2) — datos reales fluyendo
- [x] Auditor FP reduction (`f79a16a`) + pentest manual de los 6 contratos
- [x] Redesplegar `f79a16a+` al VPS y verificar findings re-triaged en DB — **`425c8f7` desplegado, run 101 completed con 0 findings sobre contratos nuevos (38 contratos en DB; re-triage OK)**
- [x] Fetch de source de `implementation` en proxies — hecho; EURI/JPYC impls auditados (medium mint/burn sin cap, centralización)
- [x] Fix auditor falso negativo por imports OZ + resolver rate-limit (`5cc57a5`)
- [x] SMTP (copiado de morpho-shadow 2026-09-26; primer digesto real verificado)
- [ ] Primer digesto por cron real (08:00/20:00) — verificar `runtime/digest.log` el 27-09 a las 08:00
- [x] Google Sheet tracker sync bidireccional (`27f378b`, primer sync 804 filas, cron 8:10/20:10)
- [ ] Primer sync por cron real — verificar `runtime/sync.log` el 29-09 a las 08:10
- [ ] Marcar primeros ESTADO en el Sheet y comprobar que el pull los refleja en `reviews`

## Commands

```bash
npm run typecheck && npm test
MOCK_MODE=1 npm run once
docker compose up -d sentinel                          # local
APP_DIR=./app docker compose --env-file secrets/sentinel.env up -d sentinel --build   # VPS
/opt/contract-sentinel/heartbeat.sh                     # VPS heartbeat
```
