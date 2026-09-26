// 12h digest email: newly discovered contracts + audit findings, for manual
// triage. The user decides what to analyse (bot session or manual).
//
// Usage:
//   npm run digest              → build + artifact + send (if EMAIL_ENABLED)
//   npm run digest -- --dry-run → build + artifact + print, never send
//
// Env: DIGEST_WINDOW_H (default 12), DIGEST_MAX_ROWS (default 200).

import path from "node:path";
import fs from "node:fs";
import type Database from "better-sqlite3";
import { openDb, ensureDirectories } from "./lib/db.js";
import { sendDigestEmail, buildDigestSubject } from "./report/email.js";

export interface DigestFinding {
  severity: string;
  title: string;
}

export interface DigestRow {
  address: string;
  name: string | null;
  symbol: string | null;
  chainId: number;
  discoveredAt: string;
  verified: boolean;
  proxy: boolean;
  findings: DigestFinding[];
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 4, high: 3, medium: 2, low: 1, info: 0,
};

const EXPLORERS: Record<number, string> = {
  1: "https://etherscan.io/address/",
  137: "https://polygonscan.com/address/",
  8453: "https://basescan.org/address/",
  42161: "https://arbiscan.io/address/",
};

export function explorerUrl(chainId: number, address: string): string {
  return (EXPLORERS[chainId] ?? EXPLORERS[1]) + address;
}

/** Local-time SQLite datetime: 'YYYY-MM-DD HH:MM:SS' (schema uses datetime('now','localtime')). */
export function sqlCutoff(windowH: number, now = Date.now()): string {
  const d = new Date(now - windowH * 3600 * 1000);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function maxSeverity(findings: DigestFinding[]): number {
  return findings.reduce((m, f) => Math.max(m, SEVERITY_RANK[f.severity] ?? 0), -1);
}

/** Rows: candidates discovered in window, plus any address with findings in window. */
export function collectDigestRows(db: Database.Database, since: string): DigestRow[] {
  const cands = db
    .prepare(
      "SELECT address, name, symbol, chainId, discovered_at FROM candidates WHERE discovered_at >= ?",
    )
    .all(since) as Array<{
    address: string; name: string | null; symbol: string | null;
    chainId: number; discovered_at: string;
  }>;

  const frows = db
    .prepare(
      "SELECT f.contract_address, f.severity, f.title FROM findings f " +
        "JOIN runs r ON r.id = f.run_id WHERE r.started_at >= ?",
    )
    .all(since) as Array<{ contract_address: string; severity: string; title: string }>;

  const info = new Map(
    (db.prepare("SELECT address, proxy, language FROM contracts").all() as Array<{
      address: string; proxy: number; language: string | null;
    }>).map((c) => [c.address, c]),
  );
  const candByAddr = new Map(cands.map((c) => [c.address, c]));

  const fmap = new Map<string, DigestFinding[]>();
  for (const f of frows) {
    const list = fmap.get(f.contract_address) ?? [];
    list.push({ severity: f.severity, title: f.title });
    fmap.set(f.contract_address, list);
  }

  const rows = new Map<string, DigestRow>();
  for (const c of cands) {
    const meta = info.get(c.address);
    rows.set(c.address, {
      address: c.address,
      name: c.name,
      symbol: c.symbol,
      chainId: c.chainId,
      discoveredAt: c.discovered_at,
      verified: !!meta?.language,
      proxy: !!meta?.proxy,
      findings: [],
    });
  }
  for (const [addr, findings] of fmap) {
    if (rows.has(addr)) {
      rows.get(addr)!.findings.push(...findings);
      continue;
    }
    const c = candByAddr.get(addr);
    const meta = info.get(addr);
    rows.set(addr, {
      address: addr,
      name: c?.name ?? null,
      symbol: c?.symbol ?? null,
      chainId: c?.chainId ?? 1,
      discoveredAt: c?.discovered_at ?? "",
      verified: !!meta?.language,
      proxy: !!meta?.proxy,
      findings,
    });
  }

  const all = [...rows.values()];
  all.sort((a, b) => {
    const fa = maxSeverity(a.findings) >= 0 ? 1 : 0;
    const fb = maxSeverity(b.findings) >= 0 ? 1 : 0;
    if (fa !== fb) return fb - fa;
    if (fa === 1) return maxSeverity(b.findings) - maxSeverity(a.findings);
    return b.discoveredAt.localeCompare(a.discoveredAt);
  });
  return all;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function sevChip(sev: string): string {
  const color =
    sev === "critical" || sev === "high" ? "#d9534f" :
    sev === "medium" ? "#f0ad4e" : "#5bc0de";
  return `<span style="background:${color};color:#fff;padding:2px 6px;border-radius:3px;font-size:12px">${esc(sev.toUpperCase())}</span>`;
}

export function digestStats(rows: DigestRow[]): { total: number; withFindings: number; high: number; medium: number; low: number } {
  let withFindings = 0, high = 0, medium = 0, low = 0;
  for (const r of rows) {
    if (r.findings.length) withFindings++;
    for (const f of r.findings) {
      if (f.severity === "high" || f.severity === "critical") high++;
      else if (f.severity === "medium") medium++;
      else if (f.severity === "low") low++;
    }
  }
  return { total: rows.length, withFindings, high, medium, low };
}

export function buildDigestHtml(rows: DigestRow[], windowH: number, now = new Date()): string {
  const st = digestStats(rows);
  const withF = rows.filter((r) => r.findings.length);
  const without = rows.filter((r) => !r.findings.length);
  const when = now.toISOString().slice(0, 16).replace("T", " ");

  const findingRows = withF
    .map((r) => {
      const label = r.symbol ? `${r.name} (${r.symbol})` : r.name ?? "sin nombre";
      const titles = r.findings
        .map((f) => `<li>${sevChip(f.severity)} ${esc(f.title)}</li>`)
        .join("");
      return `<tr>
<td style="padding:8px;border-bottom:1px solid #eee"><b>${esc(label)}</b><br>
<a href="${explorerUrl(r.chainId, r.address)}">${r.address}</a>
${r.proxy ? ' <small>(proxy)</small>' : ""}${r.verified ? ' <small>✓ src</small>' : ""}<br>
<small>${esc(r.discoveredAt)}</small></td>
<td style="padding:8px;border-bottom:1px solid #eee"><ul style="margin:0;padding-left:18px">${titles}</ul></td>
</tr>`;
    })
    .join("\n");

  const plainRows = without
    .map((r) => {
      const label = r.symbol ? `${esc(r.name ?? "sin nombre")} (${esc(r.symbol)})` : esc(r.name ?? "sin nombre");
      return `<tr>
<td style="padding:4px 8px;border-bottom:1px solid #f5f5f5">${label}</td>
<td style="padding:4px 8px;border-bottom:1px solid #f5f5f5;font-family:monospace;font-size:12px"><a href="${explorerUrl(r.chainId, r.address)}">${r.address}</a></td>
<td style="padding:4px 8px;border-bottom:1px solid #f5f5f5;font-size:12px">${r.verified ? "✓" : "—"}${r.proxy ? " (proxy)" : ""}</td>
<td style="padding:4px 8px;border-bottom:1px solid #f5f5f5;font-size:12px">${esc(r.discoveredAt.slice(11))}</td>
</tr>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Contract Sentinel Digesto ${windowH}h</title></head>
<body style="font-family:sans-serif;color:#222">
<h2 style="margin-bottom:4px">Contract Sentinel — digesto ${windowH}h</h2>
<p style="color:#777;margin-top:0">${when} · <b>${st.total}</b> contratos ·
${st.withFindings ? `<b style="color:#d9534f">${st.withFindings} con hallazgos</b> (${st.high} high, ${st.medium} medium, ${st.low} low)` : "sin hallazgos"} ·
${st.total - st.withFindings} sin hallazgos</p>
${withF.length ? `<h3>Con hallazgos — revisar primero</h3>
<table style="border-collapse:collapse;width:100%">${findingRows}</table>` : ""}
<h3>Descubiertos sin hallazgos (${without.length})</h3>
<table style="border-collapse:collapse;width:100%">
<tr style="background:#f0f0f0;text-align:left"><th style="padding:4px 8px">Token</th><th style="padding:4px 8px">Dirección</th><th style="padding:4px 8px">Src</th><th style="padding:4px 8px">Hora</th></tr>
${plainRows}
</table>
<p style="color:#999;font-size:12px">El email es solo triage: decide tú qué analizar (sesión del bot o manual).</p>
</body></html>`;
}

export function buildDigestText(rows: DigestRow[], windowH: number, now = new Date()): string {
  const st = digestStats(rows);
  const withF = rows.filter((r) => r.findings.length);
  const without = rows.filter((r) => !r.findings.length);
  const lines: string[] = [];
  lines.push(`contract-sentinel — digesto ${windowH}h (${now.toISOString().slice(0, 16).replace("T", " ")})`);
  lines.push(`${st.total} contratos · ${st.withFindings} con hallazgos (${st.high} high, ${st.medium} medium, ${st.low} low)`);
  if (withF.length) {
    lines.push("", "== CON HALLAZGOS ==");
    for (const r of withF) {
      const label = r.symbol ? `${r.name} (${r.symbol})` : r.name ?? "sin nombre";
      lines.push(`[${label}] ${r.address}`);
      for (const f of r.findings) lines.push(`  - ${f.severity.toUpperCase()}: ${f.title}`);
      lines.push(`  ${explorerUrl(r.chainId, r.address)}`);
    }
  }
  lines.push("", `== SIN HALLAZGOS (${without.length}) ==`);
  for (const r of without) {
    const label = r.symbol ? `${r.name ?? "?"} (${r.symbol})` : r.name ?? "?";
    lines.push(`${label} ${r.address} ${r.discoveredAt.slice(11, 16)}${r.verified ? " ✓" : ""}`);
  }
  return lines.join("\n");
}

function saveArtifact(html: string, text: string, reportsDir: string): string {
  fs.mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 13).replace(/[:T]/g, "-");
  const htmlPath = path.join(reportsDir, `digest-${stamp}.html`);
  fs.writeFileSync(htmlPath, html);
  fs.writeFileSync(path.join(reportsDir, `digest-${stamp}.txt`), text);
  return htmlPath;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const windowH = parseInt(process.env.DIGEST_WINDOW_H ?? "12");
  const maxRows = parseInt(process.env.DIGEST_MAX_ROWS ?? "200");
  const db = openDb();
  ensureDirectories();

  const since = sqlCutoff(windowH);
  const all = collectDigestRows(db, since);
  const rows = all.slice(0, maxRows);

  const html = buildDigestHtml(rows, windowH);
  const text = buildDigestText(rows, windowH);
  const artifact = saveArtifact(html, text, path.resolve(process.cwd(), process.env.REPORTS_DIR ?? "reports"));

  const st = digestStats(rows);
  const subject = buildDigestSubject(windowH, st.total, st.high, st.medium);

  if (dryRun) {
    console.log(`[dry-run] ${st.total} filas · artifact ${artifact}`);
    console.log(text.split("\n").slice(0, 30).join("\n"));
    db.close();
    return;
  }

  const result = await sendDigestEmail({ subject, html, text });
  console.log(
    result.sent
      ? `digest sent (${st.total} contratos, ${st.withFindings} con hallazgos) · artifact ${artifact}`
      : `digest NOT sent: ${result.error} · artifact ${artifact}`,
  );
  db.close();
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((e) => {
    console.error("digest failed:", e);
    process.exit(1);
  });
}
