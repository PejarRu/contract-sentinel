// Google Sheet tracker sync tests: row building, merge (human cols preserved),
// review extraction + status normalization. Offline, temp SQLite DB.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "./lib/db.js";
import {
  SHEET_COLUMNS,
  buildReviewMirrorRows,
  buildSheetRows,
  mergeSheetRows,
  reviewsFromSheetRows,
  normalizeStatus,
} from "./sync_sheet.js";

function tmpDb(): { db: ReturnType<typeof openDb>; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sentinel-sync-"));
  return { db: openDb(path.join(dir, "t.sqlite")), dir };
}

test("SHEET_COLUMNS has 13 columns with human cols at I–L", () => {
  assert.equal(SHEET_COLUMNS.length, 13);
  assert.equal(SHEET_COLUMNS[8], "ESTADO");
  assert.equal(SHEET_COLUMNS[9], "revisado_en");
  assert.equal(SHEET_COLUMNS[10], "notas");
  assert.equal(SHEET_COLUMNS[11], "bounty");
});

test("buildSheetRows: contract data, severity label, review status, explorer link", () => {
  const { db, dir } = tmpDb();
  try {
    db.prepare("INSERT INTO candidates (address, name, symbol, chainId, discovered_at) VALUES (?,?,?,?,?)")
      .run("0xaaa", "Alpha", "ALP", 1, "2026-09-27 10:00:00");
    db.prepare("INSERT INTO contracts (address, proxy, language, sources_path) VALUES (?,?,?,?)").run("0xaaa", 0, "Solidity", '{"0xaaa.sol":"contract Alpha {}"}');
    db.prepare("INSERT INTO contracts (address, proxy, language) VALUES (?,?,?)").run("0xbbb", 0, null);
    const runId = Number(db.prepare("INSERT INTO runs (status, started_at) VALUES ('completed', datetime('now'))").run().lastInsertRowid);
    db.prepare("INSERT INTO findings (run_id, contract_address, severity, title) VALUES (?,?,?,?)")
      .run(runId, "0xaaa", "high", "reentrancy detected");
    db.prepare("INSERT INTO reviews (address, status, reviewed_at, notes, bounty) VALUES (?,?,?,?,?)")
      .run("0xaaa", "bug_real", "2026-09-27", "detalle", "immunefi");

    const rows = buildSheetRows(db);
    assert.equal(rows.length, 2);
    // 0xaaa has a finding → sorted first
    const a = rows[0];
    assert.equal(a[0], "0xaaa");
    assert.equal(a[1], "Alpha");
    assert.equal(a[2], "ALP");
    assert.equal(a[3], "1");
    assert.equal(a[4], "2026-09-27 10:00:00");
    assert.equal(a[5], "Y");
    assert.equal(a[6], "high: reentrancy detected");
    assert.equal(a[7], "high");
    assert.equal(a[8], "bug_real");
    assert.equal(a[9], "2026-09-27");
    assert.equal(a[10], "detalle");
    assert.equal(a[11], "immunefi");
    assert.equal(a[12], "https://etherscan.io/address/0xaaa");

    const b = rows[1];
    assert.equal(b[0], "0xbbb");
    assert.equal(b[5], "N");
    assert.equal(b[6], "");
    assert.equal(b[7], "-");
    assert.equal(b[8], "pendiente");
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("mergeSheetRows: keeps row order + human cols I–L, updates data cols, appends new, keeps stale", () => {
  const existing = [
    ["0xold1", "OldName", "", "1", "2026-09-26", "Y", "old findings", "high", "reportado", "2026-09-26", "mias", "yes", "link1"],
    ["0xold2", "", "", "", "", "", "", "", "fp", "2026-09-25", "falso", "", "link2"],
  ];
  const incoming = [
    ["0xold1", "NewName", "NEW", "1", "2026-09-27", "Y", "fresh", "critical", "pendiente", "", "", "", "newlink"],
    ["0xnew1", "Fresh", "FRS", "1", "2026-09-27", "Y", "", "-", "pendiente", "", "", "", "newlink2"],
  ];
  const merged = mergeSheetRows(existing, incoming);

  assert.equal(merged.length, 3);
  // order preserved: old rows first, new appended at end
  assert.deepEqual(merged.map((r) => r[0]), ["0xold1", "0xold2", "0xnew1"]);
  // 0xold1: data cols updated from incoming…
  assert.equal(merged[0][1], "NewName");
  assert.equal(merged[0][6], "fresh");
  assert.equal(merged[0][7], "critical");
  assert.equal(merged[0][12], "newlink");
  // …human cols I–L preserved
  assert.deepEqual(merged[0].slice(8, 12), ["reportado", "2026-09-26", "mias", "yes"]);
  // stale row (no incoming data) kept untouched
  assert.deepEqual(merged[1], existing[1]);
  // new row appended with full data
  assert.deepEqual(merged[2], incoming[0 + 1]);
});

test("buildReviewMirrorRows maps source columns to Revisiones A:G", () => {
  const rows = [[
    "0xabc", "Alpha", "ALP", "1", "2026-10-02", "Y", "high: finding", "high",
    "pendiente", "", "", "", "https://etherscan.io/address/0xabc",
  ]];
  assert.deepEqual(buildReviewMirrorRows(rows), [[
    "0xabc", "Alpha", "high", "high: finding", "https://etherscan.io/address/0xabc",
    "2026-10-02", "pendiente",
  ]]);
});

test("mergeSheetRows deduplicates normalized addresses and updates metadata", () => {
  const existing = [
    ["0xABC", "Old", "OLD", "1", "", "N", "", "-", "fp", "2026-09-29", "qa", "", "oldlink"],
    ["0xabc", "Duplicate", "DUP", "1", "", "N", "", "-", "pendiente", "", "", "", "duplink"],
  ];
  const incoming = [["0xabc", "Renamed", "NEW", "1", "2026-09-30", "Y", "", "-", "pendiente", "", "", "", "newlink"]];
  const merged = mergeSheetRows(existing, incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0][1], "Renamed");
  assert.deepEqual(merged[0].slice(8, 12), ["fp", "2026-09-29", "qa", ""]);
});

test("reviewsFromSheetRows: maps I–L, lowercases addr, skips blanks, normalizes status", () => {
  const rows = [
    ["0xABC", "", "", "", "", "", "", "", "Bug Real", "2026-09-27", " nota ", "immunefi", ""],
    ["0xdef", "", "", "", "", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", "fp", "", "", "", ""],
    ["0xghi", "", "", "", "", "", "", "", "esto no existe", "", "", "", ""],
  ];
  const out = reviewsFromSheetRows(rows);
  assert.equal(out.length, 3); // blank address skipped
  assert.deepEqual(out[0], {
    address: "0xabc",
    status: "bug_real",
    reviewedAt: "2026-09-27",
    notes: "nota",
    bounty: "immunefi",
  });
  assert.equal(out[1].status, "pendiente"); // empty → default
  assert.equal(out[2].status, "pendiente"); // unknown → default
  assert.equal(out[2].reviewedAt, null);
  assert.equal(out[2].notes, null);
});

test("normalizeStatus maps aliases and defaults unknown to pendiente", () => {
  assert.equal(normalizeStatus("PENDIENTE"), "pendiente");
  assert.equal(normalizeStatus("Revisado"), "revisado");
  assert.equal(normalizeStatus("FP"), "fp");
  assert.equal(normalizeStatus("falso positivo"), "fp");
  assert.equal(normalizeStatus("Bug Real"), "bug_real");
  assert.equal(normalizeStatus("bug"), "bug_real");
  assert.equal(normalizeStatus("reportado"), "reportado");
  assert.equal(normalizeStatus("cualquier cosa"), "pendiente");
  assert.equal(normalizeStatus(""), "pendiente");
});
