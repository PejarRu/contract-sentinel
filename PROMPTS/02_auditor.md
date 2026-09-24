# PROMPTS/02 — Auditor real (fase 2)

**Activar solo cuando** `PROMPTS/01` esté completado y el usuario diga “fase 2” / “auditor”.

## Objetivo

Sustituir `StubAuditor` por análisis real del código fuente ya cacheado. Sigue **read-only** (no despliega, no simula exploits en mainnet sin red aislada).

## Alcance mínimo recomendado

1. **Rules estáticas en TS** (sin dependencias pesadas al principio):
   - `delegatecall` a storage no constante / slots raros
   - `tx.origin` vs `msg.sender`
   - `selfdestruct` / `suicide`
   - `call.value` / reentrancy patterns básicos
   - `ecrecover` sin eip712 / firmas flojas
   - owner renunciable / Ownable sin two-step
   - `block.timestamp` en oráculos de precio
   - mint/burn sin supply cap (si hay ERC20 ABI)
   - proxy: implementation sin `initializer` / `initializer` rellenable
2. **Salida**: `Finding[]` con severidad + snippet del fichero/línea.
3. **Persistencia**: en `findings` (ya en schema fase 1).
4. **Informe**: HTML/email lista hallazgos por dirección.

## Opcional (si sobra tiempo o se pide)

- `solc`/`slither` como binario opcional (`SLITHER_ENABLED=1`) — wrapper en `src/audit/slither.ts`, nunca en el path por defecto de tests.
- Diffs vs implementation cacheada.

## Interfaces

Mantener `AuditInput` / `Finding` / `Auditor` de la fase 1. Cambios → `DECISIONS.md` + handoff.

## Tests

- Fixtures Solidity con true/false positivos por regla.
- Snapshot de `Finding[]` en `reports/fixtures/`.
- `typecheck` + `npm test` verdes.

## Entrega

Commit + push + `SESSION_HANDOFF` (“auditor fase 2 activo”, reglas listadas).

---

Si el usuario no ha activado la fase, **no** la empieces; termina o retoma 01.
