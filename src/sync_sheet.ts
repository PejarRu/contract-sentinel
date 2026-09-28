// Google Sheet tracker sync — single source of truth for human review status.
//
// Push: SQLite (contracts + findings + reviews) → Sheet columns A–H + M.
// Pull: Sheet columns I–L (ESTADO, revisado_en, notas, bounty) → reviews table.
// The bot only WRITES A–H/M and only READS I–L, so human edits are never clobbered.
//
// Usage:
//   npm run sync-sheet                  → push + pull
//   npm run sync-sheet -- --push-only   → only upload data
//   npm run sync-sheet -- --pull-only   → only download review status

import type Database from "better-sqlite3";
import { openDb } from "./lib/db.js";
import { loadSheetsConfig, sheetsValuesGet, sheetsValuesPut, explorerLink } from "./lib/sheets.js";

export const SHEET_COLUMNS = [
  "address", "nombre", "simbolo", "chain", "visto", "src", "findings", "sev_max",
  "ESTADO", "revisado_en", "notas", "bounty", "etherscan",
] as const;

export const REVIEW_STATUSES = ["pendiente", "revisado", "fp", "bug_real", "reportado"] as const;

const STATUS_ALIASES: Record<string, (typeof REVIEW_STATUSES)[number]> = {
  pendiente: "pendiente",
  revisado: "revisado",
  fp: "fp",
  "falso positivo": "fp",
  bug_real: "bug_real",
  "bug real": "bug_real",
  bug: "bug_real",
  reportado: "reportado",
};

export function normalizeStatus(raw: string): (typeof REVIEW_STATUSES)[number] {
  return STATUS_ALIASES[raw.trim().toLowerCase()] ?? "pendiente";
}

function sevLabel(rank: number): string {
  return ["-", "low", "medium", "high", "critical"][rank] ?? "-";
}

/** Data rows for the sheet: every contract, priority order (severity desc, newest first). */
export function buildSheetRows(db: Database.Database): string[][] {
  const rows = db
    .prepare(
      `WITH sev AS (
         SELECT contract_address,
           MAX(CASE severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END) rank,
           GROUP_CONCAT(DISTINCT severity || ': ' || title) titles
         FROM findings GROUP BY contract_address
       ), cd AS (
         SELECT address, name, symbol, chainId, discovered_at FROM candidates GROUP BY address
       )
       SELECT c.address, cd.name, cd.symbol, cd.chainId, COALESCE(cd.discovered_at, c.cached_at) seen,
         CASE WHEN c.language IS NULL OR c.language = '' THEN 'N' ELSE 'Y' END src,
         COALESCE(sev.rank, 0) rank, COALESCE(sev.titles, '') titles,
         r.status, r.reviewed_at, r.notes, r.bounty
       FROM contracts c
       LEFT JOIN cd ON cd.address = c.address
       LEFT JOIN sev ON sev.contract_address = c.address
       LEFT JOIN reviews r ON r.address = c.address
       ORDER BY rank DESC, seen DESC, c.address`,
    )
    .all() as Array<{
    address: string; name: string | null; symbol: string | null; chainId: number | null;
    seen: string; src: string; rank: number; titles: string;
    status: string | null; reviewed_at: string | null; notes: string | null; bounty: string | null;
  }>;

  return rows.map((r) => [
    r.address,
    r.name ?? "",
    r.symbol ?? "",
    String(r.chainId ?? 1),
    r.seen,
    r.src,
    r.titles,
    sevLabel(r.rank),
    r.status ?? "pendiente",
    r.reviewed_at ?? "",
    r.notes ?? "",
    r.bounty ?? "",
    explorerLink(r.chainId ?? 1, r.address),
  ]);
}

/**
 * Merge incoming data into the existing sheet content, preserving:
 * - existing row order (human sorts survive the next push)
 * - human-owned columns I–L (ESTADO, revisado_en, notas, bounty)
 * New contracts are appended at the end. Returns the full A2:M matrix.
 */
export function mergeSheetRows(existing: string[][], incoming: string[][]): string[][] {
  const inByAddr = new Map(incoming.map((r) => [r[0], r]));
  const seen = new Set<string>();
  const merged: string[][] = [];

  for (const row of existing) {
    const addr = (row[0] ?? "").trim();
    if (!addr) continue;
    const inc = inByAddr.get(addr);
    if (inc) {
      // data cols A–H from incoming, human cols I–L kept, link M from incoming
      merged.push([...inc.slice(0, 8), ...pad(row.slice(8, 12), 4), inc[12] ?? ""]);
      seen.add(addr);
    } else {
      merged.push(pad(row.slice(0, 13), 13)); // stale row: keep as-is (never destroy data)
    }
  }
  for (const row of incoming) {
    if (!seen.has(row[0])) merged.push(row);
  }
  return merged;
}

function pad(row: string[], n: number): string[] {
  const out = row.map((v) => v ?? "");
  while (out.length < n) out.push("");
  return out.slice(0, n);
}

export interface ReviewRow {
  address: string;
  status: string;
  reviewedAt: string | null;
  notes: string | null;
  bounty: string | null;
}

/** Sheet rows → review updates (columns I–L). Skips blank addresses. */
export function reviewsFromSheetRows(rows: string[][]): ReviewRow[] {
  const out: ReviewRow[] = [];
  for (const row of rows) {
    const addr = (row[0] ?? "").trim();
    if (!addr) continue;
    out.push({
      address: addr.toLowerCase(),
      status: normalizeStatus(row[8] ?? ""),
      reviewedAt: (row[9] ?? "").trim() || null,
      notes: (row[10] ?? "").trim() || null,
      bounty: (row[11] ?? "").trim() || null,
    });
  }
  return out;
}

export interface SyncResult {
  pushed: { rows: number; added: number };
  pulled: { reviews: number };
}

export async function syncSheet(db: Database.Database, mode: "both" | "push" | "pull" = "both"): Promise<SyncResult> {
  const cfg = loadSheetsConfig();
  const result: SyncResult = { pushed: { rows: 0, added: 0 }, pulled: { reviews: 0 } };

  if (mode !== "pull") {
    const rows = buildSheetRows(db);
    const existing = await sheetsValuesGet(cfg, "A2:M");
    const merged = mergeSheetRows(existing, rows);
    if (merged.length) {
      await sheetsValuesPut(cfg, `A2:M${merged.length}`, merged);
    }
    result.pushed = { rows: merged.length, added: merged.length - existing.length };
  }

  if (mode !== "push") {
    const sheet = await sheetsValuesGet(cfg, "A2:M");
    const reviews = reviewsFromSheetRows(sheet);
    const upsert = db.prepare(
      `INSERT INTO reviews (address, status, reviewed_at, notes, bounty, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))
       ON CONFLICT(address) DO UPDATE SET status=excluded.status, reviewed_at=excluded.reviewed_at,
         notes=excluded.notes, bounty=excluded.bounty, updated_at=excluded.updated_at`,
    );
    const tx = db.transaction((items: ReviewRow[]) => {
      for (const r of items) upsert.run(r.address, r.status, r.reviewedAt, r.notes, r.bounty);
    });
    tx(reviews);
    result.pulled.reviews = reviews.length;
  }

  return result;
}

async function main(): Promise<void> {
  const mode = process.argv.includes("--push-only") ? "push"
    : process.argv.includes("--pull-only") ? "pull"
    : "both";
  const db = openDb();
  try {
    const res = await syncSheet(db, mode);
    const parts: string[] = [];
    if (mode !== "pull") parts.push(`push: ${res.pushed.rows} filas (${res.pushed.added} nuevas)`);
    if (mode !== "push") parts.push(`pull: ${res.pulled.reviews} revisiones`);
    console.log(`sync-sheet ok — ${parts.join(" · ")}`);
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  main().catch((e) => {
    console.error("sync-sheet failed:", e);
    process.exit(1);
  });
}
