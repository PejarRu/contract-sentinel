# Handoff — auditoría completa de contratos

> **Actualizado:** 2026-09-28
> **Estado:** pausada por petición del usuario. Reanudar desde este documento sin repetir trabajo.

## Objetivo

Auditar las **827 filas** de la pestaña Google Sheet `contrato encontrados`, incluidas filas ya marcadas `revisado`. La pestaña fuente es solo lectura. Escribir exclusivamente columnas **H:L** de la fila correspondiente en `Revisiones`.

La pestaña `QA` pertenece a otro proceso: **solo lectura, nunca escribir M:N ni ninguna otra columna**.

## Punto exacto de reanudación

Conteo confirmado tras cerrar las cuatro filas que requerían más pruebas:

| Veredicto | Cantidad |
|---|---:|
| `descartado_filtro` | 182 |
| `fp` | 43 |
| `bug_real` | 2 |
| Sin veredicto | 600 |
| **Total** | **827** |

No queda ninguna fila `requiere_mas_pruebas`.

Último lote normal completado: **225/827**. Después se resolvieron las cuatro pendientes y se alcanzó el conteo anterior. La próxima sesión debe cargar ambas pestañas y seleccionar únicamente filas cuyo veredicto H de `Revisiones` esté vacío; no confiar solo en el número 225 porque hubo trabajo fuera del orden secuencial.

## Bugs reales confirmados

### Fila 188 — Quantum Cat

- Address: `0xadb606c50dbd08bf33061b5c13be9c6ab8f4fc62`
- Source local: `contracts/0xadb606c50dbd08bf33061b5c13be9c6ab8f4fc62/0xadb606c50dbd08bf33061b5c13be9c6ab8f4fc62.sol`
- Bug: reward sniping. `notifyReward` distribuye según balance/supply instantáneos (`Contract.sol:243-272`); checkpoints de transfer solo rebajan deuda histórica, sin periodo mínimo de tenencia (`Contract.sol:383-447`).
- Secuencia mínima: comprar `x` QCAT → llamar `collect(419994)` → `claim()` → vender.
- Payload de `collect`: selector `0xce3f865f`, argumento `419994` (`...0006689a`), `msg.value=0`.
- Estado comprobado en bloque `26076089`: reward `1.240425933073158977 QNT`; captura teórica `R*x/(S+x)`, `S=210389432186327552866054638`.
- LP observado: aproximadamente `$11,285`. No afirmar drenaje total: beneficio depende de tamaño de compra, slippage y precio de QNT.

### Fila 191 — Quantum Pepe

- Address: `0xe9ac549be395f50602cb1a45410af173152f484e`
- Source local: `contracts/0xe9ac549be395f50602cb1a45410af173152f484e/0xe9ac549be395f50602cb1a45410af173152f484e.sol`
- Mismo bug y líneas: `Contract.sol:243-272,383-447`.
- Secuencia mínima: comprar `x` QPEPE → llamar `collect(419993)` → `claim()` → vender.
- Payload: selector `0xce3f865f`, argumento `419993` (`...00066899`), `msg.value=0`.
- Bloque `26076089`: reward `4.095850640370007095 QNT`; captura `R*x/(S+x)`, `S=575252483858740406731527389`.
- LP observado: aproximadamente `$28,078`.

Si aparece otro `bug_real_explotable_tercero`, informar al usuario **inmediatamente** con address, `archivo:línea`, función, payload mínimo y monto estimado; después continuar solo si el usuario no ordena parar.

## Cuatro pendientes ya cerradas

- Fila 184 Housecoin `0x1b409b5ccd31ea613b6bdae2b4cca7b80f5fefe1`: `fp`. `transferFrom` exige allowance y revierte `ERC20InsufficientAllowance` (`Contract.sol:477-486,490-493`); $0 extraíble.
- Filas 188 y 191: reclasificadas `bug_real`, detalladas arriba.
- Fila 204 REACH Credits `0x6cfb2531696f99cd4511f281abece4b6a67c3792`: `fp`. Source no verificado; bytecode de 7,102 bytes revisado. Métrica Dex anómala procedía de approvals, no pool; supply y `totalPurchased` = `799.705062454 RCH`, `totalRedeemed=0`; emisión role-gated, sin mint público ni drenaje demostrado. Source placeholder/resultado Etherscan guardado en `contracts/0x6cfb2531696f99cd4511f281abece4b6a67c3792/`.

## Reglas obligatorias al continuar

1. Orden: critical/high sin veredicto; filas revisadas pendientes de confirmación; medium con ≥2 findings; después resto vacío.
2. DexScreener antes del código, hasta **3 intentos**, `sleep 5s`. Si falla, fallback Etherscan `account&action=balance`.
3. Descartar si: sin pares on-chain; LP `< $10,000`; vol24 `< $500` y edad `>30 días`; wrapped/stable/bridge/fee-token. Escribir motivo en H:L.
4. Si pasa filtro: leer **todo el código relevante**, implementation incluida en proxies. Findings previos son pistas, no verdad.
5. Guardar source faltante en `contracts/<address>/<address>.sol`, siguiendo formato existente.
6. Columna K debe incluir evidencia `archivo:línea` para **cada hallazgo descartado**, indicando guard/lock/cap concreto.
7. Clasificar `bug_real_explotable_tercero`, `centralizacion_por_diseño` o `falso_positivo`; H admite `fp | bug_real | descartado_filtro | reportado`.
8. Prohibido transaccionar contra contratos vivos. Solo source, RPC/eth_call, simulación local o fork.
9. No ejecutar `npm run sync-sheet`; no tocar pestaña fuente ni `QA`; no commits ni cambios en `src/`.
10. Resumen al usuario cada **50 contratos**.

## Acceso y scripts temporales

```bash
cd "/mnt/shared/work_projects/Proyectos de trabajo/_activos/contract-sentinel"
set -a; . secrets/local.env; set +a
npx tsx <script.ts>
```

- Config Sheets: `loadSheetsConfig()`; ID correcto: `cfg.spreadsheetId`.
- Leer fuente: `sheetsValuesGet(cfg, "'contrato encontrados'!A2:M3000")`.
- Leer revisiones: `sheetsValuesGet(cfg, "'Revisiones'!A2:L3000")`.
- Escribir fila N: `sheetsValuesPut(cfg, \`'Revisiones'!H${N}:L${N}\`, [[H,I,J,K,L]])`.
- Scripts temporales útiles:
  - `/tmp/opencode/filter_next.ts`: selecciona 20 y aplica filtro Dex; debe actualizarse con retry 3×/5 s + fallback balance antes de reutilizar.
  - `/tmp/opencode/count_reviews.ts`: conteo de veredictos.
  - `/tmp/opencode/fetch_batch*.ts`: descarga/parsing Etherscan v2, implementation incluida.
- Fuente última tanda descargada: `/tmp/opencode/batch12_sources/`.
- Escritura batch 12 ya ejecutada: filas 232 y 239 son `fp`.

## Estado de Google Sheet

Tabs actuales: `Contrato encontrados`, `Revisiones`, `QA`. Nota: instrucciones antiguas usan minúscula `contrato encontrados`, pero Google Sheets toleró el nombre; comprobar metadata si una llamada falla por nombre.

`QA` tiene headers A:N y fila 2 enlazada a `Revisiones!A2:L2`; pertenece a otra sesión. La otra sesión puede escribir en paralelo y provocar 403 transitorio. Para operaciones Sheets, usar hasta 8 retries con 90 s en 403/429/500 cuando sea necesario.

## Final esperado

Cuando las 827 tengan veredicto: tabla total por veredicto y lista completa de `bug_real` con address, `archivo:línea`, función, payload mínimo y monto USD estimado. No convertir riesgos owner/admin en exploits de terceros.
