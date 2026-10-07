import { writeFile } from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { loadSheetsConfig, sheetsValuesGet, sheetsValuesPut, type SheetsConfig } from "../lib/sheets.js";

const LP_THRESHOLD_USD = 10_000;

interface ContractRow {
  address: string;
  name: string;
  symbol: string;
  chain: string;
  sheetRow: number;
  reviewH: string;
  reviewI: string;
  reviewJ: string;
  reviewK: string;
  reviewL: string;
}

const KNOWN_FP_ADDRESSES = new Set(
  [
    "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9",
    "0xccccccccc33d538dbc2ee4feab0a7a1ff4e8a94",
    "0x4a220e6096b25eadb88358cb44068a3248254675",
    "0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3",
    "0x15b7c0c907e4c6b9adaaaabc300c08991d6cea05",
    "0x0f2d719407fdbeff09d87557abb7232601fd9f29",
    "0xe0f63a424a4439cbe457d80e4f4b51ad25b2c56c",
    "0x7a44d56ba0ce8bb5f0359c473b6b637db1ff216b",
    "0x67bf56e4cb13363cc1a5f243e51354e7b72a8930",
    "0x010946a9189f4fa8d6bf01d2fa32e0edf3d6e03b",
    "0x57c3571f10767e49c9d7b60feb6c67804783b7ae",
    "0xe76c6c83af64e4c60245d8c7de953df673a7a33d",
    "0xc8bd181abf6835f88ff2fc52570402604425a702",
  ].map((a) => a.toLowerCase()),
);

const FP_VALUES = ["fp", "Falso positivo conocido (triage automático)", "no", "Proyecto establecido con access control real", ""];

interface DexScreenerPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  fdv?: number;
  url?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadRows(cfg: SheetsConfig): Promise<{ all: ContractRow[]; eligible: ContractRow[]; fpTargets: ContractRow[] }> {
  const [sourceRows, reviewRows] = await Promise.all([
    sheetsValuesGet(cfg, "'contrato encontrados'!A2:M3000"),
    sheetsValuesGet(cfg, "'Revisiones'!A2:L3000"),
  ]);

  const all: ContractRow[] = [];
  const eligible: ContractRow[] = [];
  const fpTargets: ContractRow[] = [];

  for (let i = 0; i < sourceRows.length; i++) {
    const address = (sourceRows[i]?.[0] ?? "").trim().toLowerCase();
    if (!address) continue;
    const review = reviewRows[i] ?? [];
    const h = review[7]?.trim() ?? "";
    const row: ContractRow = {
      address,
      name: sourceRows[i]?.[1] ?? "",
      symbol: sourceRows[i]?.[2] ?? "",
      chain: sourceRows[i]?.[3] ?? "",
      sheetRow: i + 2,
      reviewH: h,
      reviewI: review[8] ?? "",
      reviewJ: review[9] ?? "",
      reviewK: review[10] ?? "",
      reviewL: review[11] ?? "",
    };
    all.push(row);
    if (h === "requiere_mas_pruebas") {
      if (KNOWN_FP_ADDRESSES.has(address)) {
        fpTargets.push(row);
      } else {
        eligible.push(row);
      }
    }
  }

  return { all, eligible, fpTargets };
}

async function queryDexScreener(address: string, chain: string): Promise<DexScreenerPair[]> {
  const chainName = chain === "ethereum" || chain === "1" || chain === "mainnet" ? "ethereum" :
    chain === "137" || chain === "polygon" ? "polygon" :
    chain === "8453" || chain === "base" ? "base" :
    chain === "42161" || chain === "arbitrum" ? "arbitrum" :
    "ethereum";

  const url = `https://api.dexscreener.io/token-pairs/v1/${chainName}/${address}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`  DexScreener HTTP ${res.status} for ${address}`);
    return [];
  }
  const data = (await res.json()) as DexScreenerPair[] | { pairs?: DexScreenerPair[] };
  return Array.isArray(data) ? data : (data.pairs ?? []);
}

async function runTriage(): Promise<void> {
  const cfg = loadSheetsConfig();
  const reviewedAt = new Date().toISOString();

  console.log("=== FASE 1: FP conocidos ===\n");
  const { all, eligible, fpTargets } = await loadRows(cfg);

  console.log(`Filas totales: ${all.length}`);
  console.log(`requiere_mas_pruebas total: ${eligible.length + fpTargets.length}`);
  console.log(`FP conocidos (override inmediato): ${fpTargets.length}`);
  console.log(`Elegibles para DexScreener: ${eligible.length}`);

  // Phase 1: write FP overrides
  if (fpTargets.length > 0) {
    console.log("\nSobreescribiendo FP conocidos...");
    for (const row of fpTargets) {
      console.log(`  ${row.address} (${row.name}, fila ${row.sheetRow}) → fp`);
    }
    const maxRow = Math.max(...all.map((r) => r.sheetRow), 0);
    const values: string[][] = Array.from({ length: maxRow - 1 }, () => ["", "", "", "", ""]);
    for (let i = 0; i < maxRow - 1; i++) {
      // Keep existing values for all rows
      const matchingRow = all.find((r) => r.sheetRow === i + 2);
      if (matchingRow) {
        values[i][0] = matchingRow.reviewH;
        values[i][1] = matchingRow.reviewI;
        values[i][2] = matchingRow.reviewJ;
        values[i][3] = matchingRow.reviewK;
        values[i][4] = matchingRow.reviewL;
      }
    }
    for (const row of fpTargets) {
      const idx = row.sheetRow - 2;
      values[idx] = [...FP_VALUES];
      values[idx][4] = reviewedAt;
    }
    await sheetsValuesPut(cfg, `'Revisiones'!H2:L${maxRow}`, values);
    console.log(`Escritas ${fpTargets.length} filas fp en Sheet.\n`);
  }

  // Phase 2: DexScreener filter
  console.log("=== FASE 2: DexScreener ===\n");

  const results = {
    deepAudit: [] as { row: ContractRow; maxLp: number; maxVol24: number; pairs: DexScreenerPair[] }[],
    descartadoFiltro: [] as { row: ContractRow; maxLp: number }[],
    sinPares: [] as { row: ContractRow }[],
  };

  for (let i = 0; i < eligible.length; i++) {
    const row = eligible[i];
    console.log(`[${i + 1}/${eligible.length}] ${row.address} (${row.name || row.symbol})`);

    await sleep(250); // DexScreener rate limit safety: 4 req/s max, we do 1/s
    const pairs = await queryDexScreener(row.address, row.chain);

    if (pairs.length === 0) {
      console.log(`  → sin pares DexScreener`);
      results.sinPares.push({ row });
      continue;
    }

    const maxLp = Math.max(...pairs.map((p) => p.liquidity?.usd ?? 0));
    const maxVol24 = Math.max(...pairs.map((p) => p.volume?.h24 ?? 0));

    if (maxLp < LP_THRESHOLD_USD) {
      console.log(`  → LP máx $${maxLp.toLocaleString()} < $${LP_THRESHOLD_USD.toLocaleString()} → descartado_filtro`);
      results.descartadoFiltro.push({ row, maxLp });
    } else {
      console.log(`  → LP máx $${maxLp.toLocaleString()} ≥ threshold → deep audit`);
      results.deepAudit.push({ row, maxLp, maxVol24, pairs });
    }
  }

  // Write DexScreener results to Sheet
  console.log("\nEscribiendo resultados DexScreener en Sheet...");
  const maxRow = Math.max(...all.map((r) => r.sheetRow), 0);
  const values: string[][] = Array.from({ length: maxRow - 1 }, () => ["", "", "", "", ""]);
  for (let i = 0; i < maxRow - 1; i++) {
    const matchingRow = all.find((r) => r.sheetRow === i + 2);
    if (matchingRow) {
      values[i][0] = matchingRow.reviewH;
      values[i][1] = matchingRow.reviewI;
      values[i][2] = matchingRow.reviewJ;
      values[i][3] = matchingRow.reviewK;
      values[i][4] = matchingRow.reviewL;
    }
  }

  for (const { row } of results.sinPares) {
    const idx = row.sheetRow - 2;
    values[idx] = ["descartado_filtro", "Sin pares en DexScreener", "no", "Sin liquidez DEX; descartado automáticamente", reviewedAt];
  }

  for (const { row, maxLp } of results.descartadoFiltro) {
    const idx = row.sheetRow - 2;
    values[idx] = ["descartado_filtro", `LP máxima $${maxLp.toLocaleString()} < $${LP_THRESHOLD_USD.toLocaleString()}`, "no", "Liquidez insuficiente; descartado automáticamente", reviewedAt];
  }

  for (const { row, maxLp, maxVol24 } of results.deepAudit) {
    const idx = row.sheetRow - 2;
    values[idx] = ["requiere_mas_pruebas", `LP $${maxLp.toLocaleString()}, vol24 $${maxVol24.toLocaleString()}`, "pendiente", "Candidato a deep audit — liquidez suficiente", reviewedAt];
  }

  await sheetsValuesPut(cfg, `'Revisiones'!H2:L${maxRow}`, values);

  // Generate report
  const report = [
    `# Triage Report`,
    `Generated: ${reviewedAt}`,
    ``,
    `## Phase 1 — FP known`,
    `- ${fpTargets.length} contracts overridden to \`fp\``,
    ...fpTargets.map((r) => `  - ${r.address} (${r.name}, row ${r.sheetRow})`),
    ``,
    `## Phase 2 — DexScreener filter`,
    ``,
    `### Deep audit candidates (${results.deepAudit.length})`,
    ...results.deepAudit.map(({ row, maxLp, maxVol24 }) =>
      `  - ${row.address} (${row.name || row.symbol}, row ${row.sheetRow}): LP $${maxLp.toLocaleString()}, vol24 $${maxVol24.toLocaleString()}`),
    ``,
    `### Descartados por LP baja (${results.descartadoFiltro.length})`,
    ...results.descartadoFiltro.map(({ row, maxLp }) =>
      `  - ${row.address} (${row.name || row.symbol}, row ${row.sheetRow}): LP $${maxLp.toLocaleString()}`),
    ``,
    `### Sin pares DexScreener (${results.sinPares.length})`,
    ...results.sinPares.map(({ row }) =>
      `  - ${row.address} (${row.name || row.symbol}, row ${row.sheetRow})`),
    ``,
    `## Summary`,
    `- Total \`requiere_mas_pruebas\`: ${fpTargets.length + eligible.length}`,
    `- Fase 1 (FP conocidos): ${fpTargets.length}`,
    `- Fase 2 (deep audit): ${results.deepAudit.length}`,
    `- Fase 2 (descartado_filtro): ${results.descartadoFiltro.length}`,
    `- Fase 2 (sin pares): ${results.sinPares.length}`,
    `- Restantes para revisión manual: ${results.deepAudit.length}`,
  ].join("\n");

  console.log(`\n${report}`);
  await writeFile("/tmp/triage_report.md", report, "utf8");
  console.log("\nReporte: /tmp/triage_report.md");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  runTriage().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
