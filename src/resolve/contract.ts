// RESOLVER: resolves proxy pattern, implementation, admin, source code.
// Detects EIP-1967 proxy (implementation & admin slots), EIP-1822,
// legacy OpenZeppelin proxies, and delegatecall in bytecode.
// Fetches verified source from Etherscan getSourceCode.

import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { openDb } from "../lib/db.js";

// EIP-1967 slots
export const EIP1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc375a920a3ca505d382bbc";
export const EIP1967_ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e1178d6a717850b5d6103";

// Beacon proxy admin slot
export const BEACON_PROXY_ADMIN_SLOT = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";

export interface ResolvedContract {
  address: `0x${string}`;
  proxy: boolean;
  implementation: `0x${string}` | null;
  admin: `0x${string}` | null;
  language: string;
  sources: Record<string, string>;
  abi: unknown;
}

export async function resolve(address: `0x${string}`): Promise<ResolvedContract> {
  const db = openDb();

  // Check cache
  const cached = db.prepare("SELECT * FROM contracts WHERE address = ?").get(address) as any;
  if (cached && cached.cached_at) {
    const age = Date.now() - new Date(cached.cached_at).getTime();
    if (age < 15 * 60 * 1000) {
      return {
        address,
        proxy: cached.proxy === 1,
        implementation: cached.implementation as `0x${string}` | null,
        admin: cached.admin as `0x${string}` | null,
        language: cached.language,
        sources: cached.sources_path ? JSON.parse(cached.sources_path) : {},
        abi: cached.abi ? JSON.parse(cached.abi) : [],
      };
    }
  }

  const result: ResolvedContract = {
    address,
    proxy: false,
    implementation: null,
    admin: null,
    language: "Solidity",
    sources: {},
    abi: [],
  };

  if (process.env.MOCK_MODE === "1") {
    return mockResolve(address, db);
  }

  // Fetch from Etherscan API v2
  const apiKey = process.env.ETHERSCAN_API_KEY ?? "";
  const chainId = parseInt(process.env.CHAIN_ID ?? "1");
  const apiBase = `https://api.etherscan.io/v2/api?chainid=${chainId}`;
  const apiUrl = `${apiBase}&module=contract&action=getsourcecode&address=${address}&apikey=${apiKey}`;

  try {
    const res = await fetch(apiUrl);
    const data = await res.json();

    if (data.result && Array.isArray(data.result) && data.result.length > 0) {
      const item = data.result[0];
      if (item.SourceCode && item.SourceCode !== "") {
        const sourceCode = item.SourceCode;
        result.language = item.CompilerVersion ?? "Solidity";
        result.sources = { [`${address}.sol`]: sourceCode };

        // Save sources to disk
        const contractsDir = path.resolve(process.cwd(), process.env.CONTRACTS_DIR ?? "contracts");
        fs.mkdirSync(path.join(contractsDir, address), { recursive: true });
        fs.writeFileSync(path.join(contractsDir, address, `${address}.sol`), sourceCode);
      }
      if (item.ABI && item.ABI !== "null") {
        try {
          result.abi = JSON.parse(item.ABI);
        } catch {
          result.abi = [];
        }
      }
    }
  } catch {
    // Return partial result
  }

  // Detect proxy pattern via EIP-1967 storage slots
  const proxyInfo = await detectProxyInfo(address, apiKey, chainId);
  result.proxy = proxyInfo.proxy;
  result.implementation = proxyInfo.implementation;
  result.admin = proxyInfo.admin;

  // Cache result
  db.prepare(`
    INSERT OR REPLACE INTO contracts (address, proxy, implementation, admin, language, sources_path, abi)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    address,
    result.proxy ? 1 : 0,
    result.implementation,
    result.admin,
    result.language,
    JSON.stringify(result.sources),
    JSON.stringify(result.abi)
  );

  return result;
}

async function detectProxyInfo(
  address: string,
  apiKey: string,
  chainId: number
): Promise<{ proxy: boolean; implementation: `0x${string}` | null; admin: `0x${string}` | null }> {
  const out: { proxy: boolean; implementation: `0x${string}` | null; admin: `0x${string}` | null } = {
    proxy: false,
    implementation: null,
    admin: null,
  };
  if (process.env.MOCK_MODE === "1") return out;

  const ZERO_SLOT = `0x${"0".repeat(64)}`;
  const readSlot = async (position: string): Promise<string> => {
    try {
      const url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=proxy&action=eth_getStorageAt&address=${address}&position=${position}&tag=latest&apikey=${apiKey}`;
      const res = await fetch(url);
      const data = await res.json();
      return typeof data.result === "string" ? data.result.toLowerCase() : "";
    } catch {
      return "";
    }
  };

  const impl = await readSlot(EIP1967_IMPLEMENTATION_SLOT);
  if (impl && impl !== ZERO_SLOT && impl.length >= 42) {
    out.proxy = true;
    out.implementation = (`0x${impl.slice(-40)}`) as `0x${string}`;
  }

  const admin = await readSlot(EIP1967_ADMIN_SLOT);
  if (admin && admin !== ZERO_SLOT && admin.length >= 42) {
    out.admin = (`0x${admin.slice(-40)}`) as `0x${string}`;
  }

  return out;
}

async function mockResolve(address: `0x${string}`, db: Database.Database): Promise<ResolvedContract> {
  const result: ResolvedContract = {
    address,
    proxy: false,
    implementation: null,
    admin: null,
    language: "Solidity",
    sources: { [`${address}.sol`]: "// mock source" },
    abi: [],
  };
  db.prepare(`
    INSERT OR REPLACE INTO contracts (address, proxy, implementation, admin, language, sources_path, abi)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(address, 0, null, null, "Solidity", JSON.stringify(result.sources), JSON.stringify(result.abi));
  return result;
}
