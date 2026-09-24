# DECISIONS — contract-sentinel

Formato: `## D00N — título` + contexto + decisión + tradeoff. Como morpho.

## D001 — SQLite driver

Decisión: usar `better-sqlite3` (vs `node:sqlite` nativo).
Contexto: `better-sqlite3` es el estándar del equipo (morpho-liquidation usa el mismo). Ofrece sync API, WAL mode, y madurez.
Tradeoff: npm install más lento por native build; no hay alternativa pura JS con igual rendimiento.

## D002 — Fuentes de discovery

Decisión: Etherscan API v2 como fuente primaria, con fallback DefiLlama/DexScreener/GeckoTerminal.
Contexto: Prompt especifica Etherscan API v2 con `chainid=1`.
Tradeoff: Dependencia de API key de Etherscan; fallback mantiene funcionalidad sin clave.

## D003 — Auditor stub vs rules en fase 1

Decisión: Fase 1 = stub puro; rules van a PROMPTS/02.
Contexto: Scope de fase 01 es scaffold + pipeline completo. Auditor real requiere análisis de seguridad profundo.
Tradeoff: Pipeline incompleto sin auditor real; pero scaffold valida toda la infraestructura.
