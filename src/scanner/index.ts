// SCANNER: discovers newly listed protocols/tokens on Ethereum.
// Sources: GeckoTerminal new_pools (primary), DexScreener token profiles (fallback).

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

const GECKO_NETWORKS: Record<number, string> = {
  1: "eth",
  137: "polygon_pos",
  8453: "base",
  42161: "arbitrum",
};

const DEXSCREENER_CHAINS: Record<number, string> = {
  1: "ethereum",
  137: "polygon",
  8453: "base",
  42161: "arbitrum",
};

const ADDRESS_RE = /^0x[a-f0-9]{40}$/;

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

  if (config.mockMode) {
    return mockCandidates();
  }

  if (!GECKO_NETWORKS[config.chainId]) {
    throw new Error(`unsupported chainId ${config.chainId}`);
  }

  const discovered = await discover(config.chainId);

  // Dedupe within the batch (same token can appear in multiple new pools) and against SQLite
  const seen = new Set<string>();
  const fresh: Candidate[] = [];
  for (const c of discovered) {
    if (seen.has(c.address)) continue;
    seen.add(c.address);
    const existing = db.prepare("SELECT address FROM candidates WHERE address = ?").get(c.address);
    if (!existing) fresh.push(c);
  }

  const kept = filterKnownSymbols(fresh);
  const stmt = db.prepare("INSERT OR IGNORE INTO candidates (address, name, symbol, chainId) VALUES (?, ?, ?, ?)");
  for (const c of kept) {
    stmt.run(c.address, c.name, c.symbol, c.chainId);
  }
  return kept;
}

async function discover(chainId: number): Promise<Candidate[]> {
  const errors: string[] = [];

  try {
    const network = GECKO_NETWORKS[chainId];
    const json = await fetchJson(
      `https://api.geckoterminal.com/api/v2/networks/${network}/new_pools?include=base_token`
    );
    const parsed = parseGeckoPools(json, chainId);
    if (parsed.length > 0) return parsed;
  } catch (e: any) {
    errors.push(`geckoterminal: ${e?.message ?? e}`);
  }

  try {
    const profiles = await fetchJson("https://api.dexscreener.com/token-profiles/latest/v1");
    const parsed = await fetchDexScreenerTokens(profiles, chainId);
    if (parsed.length > 0) return parsed;
  } catch (e: any) {
    errors.push(`dexscreener: ${e?.message ?? e}`);
  }

  // Both sources errored: fail the run so it is visible instead of silently empty
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
  return [];
}

// Parses GeckoTerminal /networks/{net}/new_pools (JSON:API).
// Token details live in `included`; pool relationships point to them by id.
export function parseGeckoPools(json: any, chainId: number): Candidate[] {
  const included = new Map<string, any>();
  const includedItems = Array.isArray(json?.included) ? json.included : [];
  for (const item of includedItems) {
    if (item?.id) included.set(item.id, item);
  }

  const out: Candidate[] = [];
  const pools = Array.isArray(json?.data) ? json.data : [];
  for (const pool of pools) {
    const tokenId = pool?.relationships?.base_token?.data?.id;
    const token = tokenId ? included.get(tokenId) : undefined;
    // Fallback: id format is "{network}_{0xaddress}" — usable when `included` omits the token
    const idAddress = tokenId?.includes("_") ? tokenId.slice(tokenId.indexOf("_") + 1) : "";
    const address = String(token?.attributes?.address ?? idAddress).toLowerCase();
    if (!ADDRESS_RE.test(address)) continue;
    out.push({
      address: address as `0x${string}`,
      name: String(token?.attributes?.name ?? ""),
      symbol: String(token?.attributes?.symbol ?? ""),
      chainId,
    });
  }
  return out;
}

// Parses DexScreener /tokens/v1/{chain}/{addresses} response.
export function parseDexTokens(json: any, chainId: number): Candidate[] {
  const out: Candidate[] = [];
  const items = Array.isArray(json) ? json : [];
  for (const item of items) {
    const address = String(item?.address ?? "").toLowerCase();
    if (!ADDRESS_RE.test(address)) continue;
    out.push({
      address: address as `0x${string}`,
      name: String(item?.name ?? ""),
      symbol: String(item?.symbol ?? ""),
      chainId,
    });
  }
  return out;
}

async function fetchDexScreenerTokens(profiles: any, chainId: number): Promise<Candidate[]> {
  const dsChain = DEXSCREENER_CHAINS[chainId];
  if (!dsChain) return [];

  const list = Array.isArray(profiles) ? profiles : [];
  const addrs = [
    ...new Set(
      list
        .filter((p: any) => p?.chainId === dsChain && typeof p?.tokenAddress === "string")
        .map((p: any) => p.tokenAddress)
    ),
  ].slice(0, 30);
  if (addrs.length === 0) return [];

  const tokens = await fetchJson(
    `https://api.dexscreener.com/tokens/v1/${dsChain}/${addrs.join(",")}`
  );
  return parseDexTokens(tokens, chainId);
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function mockCandidates(): Candidate[] {
  return [
    { address: "0x1234567890abcdef1234567890abcdef12345678", name: "TestToken", symbol: "TEST", chainId: 1 },
    { address: "0xabcdef1234567890abcdef1234567890abcdef12", name: "NewProtocol", symbol: "NP", chainId: 1 },
  ];
}
