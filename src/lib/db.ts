// SQLite schema and helpers for contract-sentinel.
// Tables:
//   candidates  — discovered protocol/token candidates
//   links        — official URL + linked contract addresses
//   contracts    — resolved proxy/implementation/source/abi
//   findings     — audit findings per run
//   runs         — pipeline execution records
//   attempts     — retry tracking for each step
//
// All addresses are stored as 0x-prefixed lowercase hex strings.

import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

export const DB_PATH = path.resolve(process.cwd(), process.env.DATABASE_PATH ?? "data/contract-sentinel.sqlite");

export function openDb(p: string = DB_PATH): Database.Database {
  const dbPath = p;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("busy_timeout = 10000");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS candidates (
      address TEXT PRIMARY KEY,
      name TEXT,
      symbol TEXT,
      chainId INTEGER NOT NULL DEFAULT 1,
      discovered_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_address TEXT NOT NULL,
      url TEXT NOT NULL,
      linked_address TEXT,
      method TEXT NOT NULL DEFAULT 'etherscan',
      FOREIGN KEY (candidate_address) REFERENCES candidates(address)
    );

    CREATE TABLE IF NOT EXISTS contracts (
      address TEXT PRIMARY KEY,
      proxy INTEGER NOT NULL DEFAULT 0,
      implementation TEXT,
      admin TEXT,
      language TEXT,
      sources_path TEXT,
      abi TEXT,
      cached_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      contract_address TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('info','low','medium','high','critical')),
      title TEXT NOT NULL,
      detail TEXT,
      snippet TEXT,
      FOREIGN KEY (run_id) REFERENCES runs(id),
      FOREIGN KEY (contract_address) REFERENCES contracts(address)
    );

    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      finished_at TEXT,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      step TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending',
      next_retry_at TEXT,
      error TEXT,
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );
  `);
}

export function ensureDirectories(): void {
  const dirs = [
    path.resolve(process.cwd(), process.env.CONTRACTS_DIR ?? "contracts"),
    path.resolve(process.cwd(), process.env.REPORTS_DIR ?? "reports"),
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
