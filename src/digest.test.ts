// Digest tests: cutoff formatting, window filtering, findings attachment,
// HTML/text building (incl. escaping). Uses a temp SQLite DB, offline.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "./lib/db.js";
import {
  sqlCutoff,
  collectDigestRows,
  buildDigestHtml,
  buildDigestText,
  digestStats,
  explorerUrl,
} from "./digest.js";

function tmpDb(): { db: ReturnType<typeof openDb>; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sentinel-digest-"));
  return { db: openDb(path.join(dir, "t.sqlite")), dir };
}

test("sqlCutoff is 'YYYY-MM-DD HH:MM:SS' exactly windowH before now", () => {
  const now = new Date("2026-09-26T12:00:00").getTime();
  const s = sqlCutoff(12, now);
  const h = new Date(now - 12 * 3600 * 1000);
  const p = (n: number): string => String(n).padStart(2, "0");
  const expected = `${h.getFullYear()}-${p(h.getMonth() + 1)}-${p(h.getDate())} ${p(h.getHours())}:${p(h.getMinutes())}:${p(h.getSeconds())}`;
  assert.equal(s, expected);
  assert.match(s, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("collect: window filters candidates and findings, attaches by address", () => {
  const { db, dir } = tmpDb();
  try {
    const fresh = sqlCutoff(12).replace(/T/, " "); // now-ish, inside window
    const past = "2020-01-01 00:00:00";
    db.prepare("INSERT INTO candidates (address, name, symbol, chainId, discovered_at) VALUES (?,?,?,?,?)")
      .run("0xnew", "Fresh", "NEW", 1, fresh);
    db.prepare("INSERT INTO candidates (address, name, symbol, chainId, discovered_at) VALUES (?,?,?,?,?)")
      .run("0xold", "Old", "OLD", 1, past);
    db.prepare("INSERT INTO contracts (address, proxy, language) VALUES (?,?,?)")
      .run("0xnew", 0, "Solidity");
    db.prepare("INSERT INTO contracts (address, proxy) VALUES (?,?)").run("0xold", 0);
    db.prepare("INSERT INTO contracts (address, proxy) VALUES (?,?)").run("0xonlyfnd", 0);

    const runNew = Number(db.prepare("INSERT INTO runs (status, started_at) VALUES ('completed', ?)").run(fresh).lastInsertRowid);
    const runOld = Number(db.prepare("INSERT INTO runs (status, started_at) VALUES ('completed', ?)").run(past).lastInsertRowid);
    db.prepare("INSERT INTO findings (run_id, contract_address, severity, title) VALUES (?,?,?,?)")
      .run(runNew, "0xnew", "high", "Potential reentrancy vulnerability");
    db.prepare("INSERT INTO findings (run_id, contract_address, severity, title) VALUES (?,?,?,?)")
      .run(runOld, "0xold", "medium", "stale finding");
    db.prepare("INSERT INTO findings (run_id, contract_address, severity, title) VALUES (?,?,?,?)")
      .run(runNew, "0xonlyfnd", "medium", "Mint/burn without supply cap");

    const rows = collectDigestRows(db, sqlCutoff(12));
    const addrs = rows.map((r) => r.address).sort();
    assert.deepEqual(addrs, ["0xnew", "0xonlyfnd"], "old candidate excluded; findings-only address included");
    const r = rows.find((x) => x.address === "0xnew")!;
    assert.equal(r.verified, true);
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].severity, "high");
    const only = rows.find((x) => x.address === "0xonlyfnd")!;
    assert.equal(only.findings[0].title, "Mint/burn without supply cap");
    // findings rows sort first
    assert.equal(rows[rows.length - 1].address, "0xonlyfnd");
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("stats + html/text builders: counts, links, escaping", () => {
  const rows = [
    {
      address: "0xabc0000000000000000000000000000000000001",
      name: "Evil <script>", symbol: "EVL", chainId: 1,
      discoveredAt: "2026-09-26 16:51:00", verified: true, proxy: false,
      findings: [{ severity: "high", title: "tx.origin used for authentication" }],
    },
    {
      address: "0xabc0000000000000000000000000000000000002",
      name: "Plain", symbol: "PLN", chainId: 1,
      discoveredAt: "2026-09-26 16:35:00", verified: false, proxy: true,
      findings: [],
    },
  ];
  const st = digestStats(rows as never);
  assert.deepEqual(st, { total: 2, withFindings: 1, high: 1, medium: 0, low: 0 });

  const html = buildDigestHtml(rows as never, 12, new Date("2026-09-26T20:00:00Z"));
  assert.ok(html.includes("0xabc0000000000000000000000000000000000001"));
  assert.ok(html.includes("https://etherscan.io/address/0xabc"));
  assert.ok(html.includes("tx.origin used for authentication"));
  assert.ok(!html.includes("<script>"), "name must be escaped");
  assert.ok(html.includes("Evil &lt;script&gt;"));
  assert.ok(html.includes("Con hallazgos"));
  assert.ok(html.includes("(proxy)"));

  const text = buildDigestText(rows as never, 12, new Date("2026-09-26T20:00:00Z"));
  assert.ok(text.includes("== CON HALLAZGOS =="));
  assert.ok(text.includes("HIGH: tx.origin used for authentication"));
  assert.ok(text.includes("1 con hallazgos"));
  assert.ok(text.includes("Evil <script>"), "text part keeps raw name");
});

test("explorerUrl falls back to etherscan for unknown chains", () => {
  assert.equal(explorerUrl(1, "0x1"), "https://etherscan.io/address/0x1");
  assert.equal(explorerUrl(42161, "0x1"), "https://arbiscan.io/address/0x1");
  assert.equal(explorerUrl(999, "0x1"), "https://etherscan.io/address/0x1");
});
