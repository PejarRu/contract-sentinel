# Session Handoff — contract-sentinel

> **STATUS: LATEST / ACTUAL** — this is the current handoff. Older handoffs are invalid.
> **Date:** 2026-09-24 00:00 Europe/Madrid  
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
| Remote | `github.com:PejarRu/contract-sentinel` |

## Current state

- Phase: **01 done** — scaffold + pipeline a–e (auditor stub).
- Tests: **12/12 passing** | typecheck: **green**
- Smoke: `MOCK_MODE=1 npm run once` — 2 candidates, 2 contracts, 2 findings
- VPS: not deployed

## Feature state

| Feature | Status |
|---------|--------|
| Scanner | done |
| Linker | done |
| Resolver | done |
| Auditor stub | done |
| Orchestrator + email | done |

## Safety

Read-only; no keys; no `.env` in git; Etherscan key env-only.

## Open work

- [x] Fase 01
- [ ] Fase 02 auditor
- [ ] Fase 03 deploy

## Commands

```bash
npm run typecheck && npm test
npm run once
```
