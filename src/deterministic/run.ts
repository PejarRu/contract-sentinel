import { mkdir, readFile, writeFile } from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { loadSheetsConfig, sheetsValuesGet, sheetsValuesPut, type SheetsConfig } from "../lib/sheets.js";

export interface Contract {
  address: `0x${string}`;
  name: string;
  symbol: string;
  chain: string;
  seen?: string;
  sheetRow: number;
  findings: DeterministicCheck[];
  sevMax?: string;
  sourceVerified?: boolean;
}

export interface DeterministicCheck {
  name: string;
  pattern: RegExp;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
}

interface EtherscanResponse {
  status: string;
  message?: string;
  result?: Array<{ SourceCode?: string }> | string;
}

export const CHECKS: DeterministicCheck[] = [
  {
    name: "selfdestruct_unprotected",
    pattern: /(?<!onlyOwner.*\n.*)(selfdestruct|suicide)\s*\(/,
    description: "Selfdestruct or suicide without onlyOwner protection",
    severity: "critical",
  },
  {
    name: "tx_origin_auth_real",
    pattern: /tx\.origin\s*[=!]=|require\s*\([^)]*tx\.origin/,
    description: "tx.origin used for authentication",
    severity: "high",
  },
  {
    name: "public_mint_no_access",
    pattern: /function\s+mint\s*\([^)]*\)\s*(external|public)\s+(?:(?!onlyOwner|onlyRole|onlyMinter|onlyAdmin)[\s\S])*?\{/s,
    description: "Public mint function may lack access control",
    severity: "critical",
  },
  {
    name: "sweep_token_unrestricted",
    pattern: /function\s+(sweepToken|withdrawToken|rescueToken)\s*\([^)]*\)\s*(external|public)[^}]*onlyOwner/,
    description: "Owner token sweep may drain user assets",
    severity: "high",
  },
  {
    name: "unlimited_approval",
    pattern: /approve\s*\([^,]*,\s*(type\s*\(\s*uint256\s*\)\s*\.\s*max|~\s*uint256\s*\(\s*0\s*\))/,
    description: "Unlimited token approval",
    severity: "medium",
  },
];

const CHAIN_IDS: Record<string, string> = {
  "1": "1", mainnet: "1", ethereum: "1", "137": "137", polygon: "137", matic: "137",
  "8453": "8453", base: "8453", "42161": "42161", arbitrum: "42161", "56": "56",
  bsc: "56", binance: "56", "10": "10", optimism: "10", "43114": "43114", avalanche: "43114",
};

const sourceCache = new Map<string, Promise<string | null>>();
let lastRequestAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function mapChainId(chain: string): string | null {
  return CHAIN_IDS[chain.trim().toLowerCase()] ?? null;
}

export function isValidAddress(address: string): address is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

export function isReviewRowEligible(row: string[] | undefined): boolean {
  return !row?.[7]?.trim();
}

export function buildReviewValues(contract: Contract, reviewedAt: string): string[] {
  if (contract.sourceVerified === false) {
    return [
      "requiere_mas_pruebas",
      "Fuente no verificada en Etherscan V2",
      "desconocido",
      "Sin fuente verificada; pendiente de verificación manual",
      reviewedAt,
    ];
  }
  if (contract.findings.length > 0) {
    return [
      "requiere_mas_pruebas",
      contract.findings.map((finding) => `${finding.name}: ${finding.description}`).join("; "),
      "pendiente",
      "Scanner determinista v3; requiere deep-audit manual",
      reviewedAt,
    ];
  }
  return [
    "fp",
    "Scanner determinista v3: sin patrones detectados",
    "no",
    "Sin hallazgos deterministas",
    reviewedAt,
  ];
}

async function waitForRateLimit(): Promise<void> {
  const waitMs = Math.max(0, 250 - (Date.now() - lastRequestAt));
  if (waitMs > 0) await sleep(waitMs);
  lastRequestAt = Date.now();
}

export async function fetchSource(address: string, chainIdRaw: string): Promise<string | null> {
  const cacheKey = `${chainIdRaw.trim().toLowerCase()}:${address.toLowerCase()}`;
  const existing = sourceCache.get(cacheKey);
  if (existing) return existing;
  const pending = fetchSourceUncached(address, chainIdRaw);
  sourceCache.set(cacheKey, pending);
  return pending;
}

async function fetchSourceUncached(address: string, chainIdRaw: string): Promise<string | null> {
  const normalizedAddress = address.toLowerCase();
  const sourceDir = path.join("contracts", normalizedAddress);
  const sourcePath = path.join(sourceDir, `${normalizedAddress}.sol`);
  try {
    return await readFile(sourcePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const chainId = mapChainId(chainIdRaw);
  if (!chainId) {
    console.warn(`Skipping ${address}: unsupported chain "${chainIdRaw}"`);
    return null;
  }
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) throw new Error("ETHERSCAN_API_KEY is required");
  await waitForRateLimit();
  const params = new URLSearchParams({ chainid: chainId, module: "contract", action: "getsourcecode", address, apikey: apiKey });
  const response = await fetch(`https://api.etherscan.io/v2/api?${params}`);
  if (!response.ok) {
    console.warn(`Skipping ${address}: Etherscan HTTP ${response.status}`);
    return null;
  }
  const data = (await response.json()) as EtherscanResponse;
  const source = Array.isArray(data.result) ? data.result[0]?.SourceCode?.trim() : "";
  if (data.status !== "1" || !source) {
    console.warn(`Skipping ${address}: source not verified`);
    return null;
  }
  await mkdir(sourceDir, { recursive: true });
  await writeFile(sourcePath, source, "utf8");
  return source;
}

function performCheck(source: string, pattern: RegExp): boolean {
  return pattern.test(source);
}

function getSeverityLevel(severity: string): number {
  return ({ critical: 4, high: 3, medium: 2, low: 1 } as Record<string, number>)[severity] || 0;
}

export async function runDeterministicScanner(dryRun = false): Promise<void> {
  const cfg = loadSheetsConfig();
  const [sourceRows, reviewRows] = await Promise.all([
    sheetsValuesGet(cfg, "'contrato encontrados'!A2:M3000"),
    sheetsValuesGet(cfg, "'Revisiones'!A2:L3000"),
  ]);
  const contracts: Contract[] = sourceRows.flatMap((row, index) => {
    const [address, name, symbol, chain, seen] = row.slice(0, 5);
    if (!address || !isReviewRowEligible(reviewRows[index])) return [];
    if (!isValidAddress(address)) {
      console.warn(`Skipping row ${index + 2}: invalid address "${address}"`);
      return [];
    }
    return [{ address, name: name || "", symbol: symbol || "", chain: chain || "", seen: seen || "", sheetRow: index + 2, findings: [], sevMax: "" }];
  });
  console.log(`Eligible contracts: ${contracts.length}; protected review rows: ${sourceRows.length - contracts.length}`);
  for (let index = 0; index < contracts.length; index++) {
    const contract = contracts[index];
    console.log(`[${index + 1}/${contracts.length}] Scanning ${contract.address} (${contract.name})`);
    let highestSeverity = "";
    const source = await fetchSource(contract.address, contract.chain);
    contract.sourceVerified = source !== null;
    if (source) {
      for (const check of CHECKS) {
        if (performCheck(source, check.pattern)) {
          contract.findings.push(check);
          if (getSeverityLevel(check.severity) > getSeverityLevel(highestSeverity)) highestSeverity = check.severity;
        }
      }
    }
    contract.sevMax = source ? highestSeverity || "fp" : "unverified";
  }
  const reviewedAt = new Date().toISOString();
  if (dryRun) {
    console.log(`DRY RUN: ${contracts.length} proposed H:L row updates; Google Sheets writes: 0`);
    for (const contract of contracts) console.log(`Revisiones!H${contract.sheetRow}:L${contract.sheetRow}\t${JSON.stringify(buildReviewValues(contract, reviewedAt))}`);
  } else {
    await writeResultsToSheet(cfg, contracts, reviewedAt);
  }
  await generateSummaryReport(contracts, dryRun, reviewedAt);
}

export async function writeResultsToSheet(cfg: SheetsConfig, contracts: Contract[], reviewedAt: string): Promise<void> {
  for (const contract of contracts) {
    await sheetsValuesPut(cfg, `'Revisiones'!H${contract.sheetRow}:L${contract.sheetRow}`, [buildReviewValues(contract, reviewedAt)]);
  }
  console.log(`Wrote ${contracts.length} eligible H:L rows`);
}

export async function generateSummaryReport(contracts: Contract[], dryRun: boolean, generatedAt: string): Promise<void> {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, fp: 0, unverified: 0 };
  for (const contract of contracts) counts[contract.sevMax as keyof typeof counts]++;
  const important = contracts.filter((contract) => contract.findings.some((finding) => finding.severity === "critical" || finding.severity === "high"));
  let report = `# Deterministic Scanner Report\nGenerated: ${generatedAt}\nMode: ${dryRun ? "dry-run" : "write"}\n\n## Severity counts\n- Critical: ${counts.critical}\n- High: ${counts.high}\n- Medium: ${counts.medium}\n- Low: ${counts.low}\n- No findings: ${counts.fp}\n- Unverified source: ${counts.unverified}\n\n## High and critical hits\n`;
  report += important.length ? "" : "None\n";
  for (const contract of important) {
    const findings = contract.findings.filter((finding) => finding.severity === "critical" || finding.severity === "high");
    report += `- ${contract.address} (${contract.name || contract.symbol || "unnamed"}, row ${contract.sheetRow}): ${findings.map((finding) => `${finding.severity} ${finding.name}`).join("; ")}\n`;
  }
  await writeFile("/tmp/deterministic_scanner_report.md", report, "utf8");
  console.log("Report: /tmp/deterministic_scanner_report.md");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  runDeterministicScanner(process.argv.includes("--dry-run")).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
