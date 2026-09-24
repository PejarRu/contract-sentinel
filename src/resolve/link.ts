// ENLAZADOR: finds the official URL and linked contract addresses.
// Uses regex 0x[a-fA-F0-9]{40} on etherscan.io/(address|token|proxy) links.
// Fallback: Etherscan lookup by name/symbol.

import { openDb } from "../lib/db.js";

export interface LinkedContract {
  url: string;
  linkedAddress: `0x${string}` | null;
  method: string;
}

const ETHERSCAN_ADDRESS_REGEX = /0x[a-fA-F0-9]{40}/g;
const ETHERSCAN_URL_REGEX = /https?:\/\/etherscan\.io\/(address|token|proxy)\/0x[a-fA-F0-9]{40}/i;

export function extractAddresses(text: string): `0x${string}`[] {
  const matches = text.match(ETHERSCAN_ADDRESS_REGEX);
  if (!matches) return [];
  return [...new Set(matches.filter((a) => a.match(/^0x[a-fA-F0-9]{40}$/)))] as `0x${string}`[];
}

export function isValidEtherscanUrl(url: string): boolean {
  return ETHERSCAN_URL_REGEX.test(url);
}

export async function link(candidateAddress: string): Promise<LinkedContract | null> {
  const db = openDb();

  // Try to find an official URL from the candidate record
  const row = db.prepare("SELECT url FROM links WHERE candidate_address = ? LIMIT 1").get(candidateAddress) as any;

  let url: string;
  let method = "etherscan";

  if (row?.url && isValidEtherscanUrl(row.url)) {
    url = row.url;
  } else {
    // Fallback: construct Etherscan URL
    url = `https://etherscan.io/address/${candidateAddress}`;
    method = "fallback";
  }

  const addresses = extractAddresses(url);
  const linkedAddress = addresses.length > 0 ? addresses[0] : null;

  return { url, linkedAddress, method };
}

export async function linkByName(name: string): Promise<LinkedContract | null> {
  // Fallback: Etherscan lookup by name
  const url = `https://etherscan.io/token/${name}`;
  return { url, linkedAddress: null, method: "name_lookup" };
}
