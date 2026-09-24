# Session Handoff — contract-sentinel

> **STATUS: LATEST / ACTUAL** — this is the current handoff. Older handoffs are invalid.
> **Date:** 2026-09-24 00:00 Europe/Madrid  
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

- Phase: **02 done** — auditor real activado (10 reglas estáticas TS).
- Tests: **22/22 passing** | typecheck: **green**
- Smoke: `MOCK_MODE=1 npm run once` — 2 candidates, 2 contracts, 2+ findings
- VPS: not deployed

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
- [ ] Fase 03 deploy

## Commands

```bash
npm run typecheck && npm test
npm run once
```
