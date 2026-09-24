# Session Handoff — contract-sentinel

> **STATUS: LATEST / ACTUAL** — this is the current handoff. Older handoffs are invalid.
> **Date:** _(rellenar YYYY-MM-DD HH:MM Europe/Madrid)_  
> **Git:** main tip at last content refresh — **always re-check** `git log -1 --oneline`.  
> **Previous handoffs:** supersede entirely (do not merge).

New session: read `START.md` → this file → active `PROMPTS/`.

## Goal

Read-only bot: discover newly listed protocols/tokens (Ethereum), resolve verified Solidity (+ proxy), run auditor (stub until fase 2), persist SQLite, report/email. No signing.

## Canonical paths

| What | Path |
|------|------|
| Repo | `/mnt/shared/work_projects/Proyectos de trabajo/_activos/contract-sentinel` |
| Style ref | `.../_activos/morpho-liquidation` |
| Remote | `github.com:PejarRu/contract-sentinel` (cuando exista) |

## Current state

- Phase: `01` not started | scaffold | done (elegir).
- Tests: _ / typecheck: _
- VPS: not deployed

## Feature state

| Feature | Status |
|---------|--------|
| Scanner | pending |
| Linker | pending |
| Resolver | pending |
| Auditor stub | pending |
| Orchestrator + email | pending |

## Safety

Read-only; no keys; no `.env` in git; Etherscan key env-only.

## Open work

- [ ] Fase 01 si no hecha
- [ ] Fase 02 auditor
- [ ] Fase 03 deploy

## Commands

```bash
npm run typecheck && npm test
npm run once
```
