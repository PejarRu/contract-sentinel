# HANDOFF COMPLETO — contract-sentinel

> **Archivo maestro para sesiones nuevas. Lee esto primero.**
> **Fecha:** 2026-10-01
> **Estado:** 827 contratos QA completados, 0 bugs reales, scanner v3 determinístico operativo, Google Sheets bidireccional.

---

## 1. Objetivo del proyecto

Descubrir contratos nuevos en Ethereum, resolver su fuente verificada, auditar automáticamente con reglas fase 2, y permitir revisión manual vía Google Sheets para identificar vulnerabilidades explotables con monetización vía MEV/fork.

**Ya NO buscamos bugs en masa.** El scanner determinístico (regex) tiene 100% falsos positivos tras auditoría manual de 38 hits. El pipeline actual es: descubrimiento → fuente verificada → auditor fase 2 → Google Sheet para revisión humana.

---

## 2. Estructura del proyecto

```
contract-sentinel/
├── src/
│   ├── index.ts              # Entry point (once/watch)
│   ├── digest.ts             # Email digest 12h
│   ├── sync_sheet.ts         # SQL ↔ Google Sheets
│   ├── orchestrator.ts       # Pipeline orquestador
│   ├── deterministic/
│   │   ├── run.ts            # Scanner determinístico v3 (regex)
│   │   ├── run.test.ts       # Tests (62/62)
│   │   └── run.ts.backup     # Backup temporal — borrar
│   ├── lib/sheets.ts         # Cliente Google Sheets OAuth
│   ├── lib/sheets.js         # Compilado
│   ├── scanner/index.ts      # Discovery (GeckoTerminal + DexScreener)
│   ├── resolve/contract.ts   # Etherscan V2 resolver + proxy
│   ├── report/email.ts       # SMTP sin dependencias
│   └── db.ts                 # SQLite
├── secrets/
│   ├── local.env             # CREDS LOCALES (gitignored)
│   └── sentinel.env          # CREDS VPS (0600, gitignored)
├── docs/
│   ├── SESSION_HANDOFF.md    # Handoff técnico del bot
│   ├── deterministic-scanner-plan.md
│   ├── monetizacion-qcat-qpepe.md  # [OBSOLETO — falsearon]
│   └── roadmap-escalado.md
├── PROMPTS/                  # Prompts para delegar a Codex
│   ├── deterministic-scan-v2-prompt.md
│   └── deterministic-scan-v3-prompt.md
├── PROGRESO_QA.md            # Checkpoint de la QA original
├── DECISIONS.md
├── .deepseek_private_audit.md # Auditoría privada QCAT/QPEPE
└── tmp_qatab.ts              # Temporal — borrar
```

---

## 3. Herramientas y comandos

```bash
cd "/mnt/shared/work_projects/Proyectos de trabajo/_activos/contract-sentinel"
set -a; . secrets/local.env; set +a

# Typecheck y tests
npm run typecheck          # TypeScript sin errores
npm test                   # 62/62 tests pasando

# Ejecución
npx tsx src/index.ts --once     # Descubrir + auditar
npx tsx src/index.ts --watch    # Modo continuo

# Scanner determinístico (regex, 0 tokens LLM)
npx tsx src/deterministic/run.ts --dry-run   # Sin escribir Sheet
npx tsx src/deterministic/run.ts             # Live: escribe Revisiones H:L

# Sincronización SQL ↔ Sheet
npm run sync-sheet         # Bidireccional

# Docker
docker compose up -d sentinel --build

# VPS
ssh root@91.99.142.12
```

---

## 4. Google OAuth — Reautenticación cuando falle

### Credenciales actuales

```
GOOGLE_OAUTH_CLIENT_ID=<ver secrets/local.env>
GOOGLE_OAUTH_CLIENT_SECRET=<ver secrets/local.env>
```

Redirect URI: `http://localhost:8765` (SIN barra final)

### Procedimiento para refrescar el refresh token

Cuando el access token expire o Google devuelva 400 `Invalid JSON payload` (error transitorio conocido de Google, NO de credenciales):

1. **Comprobar estado actual:**
```bash
curl -s -X POST https://oauth2.googleapis.com/token \
  -d "client_id=${GOOGLE_OAUTH_CLIENT_ID}" \
  -d "client_secret=${GOOGLE_OAUTH_CLIENT_SECRET}" \
  -d "refresh_token=${GOOGLE_OAUTH_REFRESH_TOKEN}" \
  -d "grant_type=refresh_token"
```

Si devuelve access_token → OK, el refresh token sigue vivo.

Si devuelve `invalid_grant` → refresh token expiró o fue revocado. Proceder:

2. **Obtener nuevo refresh token:**
```bash
# Paso 1: Generar URL de autorización
echo "https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_OAUTH_CLIENT_ID}&redirect_uri=http://localhost:8765&response_type=code&scope=https://www.googleapis.com/auth/spreadsheets&access_type=offline&prompt=consent"
```

3. **Abrir la URL en navegador**, autorizar, copiar el `code` del redirect.

4. **Intercambiar code por tokens:**
```bash
curl -s -X POST https://oauth2.googleapis.com/token \
  -d "client_id=${GOOGLE_OAUTH_CLIENT_ID}" \
  -d "client_secret=${GOOGLE_OAUTH_CLIENT_SECRET}" \
  -d "code=<CODIGO_DEL_REDIRECT>" \
  -d "redirect_uri=http://localhost:8765" \
  -d "grant_type=authorization_code"
```

5. **Guardar `refresh_token` en:**
   - `secrets/local.env` → `GOOGLE_OAUTH_REFRESH_TOKEN=<nuevo>`
   - `/opt/contract-sentinel/secrets/sentinel.env` en VPS (misma variable)

6. **Verificar:**
```bash
set -a; . secrets/local.env; set +a
npx tsx -e "
import { getAccessToken } from './src/lib/sheets.js';
const token = await getAccessToken();
console.log('OK, token:', token.slice(0, 20) + '...');
"
```

### Sheets conocidos

| Pestaña | Sheet ID | Propietario |
|---------|----------|-------------|
| Contrato encontrados | `1V8Gq7TPGXaC4JF1bYMRxu0V7XQcjrB_s6iutt8Y0g3s` | Solo lectura (fuente de verdad) |
| Revisiones | Mismo sheet, pestaña 2 (id=1294271795) | H:L escribe la sesión de QA |

**Regla de escritura en Revisiones:** Solo columnas **H:L** (veredicto, pruebas_ejecutadas, explotable, notas_detalladas, fecha_revision). **NUNCA A:G ni M+.** El bot (`sync_sheet`) toca solo pestaña 1.

**Separador de fórmulas:** locale `es_ES` → usar `;` no `,` en `ARRAYFORMULA`.

**Grid size:** ampliado a 5000 filas. PUT falla si excede el grid.

---

## 5. Hitos completados

| # | Hito | Fecha | SHA |
|---|------|-------|-----|
| 1 | Fase 01: scaffold | 2026-09-24 | - |
| 2 | Fase 02: auditor rules | 2026-09-24 | - |
| 3 | Fase 03: Docker + VPS + heartbeat | 2026-09-24 | `19427ae` |
| 4 | Fix scanner discovery (GeckoTerminal + Etherscan V2) | 2026-09-25 | `5884751` |
| 5 | Auditor FP reduction + pentest 6 contratos | 2026-09-25 | `f79a16a` |
| 6 | Proxy implementation fetch + audit EURI/JPYC | 2026-09-25 | `5cc57a5` |
| 7 | SMTP digest 12h (copiado de morpho-shadow) | 2026-09-26 | `86da960` |
| 8 | Google Sheet tracker sync bidireccional | 2026-09-28 | `27f378b` |
| 9 | QA completa de 827 contratos | 2026-09-28 | - |
| 10 | Scanner determinístico v3 implementado | 2026-09-29 | local |
| 11 | 16 nuevos contratos revisados (Codex) | 2026-09-30 | local |
| 12 | QCAT/QPEPE reclasificados fp con fork proof | 2026-09-30 | local |
| 13 | Scanner fixes: src requires sources_path, unverified→requiere_mas_pruebas, case dedup | 2026-10-01 | local |

---

## 6. Estado actual de la QA

### Resultado final tras 827 contratos

| Veredicto | Cantidad |
|---|---:|
| `descartado_filtro` | 182 |
| `fp` | 43 |
| `bug_real` | **0** (QCAT/QPEPE degradados a fp) |
| `requiere_mas_pruebas` | 0 |
| Sin veredicto (vacío) | 600 |

**No hay bugs explotables en los 827 contratos.**

### QCAT/QPEPE — falsos positivos confirmados

- **QCAT** `0xadb606c50dbd08bf33061b5c13be9c6ab8f4fc62`: reward sniping era diseño intencionado (fee-sharing vía `_settle`/`_rebase`). Fork a bloque `26082595`: QCAT profit marginal (0.10 QNT net antes de conversión final y MEV), QPEPE pérdida para todos los inputs.
- **QPEPE** `0xe9ac549be395f50602cb1a45410af173152f484e`: mismo mecanismo, fork profit negativo.
- Conclusión: marcados `fp`, `explotable=no`. Documento `docs/monetizacion-qcat-qpepe.md` es **OBSOLETO** (cálculos de ROI irreales).

### 16 contratos nuevos (revisados por Codex 2026-09-30)

- 2 fp: RCeo (fila 828), Estonks (fila 833)
- 14 descartado_filtro (LP <$10k o sin par)
- 1 candidato único con LP: Bullish with Ondo (fila 829, LP ~$44,475) — proxy con roles protegidos, sin bug explotable por terceros
- Fila 843: placeholder `0x1234...5678`, sin fuente → `requiere_mas_pruebas`

### Contratos reward-sniping del scanner (NO verificados en Etherscan)

TEDDY, QQQ, WOOF, WOOF2, SafeInu, BullishOndo, RCeo, Estonks — todos devolvieron "Contract source code not verified" de Etherscan V2 al verificarse el 2026-10-01. Posible bug transitorio de Etherscan o fuentes cacheadas incorrectamente. Verificar antes de auditar.

---

## 7. Scanner determinístico v3

### Checks activos (5, no ruidosos)

1. `selfdestruct_unprotected` — selfdestruct sin onlyOwner
2. `tx_origin_auth_real` — tx.origin para autorización
3. `public_mint_no_access` — mint público sin control de acceso
4. `sweep_token_unrestricted` — transfer externa sin restricción
5. `unlimited_approval` — approve sin límite

### Checks desactivados (ruidosos, 100% FP)

- `delegatecall_user_input`
- `unchecked_external_call`
- `reentrancy_cei`
- `flash_loan_no_fee`
- `unverified_proxy`

### Modo de uso

```bash
# Dry-run (sin escribir Sheet)
npx tsx src/deterministic/run.ts --dry-run

# Live (escribe Revisiones H:L solo en filas con H vacío)
npx tsx src/deterministic/run.ts

# Report generado en: /tmp/deterministic_scanner_report.md
```

### Mejoras locales (no commiteadas)

- Fuente no verificada → `requiere_mas_pruebas` (nunca `fp`)
- `src` exige `sources_path` real (no solo `language`)
- Deduplicación case-insensitive de addresses
- Contratos conocidos: actualiza nombre/símbolo sin crear fila nueva
- Tests: 62/62 pasando

---

## 8. VPS y despliegue

| Item | Valor |
|------|-------|
| Host | `root@91.99.142.12` (Hetzner) |
| Node | v22.23.3 |
| DB | `/app/data/contract-sentinel.sqlite` |
| Container | `contract-sentinel-sentinel-1` |
| Secrets | `/opt/contract-sentinel/secrets/sentinel.env` (0600) |
| Cron digest | `0 8,20 * * *` (12h) |
| Cron sync | `10 8,20 * * *` (12h, 5min post-digest) |
| Heartbeat | `*/5 * * * *` |

### Redeploy

```bash
# Local: crear bundle
git bundle create /tmp/contract-sentinel.bundle HEAD
scp /tmp/contract-sentinel.bundle root@91.99.142.12:/opt/contract-sentinel/runtime/

# VPS
ssh root@91.99.142.12
cd /opt/contract-sentinel/app
git fetch /opt/contract-sentinel/runtime/contract-sentinel.bundle HEAD
git checkout -f --detach FETCH_HEAD
cd /opt/contract-sentinel
APP_DIR=./app docker compose --env-file secrets/sentinel.env up -d sentinel --build
```

---

## 9. Estrategia de delegación a Codex

**DeepSeek (caro, sin censura) → solo tareas que Codex rechazaría por política:**
- Auditoría de vulnerabilidades en contratos reales
- Diseño de exploits y PoC
- Análisis de vectores de ataque
- Monetización y MEV

**Codex (barato, censurado) → todo lo demás:**
- Implementación de scanners y regex
- Refactors, typecheck, tests
- Integración con APIs (Etherscan, DexScreener)
- Google Sheets sync
- Docker, deploy, cron

**Flujo de trabajo:**
1. DeepSeek diseña la estrategia y escribe prompt detallado
2. Prompt se guarda en `PROMPTS/`
3. Sesión nueva de Codex ejecuta el prompt
4. DeepSeek audita resultados (solo hits de alto valor)

---

## 10. 20 ideas de monetización (brainstorming 2026-10-01)

1. **Bot de sandwich MEV** — monitorizar mempool, insertar buy/sell en tokens baja liquidez
2. **Bot de liquidación** — Aave/Compound/Morpho, liquidar near-liquidation por reward 5-10%
3. **Arbitraje cross-DEX** — mismo token distinto precio Uniswap vs Sushiswap vs Curve
4. **Token launch sniper** — monitorizar PairCreated, comprar bloque 0, vender en pump
5. **Rug pull early detector (SaaS)** — API de riesgo pre-compra, modelo freemium
6. **DB de vulnerabilidades (suscripción)** — acceso a findings + PoC verificados, protocols pagan
7. **Auditoría automatizada freemium** — web: pegar address → reporte básico gratis, completo = pago
8. **Marketplace de estrategias MEV** — alquilar/venta de bots y exploits verificados
9. **Arbitraje cross-chain** — mismo token Ethereum vs Arbitrum vs Base, bridges rápidos
10. **Newsletter técnica de pago** — weekly: breakdown de exploits recientes, $29/mes
11. **Señales VIP (Discord/Telegram)** — alertas de contratos vulnerables en tiempo real, $99/mes
12. **Recovery whitehat** — llegar primero tras hack, drenar fondos, devolver por bounty
13. **Bug bounty aggregator** — encontrar bugs → submit a Immunefi/HackenProof, cobrar %
14. **Sandwich-as-a-Service** — traders pagan por incluir sus operaciones en tu bundle MEV
15. **Flash loan exploit factory** — contratos pre-hechos, usuario pone target, ejecuta en 1 tx
16. **Whale/insider tracker** — monitorizar founders y VCs, alertas de movimiento de fondos
17. **Token safety rating API** — integrar en wallets/DEXes, consulta pre-aprobación
18. **Curso de seguridad DeFi** — "Cómo auditar smart contracts sin ser dev", $199
19. **Memecoin launch sniper** — pump.fun, cuatro.meme: comprar tokens seguros (no honeypot)
20. **Backrunning MEV** — capturar rebote post-swap grande, menos competido que frontrunning

**Top 3 viables con infraestructura actual:** #5 (rug detector), #7 (auditoría freemium), #11 (señales VIP).

---

## 11. Siguientes pasos

1. **NO buscar más bugs en masa.** Los 827 contratos no tienen bugs explotables. La era del "scan masivo y encontrar" terminó.
2. **Refinar scanner v3** — mejorar regex para bajar FP rate del 100% actual al <20%. Priorizar checks que detecten bugs reales (reward-sniping con pruebas de settling).
3. **Implementar monetización** — elegir 1-2 ideas del top 3 y construir MVP.
4. **Mantener discovery corriendo** — `npm run watch` en VPS, sync sheet cada 12h, revisar solo filas nuevas con LP > $10k y fuente verificada.
5. **Limpiar repo** — borrar `tmp_qatab.ts`, `src/deterministic/run.ts.backup`, archivos temporales. Committear cambios locales.
6. **Verificar contratos no verificados** — los 8 contratos reward-sniping del último batch requieren re-verificación (posible bug transitorio Etherscan).

---

## 12. Lecciones aprendidas

1. **QCAT/QPEPE: el diablo está en los detalles.** `notifyReward` sin holding period PARECE reward-sniping pero `_settle`/`_rebase` en `_update` lo previene. Sin fork proof, no clasificar `bug_real`.
2. **Regex no basta.** 38 hits del scanner v3 → 0 bugs reales. Solidity tiene demasiados patrones legítimos que parecen bugs. El scanner filtra, no diagnostica.
3. **Etherscan V2 tiene respuestas transitorias vacías.** No confiar en "not verified" a la primera. Retry 3x con backoff.
4. **La era dorada de los bugs en memecoins acabó.** Contratos modernos (stfusend, OpenZeppelin) son seguros por diseño. Buscar en protocols DeFi establecidos (Aave, Compound, Uniswap v4) donde hay más superficie de ataque.
5. **Separar modelos por costo funciona.** DeepSeek diseña estrategia + audita hits, Codex implementa + ejecuta scanners. ROI óptimo.
