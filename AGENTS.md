# AGENTS.md — contract-sentinel

Leer antes de tocar este repo. Edits quirúrgicos; no reescribir ficheros grandes sin motivo.

## Herencia de workspace (reglas duras)

Ver también:

- `/mnt/shared/work_projects/AGENTS.md` — 1 proyecto = 1 repo = 1 remote; local = mirror de GitHub; eficiencia > perfección.
- `/mnt/shared/work_projects/Proyectos de trabajo/AGENTS.md` — vive en `_activos/`; docs dentro del repo; git primero, push frecuente.
- `~/.config/opencode/AGENTS.md` — eficiencia de contexto (grep > read, respuestas cortas, compactar).

## Qué es este proyecto

Bot **read-only** de auditoría de protocolos/tokens recién desplegados (Ethereum mainnet).

Pipeline: `SCANNER → ENLAZADOR → RESOLVER → AUDITOR (stub fase 1) → ORQUESTADOR`  
Estado en SQLite; informes `reports/` + email opcional por env; Docker opcional.

**No** firma tx, **no** usa claves privadas, **no** ejecuta código de terceros on-chain.

## Key files (rellenar al hacer scaffold)

| Path | Role |
| --- | --- |
| `START.md` | Punto de entrada de sesión |
| `PROMPTS/` | Specs por fase |
| `PLAN.md` | Arquitectura (fase 1) |
| `src/scanner/` | Descubrimiento de candidatos |
| `src/resolve/` | Link web + proxy/implementation + source |
| `src/audit/` | `Auditor` interface + `StubAuditor` |
| `src/orchestrator.ts` | Cadena + retries + CLI |
| `src/lib/db.ts` | SQLite schema |
| `email_templates/` | HTML email `{{KEY}}` |
| `docs/SESSION_HANDOFF.md` | Handoff LATEST |
| `DECISIONS.md` | Decisiones D001… |

## Commands

```bash
npm run typecheck
npm test
npm run once    # un ciclo
npm run watch   # continuo
```

Tests nuevos → añadir al script de `package.json`.

## Safety / ops

- `.env.example` documentado; **nunca** commit de `.env` ni secretos.
- Rate-limit Etherscan: backoff global; fixtures en tests (sin red por defecto).
- SMTP/email solo con `EMAIL_ENABLED=true` + vars de entorno.
- Deploy futuro VPS (como morpho): `git bundle` desde local (la VPS no SSH a GitHub), `checkout -f --detach <SHA>`, Docker en `/opt/contract-sentinel`.

## Session handoff (mandatory)

Misma regla que morpho-liquidation:

| Rule | Detail |
| --- | --- |
| File | `docs/SESSION_HANDOFF.md` — un solo handoff, sobrescribir in place |
| Header | `STATUS: LATEST / ACTUAL`, `Date:` YYYY-MM-DD HH:MM Europe/Madrid; Git = re-check `git log -1` |
| When | fin de sesión/compact, cambio de SHA/deploy, cambio de pipeline/gates, fallo/fixed, migración pedida |
| Cadence | ~cada 2h o hito |
| Open | leer este AGENTS → SESSION_HANDOFF antes de editar |
| Content | goal, paths, SHA, estado módulos, env, tests, open work — no diario |

Sin `STATUS: LATEST` → estado desconocido: verificar git antes de cambios.

## Decision log

`DECISIONS.md` — al cambiar fuentes de datos, esquema, gates de filtro, email o deploy.

## Contexto del equipo (no confundir)

- **morpho-liquidation** = repo de liquidaciones vivo (dinero/gates). Referencia de estilo.
- **contract-sentinel** = este (auditoría automática read-only).
- Otros cripto en el workspace no se mezclan en este remote.
