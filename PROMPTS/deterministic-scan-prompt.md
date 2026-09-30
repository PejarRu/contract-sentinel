# Prompt: Ejecutar escáner determinista sobre 827 contratos

## Contexto

Estás en el proyecto `contract-sentinel`. Hay 827 contratos en la pestaña `contrato encontrados` de Google Sheets. Ya se ejecutó una QA manual que identificó 2 `bug_real` (Quantum Cat y Quantum Pepe, reward-sniping). Los otros 825 contratos tienen veredicto `fp`, `descartado_filtro` o están vacíos.

**Tu tarea:** ejecutar el escáner determinista (Tier 1, 0 tokens LLM) sobre TODOS los 827 contratos y devolverme solo los hits que merecen deep-audit manual.

## Cómo ejecutar

```bash
cd "/mnt/shared/work_projects/Proyectos de trabajo/_activos/contract-sentinel"
set -a; . secrets/local.env; set +a
npx tsx src/deterministic/run.ts
```

Tarda ~5-7 minutos. Lee SOLO los contratos locales en `contracts/<addr>/<addr>.sol`. No usa LLM — solo regex.

## Qué hace el escáner

10 verificaciones deterministas:
1. `tx_origin_auth` — autorización con tx.origin en lugar de msg.sender
2. `self_destruct` — selfdestruct sin protección
3. `unrestricted_mint` — mint público sin límites
4. `owner_drain` — owner puede drenar fondos (withdraw/transferFrom sin restricción)
5. `delegatecall_input` — delegatecall con input externo sin validación
6. `cei_violation` — violaciones CEI (call externo antes de update de estado)
7. `honeypot_patterns` — blacklists, bloqueos de transfer
8. `quantum_reward_pattern` — patrón específico de reward-sniping (notifyReward sin holding period)
9. `erc20_transfer` — falta función transfer estándar
10. `unauthorized_calls` — llamadas externas sin checks de autenticación

Output: escribe en pestaña `Revisiones` columnas H:L (veredict, pruebas, explotable, notas, fecha) + genera `/tmp/deterministic_scanner_report.md`.

## Lo que necesito de vuelta

1. **Reporte resumido:** cuántos contratos con findings, desglose por severidad (critical/high/medium/low)
2. **Lista de hits high/critical:** address, nombre, findings detectados
3. **Confirmación de que QCAT y QPEPE aparecen** como `high` (reward pattern)
4. **Ruta del reporte:** `/tmp/deterministic_scanner_report.md`

NO necesito:
- Lista de FPs o contratos sin findings
- Logs detallados de ejecución
- Explicaciones de qué hace cada check

## Notas

- Si falla por OAuth: las creds están en `secrets/local.env`
- Si falla porque no encuentra un .sol: normal, algunos contratos no se descargaron. Ignora y sigue.
- Si el sheet da 403/429: reintentar hasta 8 veces con 90s de espera
- No commits, no git, no tocar `src/`
