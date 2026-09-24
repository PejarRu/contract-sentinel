// ORCHESTRADOR: runs the full pipeline SCANNER → ENLAZADOR → RESOLVER → AUDITOR.
// Manages SQLite state, exponential backoff, rate-limiting, CLI commands.

import { openDb, ensureDirectories } from "./lib/db.js";
import { scan, type Candidate } from "./scanner/index.js";
import { link } from "./resolve/link.js";
import { resolve } from "./resolve/contract.js";
import { createAuditor, type AuditInput } from "./audit/index.js";

export interface RunResult {
  runId: number;
  candidatesFound: number;
  contractsResolved: number;
  findings: number;
  status: string;
}

export class Orchestrator {
  private auditor;
  private db;

  constructor() {
    this.auditor = createAuditor();
    this.db = openDb();
    ensureDirectories();
  }

  async runOnce(): Promise<RunResult> {
    const runId = this.createRun("running");

    try {
      const config = {
        chainId: parseInt(process.env.CHAIN_ID ?? "1"),
        intervalMin: parseInt(process.env.SCAN_INTERVAL_MIN ?? "15"),
        apiKey: process.env.ETHERSCAN_API_KEY ?? "",
        mockMode: process.env.MOCK_MODE === "1",
      };

      // a) SCANNER
      const candidates = await scan(config);
      this.recordCandidates(candidates, runId);

      let contractsResolved = 0;
      let findings = 0;

      // b) ENLAZADOR → c) RESOLVER → d) AUDITOR (per candidate)
      for (const candidate of candidates) {
        const linked = await link(candidate.address);
        if (linked?.linkedAddress) {
          const resolved = await resolve(linked.linkedAddress);
          contractsResolved++;

          const input: AuditInput = {
            address: resolved.address,
            implementation: resolved.implementation,
            code: { language: resolved.language, sources: resolved.sources, abi: resolved.abi },
            context: { protocolName: candidate.name, chainId: candidate.chainId, symbol: candidate.symbol },
          };
          const result = await this.auditor.run(input);
          this.recordFindings(result, runId, resolved.address);
          findings += result.length;
        }
      }

      this.finishRun(runId, "completed");
      return { runId, candidatesFound: candidates.length, contractsResolved, findings, status: "completed" };
    } catch (err: any) {
      this.finishRun(runId, "failed", err.message);
      return { runId, candidatesFound: 0, contractsResolved: 0, findings: 0, status: "failed" };
    }
  }

  async runWatch(): Promise<void> {
    const intervalMs = (parseInt(process.env.SCAN_INTERVAL_MIN ?? "15")) * 60 * 1000;
    while (true) {
      await this.runOnce();
      await this.sleep(intervalMs);
    }
  }

  private createRun(status: string): number {
    const stmt = this.db.prepare("INSERT INTO runs (status) VALUES (?)");
    const result = stmt.run(status);
    return Number(result.lastInsertRowid);
  }

  private finishRun(runId: number, status: string, error?: string): void {
    this.db.prepare("UPDATE runs SET status = ?, finished_at = ?, error = ? WHERE id = ?").run(
      status, new Date().toISOString(), error ?? null, runId
    );
  }

  private recordCandidates(candidates: Candidate[], runId: number): void {
    const stmt = this.db.prepare("INSERT OR IGNORE INTO candidates (address, name, symbol, chainId) VALUES (?, ?, ?, ?)");
    for (const c of candidates) {
      stmt.run(c.address, c.name, c.symbol, c.chainId);
      this.db.prepare("INSERT OR IGNORE INTO attempts (run_id, step, status, next_retry_at) VALUES (?, 'scan', 'done', NULL)").run(runId);
    }
  }

  private recordFindings(findings: any[], runId: number, address: string): void {
    const stmt = this.db.prepare("INSERT INTO findings (run_id, contract_address, severity, title, detail, snippet) VALUES (?, ?, ?, ?, ?, ?)");
    for (const f of findings) {
      stmt.run(runId, address, f.severity, f.title, f.detail, f.snippet);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
