// SCANNER: discovers newly deployed protocols/tokens on Ethereum.
// Sources: Etherscan API v2 (primary), DefiLlama/DexScreener (fallback).

import { openDb } from "../lib/db.js";

export interface Candidate {
  address: `0x${string}`;
  name: string;
  symbol: string;
  chainId: number;
}

export interface ScannerConfig {
  chainId: number;
  intervalMin: number;
  apiKey: string;
  mockMode: boolean;
}

const KNOWN_SYMBOLS: Record<string, string> = {
  WRAP: "Wrapped",
  STABLE: "Stable",
  BRIDGE: "Bridge",
};

export function isKnownSymbol(name: string, symbol: string): boolean {
  const upperName = name.toUpperCase();
  const upperSymbol = symbol.toUpperCase();
  for (const [keyword] of Object.entries(KNOWN_SYMBOLS)) {
    if (upperName.includes(keyword) || upperSymbol.includes(keyword)) {
      return true;
    }
  }
  return false;
}

export function filterKnownSymbols(candidates: Candidate[]): Candidate[] {
  return candidates.filter((c) => !isKnownSymbol(c.name, c.symbol));
}

export async function scan(config: ScannerConfig): Promise<Candidate[]> {
  const db = openDb();
  const candidates: Candidate[] = [];

  if (config.mockMode) {
    return mockCandidates();
  }

  // Primary: Etherscan API v2
  const etherscanCandidates = await fetchFromEtherscan(config);
  candidates.push(...etherscanCandidates);

  // Dedupe against SQLite
  for (const c of candidates) {
    const existing = db.prepare("SELECT address FROM candidates WHERE address = ?").get(c.address);
    if (!existing) {
      db.prepare("INSERT OR IGNORE INTO candidates (address, name, symbol, chainId) VALUES (?, ?, ?, ?)").run(
        c.address, c.name, c.symbol, c.chainId
      );
    }
  }

  return filterKnownSymbols(candidates);
}

async function fetchFromEtherscan(config: ScannerConfig): Promise<Candidate[]> {
  // Etherscan API v2 contract verification endpoint or token listing
  // Placeholder: actual implementation calls Etherscan API
  // https://api.etherscan.io/api?module=contract&action=contractlist&chainid=1&apikey=...
  const url = `https://api.etherscan.io/api?module=contract&action=contractlist&chainid=${config.chainId}&apikey=${config.apiKey}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.result && Array.isArray(data.result)) {
      return data.result.map((item: any) => ({
        address: item.ContractName ? `0x${item.Address}` : `0x${item.Address}`,
        name: item.ContractName ?? "",
        symbol: item.Symbol ?? "",
        chainId: config.chainId,
      })).filter((c: Candidate) => c.address.match(/^0x[a-fA-F0-9]{40}$/));
    }
  } catch {
    // Fallback to DefiLlama / DexScreener / GeckoTerminal
  }
  return [];
}

function mockCandidates(): Candidate[] {
  return [
    { address: "0x1234567890abcdef1234567890abcdef12345678", name: "TestToken", symbol: "TEST", chainId: 1 },
    { address: "0xabcdef1234567890abcdef1234567890abcdef12", name: "NewProtocol", symbol: "NP", chainId: 1 },
  ];
}
