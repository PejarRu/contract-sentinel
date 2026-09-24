# contract-sentinel

Auditor automática **read-only** de protocolos/tokens recién desplegados (Ethereum).

## Cómo empezar

1. Lee [`START.md`](./START.md) — orden de sesión.
2. Reglas: [`AGENTS.md`](./AGENTS.md) + workspace `/mnt/shared/work_projects/AGENTS.md`.
3. Fase activa: [`PROMPTS/01_plan_scaffold.md`](./PROMPTS/01_plan_scaffold.md).

## Fases de prompts

| Fichero | Cuándo |
|---------|--------|
| `PROMPTS/01_plan_scaffold.md` | **Por defecto** — PLAN + código sin auditor real |
| `PROMPTS/02_auditor.md` | Tras 01, si se pide fase 2 |
| `PROMPTS/03_deploy.md` | Docker/VPS al final |

## Estado

Ver [`docs/SESSION_HANDOFF.md`](./docs/SESSION_HANDOFF.md) solo si dice `STATUS: LATEST`.

## Próximo

Sesión nueva → copia la línea de `START.md` o abre este repo y di: *“ejecuta contract-sentinel fase 01”*.
