# contract-sentinel

Auditor automática **read-only** de protocolos/tokens recién desplegados (Ethereum).

## Cómo empezar

1. Lee [`START.md`](./START.md) — orden de sesión.
2. Reglas: [`AGENTS.md`](./AGENTS.md) + workspace `/mnt/shared/work_projects/AGENTS.md`.
3. Fase activa: [`PROMPTS/01_plan_scaffold.md`](./PROMPTS/01_plan_scaffold.md).

## Instalación

```bash
npm install
cp .env.example .env   # rellenar ETHERSCAN_API_KEY y vars de entorno
```

## Comandos

```bash
npm run typecheck
npm test
npm run once    # un ciclo (con MOCK_MODE=1 para smoke test sin red)
npm run watch   # continuo
```

## Pipeline

`SCANNER → ENLAZADOR → RESOLVER → AUDITOR (stub) → ORQUESTADOR`

- **Scanner**: descubre candidatos nuevos vía Etherscan API v2
- **Linker**: encuentra URL oficial y extrae direcciones
- **Resolver**: detecta proxies (EIP-1967), obtiene source verificado
- **Auditor**: stub (fase 1); reglas reales en PROMPTS/02
- **Orchestrator**: orquesta la cadena + retries + CLI

## Salida de ejemplo

```
Run 1: completed — 2 candidates, 2 contracts, 2 findings
```

## Docker

```bash
docker compose run sentinel once
# Volumes: ./data, ./contracts, ./reports
```

## Fases de prompts

| Fichero | Cuándo |
|---------|--------|
| `PROMPTS/01_plan_scaffold.md` | **Por defecto** — PLAN + código sin auditor real |
| `PROMPTS/02_auditor.md` | Tras 01, si se pide fase 2 |
| `PROMPTS/03_deploy.md` | Docker/VPS al final |

## Estado

Ver [`docs/SESSION_HANDOFF.md`](./docs/SESSION_HANDOFF.md) solo si dice `STATUS: LATEST`.

## Próximo

Sesión nueva → copia la línea de `START.md` o abre este repo y di: *"ejecuta contract-sentinel fase 01"*.
