# Mejoras futuras — QA determinística en 3 tiers (idea usuario, sesión 2026-09-28)

## Tier 1 — script regex/simbólico sobre los 827 contratos ($0, segundos, sin LLM)
- Clases detectables determinísticamente: missing-modifier, `tx.origin` auth, selfdestruct sin guard,
  mint/burn sin cap, honeypot (transfer restrictivo), blacklist/drain, delegatecall con input externo.
- Output: mismo sheet2 (veredicto+pruebas) como hace ahora, pero reproducible y barato.
- Mismo bytecode = mismo veredicto (idempotente). Si lo arreglan/upgradearon → un re-scan y listo, nada invalida.

## Tier 2 — mini-LLM solo filas hit + LP≥10k
- El filtro dexscreener ya implementado hace esto (LP<10k descarta). Mínimo gasto actual.

## Tier 3 — PoC con forge/invariant-fuzz en fork mainnet ($0)
- Genera tx real del exploit + monto exacto extraíble → mata el "monto estimado" manual.
- Pruebas locales no gastan gas; live solo si PoC green.

## CANDIDATOS MONETIZABLES (QA final 2026-09-28, sheet2 'Revisiones')
1. fila 188: 0xadb606c50dbd08bf33061b5c13be9c6ab8f4fc62 (Quantum Cat, QCAT) — LP $10,301, vol24 $63,524 (líquido)
   - bug_real: notifyReward reparte rewards por balance/supply instantáneos (lines 243-272);
     transfer sin holding-period (383-447).
   - PoC payload: comprar x QCAT → `collect()` (selector 0xce3f865f...06689a) → `claim()` → vender.
   - Reward actual: 1.240425933073158977 unidades de 0xb219915544a30b28d87f3b92434b4d08b39784e5
     (token SIN par dexscreener → valor $ sin cotizar aún; capturar fracción = x/(supply+x)).
2. fila 191: 0xe9ac549be395f50602cb1a45410af173152f484e (Quantum Pepe, LP ≈ $28,078)
   - MISMO patrón; reward 4.095850640370007095 de mismo reward-token.

PENDIENTE si se persigue: valorar 0xb2199155... (holder/holder de LP, decimal, ¿pool interno?);
fork-PoC gratis confirma monto exacto antes de gastar nada; wallet+fondos live solo si PoC verde.

QA stats finales: fp:43 descartado_filtro:182 vacío:~600 requiere_mas_pruebas:0 bug_real:2.
