# Prompt Codex: Reescribir escáner determinista con fetch on-demand de Etherscan V2

## Objetivo
Modificar `src/deterministic/run.ts` para que descargue el código fuente de cada contrato desde Etherscan V2 API en vez de leer archivos locales. Solo 14 de 827 contratos tienen .sol local — el escáner actual no sirve.

## Problemas actuales
1. `performCheck()` en línea 182 lee `contracts/<addr>/<addr>.sol` — solo 14 existen
2. Imports usan `.ts` (ej: `"../lib/sheets.ts"`) pero tsconfig tiene `module: "NodeNext"` — deben usar `.js`
3. Las regex no detectan QCAT (0xadb606c50dbd08bf33061b5c13be9c6ab8f4fc62) ni QPEPE (0xe9ac549be395f50602cb1a45410af173152f484e)
4. `fs/promises` no funciona con NodeNext sin ajustes

## Cambios necesarios

### 1. Arreglar imports
Cambiar todas las extensiones de `.ts` a `.js` en los imports:
```ts
import { loadSheetsConfig, sheetsValuesGet, sheetsValuesPut } from "../lib/sheets.js";
```
Y usar `import { readFile, writeFile, mkdir } from "fs/promises"` (no namespace).

### 2. Añadir fetch de Etherscan V2
Endpoint: `https://api.etherscan.io/v2/api?chainid=<CHAINID>&module=contract&action=getsourcecode&address=<ADDR>&apikey=<KEY>`

Respuesta: `{ status: "1", result: [{ SourceCode: "...", ContractName: "...", ABI: "..." }] }`

Si status != "1" o SourceCode vacío → skip (no verified).

Mapeo de chains (columna `chain` de la sheet → chainid):
- "1", "mainnet", "ethereum" → 1
- "137", "polygon", "matic" → 137
- "8453", "base" → 8453
- "42161", "arbitrum" → 42161
- "56", "bsc", "binance" → 56
- "10", "optimism" → 10
- "43114", "avalanche" → 43114

API key de `process.env.ETHERSCAN_API_KEY` (ya está en secrets/local.env).

### 3. Rate limiting + caché
- 5 req/sec max (Etherscan free tier): `await sleep(250)` entre requests
- Guardar fuente descargada en `contracts/<addr>/<addr>.sol` para no re-descargar (check cache primero)
- Crear directorio `contracts/<addr>/` si no existe

### 4. Arreglar regex para detectar QCAT/QPEPE
El patrón `quantum_reward_pattern` debe buscar `notifyReward`, `claim`, `collect` y el selector `0xce3f865f` o `06689a`:

```ts
{
  name: "quantum_reward_pattern",
  pattern: /notifyReward|function claim\b.*external|function collect\b.*external|0xce3f865f|06689a/,
  description: "Reward sniping: instant reward distribution without holding period",
  severity: "high",
}
```

### 5. Nuevo flujo de `performCheck()`
```ts
async function performCheck(address: string, pattern: RegExp): Promise<boolean> {
  const source = await fetchSource(address, chainIdStr);
  if (!source) return false;
  return pattern.test(source);
}

async function fetchSource(address: string, chainIdRaw: string): Promise<string | null> {
  // 1. Check cache: contracts/<addr>/<addr>.sol
  // 2. If cached → return content
  // 3. Fetch from Etherscan V2
  // 4. Cache to disk
  // 5. Return content
}
```

### 6. La función `scanAllContracts()` debe pasar chainId a `performCheck()`
Actualmente solo pasa address. Necesita pasar también chainId.

## No tocar
- `src/lib/sheets.ts` y `src/lib/sheets.js` — funcionan, no modificar
- `secrets/local.env` — ya tiene la API key
- El resto de archivos del proyecto

## Verificación
Después de la reescritura, ejecutar:
```bash
cd "/mnt/shared/work_projects/Proyectos de trabajo/_activos/contract-sentinel"
set -a; . secrets/local.env; set +a
npx tsx src/deterministic/run.ts
```
Debe:
- Scannear los 827 contratos
- Descargar fuentes de Etherscan (con rate limit)
- Detectar QCAT y QPEPE como high por quantum_reward_pattern
- Escribir findings en pestaña Revisiones
- Generar /tmp/deterministic_scanner_report.md con candidatos
