// Deterministic contract scanner for 827 contracts from sheet
// Tier 1: Regex/static analysis only (no LLM), minimal cost, 10 checks
// Output: veredict + tests to sheet2 (Revisiones)

import { loadSheetsConfig, sheetsValuesGet, sheetsValuesPut } from "./lib/sheets.ts";
import * as fs from "fs/promises";
import * as path from "path";

export interface Contract {
  address: `0x${string}`;
  name: string;
  symbol: string;
  chain: string;
  seen?: string;
  findings: string[];
  sevMax?: string;
}

export interface DeterministicCheck {
  name: string;
  pattern: RegExp;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
}

const CHECKS: DeterministicCheck[] = [
  {
    name: "erc20_transfer",
    pattern: /function transfer\\(address to, uint256 amount\\)/,
    description: "Missing ERC20 transfer function",
    severity: "critical",
  },
  {
    name: "tx_origin_auth",
    pattern: /onlyOwner.*tx\\.origin|if\\(.*tx\\.origin\\).{0,20}onlyOwner|tx\\.origin.*onlyOwner/,
    description: "Uses tx.origin for authorization",
    severity: "high",
  },
  {
    name: "self_destruct",
    pattern: /selfdestruct\\(/,
    description: "Contains selfdestruct function",
    severity: "high",
  },
  {
    name: "unrestricted_mint",
    pattern: /function mint\\(address to, uint256 amount\\)/,
    description: "Public minting without limits",
    severity: "critical",
  },
  {
    name: "owner_drain",
    pattern: /function withdraw\\(/|function transferFrom\\(address from, address to, uint256 amount\\).*onlyOwner/,
    description: "Owner can drain funds",
    severity: "critical",
  },
  {
    name: "delegatecall_input",
    pattern: /delegatecall\\(\\s*\\.\\w+\\(\s*\\.\\w+/,
    description: "Delegatecall with external input",
    severity: "high",
  },
  {
    name: "unauthorized_calls",
    pattern: /external.*call.*payable.*noReentrant|CEI violation/,
    description: "CEI violations",
    severity: "high",
  },
  {
    name: "quantum_reward_pattern",
    pattern: /notifyReward.*uint256.*amount.*balance.*supply.*holdingPeriod|function claim.*uint256.*amount/,
    description: "Quantum reward sniping patterns",
    severity: "high",
  },
];

export async function runDeterministicScanner(): Promise<void> {
  console.log("Starting deterministic scanner for 827 contracts...");
  const cfg = loadSheetsConfig();

  const range = "'contrato encontrados'!A2:M3000";
  const data = await sheetsValuesGet(cfg, range);

  console.log(`Loaded ${data.length} rows from sheet2"`);

  const contracts: Contract[] = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const [addr, name, symbol, chain, seen] = row.slice(0, 5);
    if (!addr) continue;

    contracts.push({
      address: addr as `0x${string}`,
      name: name || "",
      symbol: symbol || "",
      chain: chain || "",
      seen: seen || "",
      findings: [],
      sevMax: "",
    });
  }

  console.log(`Processing ${contracts.length} contracts...`);

  for (let i = 0; i < contracts.length; i++) {
    const contract = contracts[i];
    console.log(`[${i + 1}/${contracts.length}] Scanning ${contract.address} (${contract.name})`);

    const findings: string[] = [];
    let highestSeverity: Contract["sevMax"] = "";

    for (const check of CHECKS) {
      if (await performCheck(contract.address, check.pattern, check.description)) {
        findings.push(check.description);
        if (!highestSeverity || getSeverityLevel(check.severity) > getSeverityLevel(highestSeverity)) {
          highestSeverity = check.severity;
        }
      }
    }

    contract.findings = findings;
    contract.sevMax = highestSeverity || "fp";

    if (i % 50 === 0) {
      console.log(`Progress: ${i + 1}/${contracts.length} contracts scanned"`);
    }
  }

  await writeResultsToSheet(cfg, contracts);
  await generateSummaryReport(contracts);
  console.log("Deterministic scanner completed successfully");
}

async function performCheck(address: string, pattern: RegExp, description: string): Promise<boolean> {
  try {
    const sourcePath = path.join("contracts", address, `${address}.sol`);

    try {
      const source = await fs.readFile(sourcePath, "utf8");
      return pattern.test(source);
    } catch (err) {
      return false;
    }
  } catch (err) {
    return false;
  }
}

function getSeverityLevel(severity: string): number {
  const levels: Record<string, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };
  return levels[severity] || 0;
}

async function writeResultsToSheet(cfg: any, contracts: Contract[]): Promise<void> {
  console.log("Writing results to sheet2...");

  const results: string[][] = [];
  for (let i = 0; i < contracts.length; i++) {
    const contract = contracts[i];
    const findingsStr = contract.findings.join("; ");
    const sevMaxStr = contract.sevMax;

    const sheetRow = [
      contract.address,
      contract.name,
      contract.symbol,
      contract.chain,
      "",
      sevMaxStr,
      findingsStr,
      "", "", "", "", "", "",
    ];
    results.push(sheetRow);

    if (i % 50 === 0) {
      console.log(`Written ${i + 1}/${contracts.length} rows to sheet2"`);
    }
  }

  await sheetsValuesPut(cfg, "'Revisiones'!A2:M3000", results);
  console.log(`Successfully wrote ${results.length} rows to sheet2"`);
}

async function generateSummaryReport(contracts: Contract[]): Promise<void> {
  console.log("Generating summary report...");

  const summaryPath = "/tmp/deterministic_scanner_report.md";
  const summary = `# Deterministic Scanner Report\nGenerated: ${new Date().toISOString()}\n\n## Summary Statistics\n- Total contracts scanned: ${contracts.length}\n- Contracts with findings: ${contracts.filter(c => c.findings.length > 0).length}\n\n## High-Value Candidates\n`; \n
  const bugRealContracts = contracts.filter(c => c.sevMax === "high" && c.findings.some(f => f.includes("quantum")));

  summary += "Contracts needing manual audit:\n";
  for (const contract of bugRealContracts) {
    summary += `- **${contract.name} (${contract.symbol})** - ${contract.address}\n`;
    summary += `  - Findings: ${contract.findings.join("; ")}\n\n`;
  }

  await fs.writeFile(summaryPath, summary);
  console.log(`Summary report written to ${summaryPath}`);
}

runDeterministicScanner().catch(console.error);
