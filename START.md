# contract-sentinel — START (pega esto en una sesión nueva)

```
Proyecto: contract-sentinel
Repo: /mnt/shared/work_projects/Proyectos de trabajo/_activos/contract-sentinel
Hermano estilo: /mnt/shared/work_projects/Proyectos de trabajo/_activos/morpho-liquidation

ORDEN OBLIGATORIO:
1) Lee AGENTS.md (reglas del workspace + del repo).
2) Lee docs/SESSION_HANDOFF.md si STATUS=LATEST; si no, asume estado incierto.
3) Lee el PROMPT de fase activa en PROMPTS/ (hoy: 01_plan_scaffold.md).
4) Ejecuta esa fase de forma autónoma. No preguntes lo obvio.
5) Al terminar la fase: tests + typecheck verdes, commit+push, actualiza SESSION_HANDOFF.

Fases:
- PROMPTS/01_plan_scaffold.md  → PLAN.md + scaffold + pipeline a–e (auditor = stub)
- PROMPTS/02_auditor.md        → fase 2 real del auditor (cuando se active)
- PROMPTS/03_deploy.md         → docker/VPS cuando exista remote+app

Objetivo equipo: read-only radar/auditoría; el dinero operativo está en morpho-liquidation. Este repo NO firma tx.
```

Copia corta en una línea (si solo quieres que el agente arranque):

```text
Lee /mnt/shared/work_projects/Proyectos de trabajo/_activos/contract-sentinel/START.md y sigue el orden; fase activa en PROMPTS/.
```
