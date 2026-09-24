import test from "node:test";
import assert from "node:assert/strict";
import { openDb, ensureDirectories } from "./db.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("openDb creates all required tables", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-db-"));
  const tmpDb = path.join(tmpDir, "test.sqlite");
  const db = openDb(tmpDb);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  const names = tables.map((t) => t.name);
  assert.ok(names.includes("candidates"));
  assert.ok(names.includes("links"));
  assert.ok(names.includes("contracts"));
  assert.ok(names.includes("findings"));
  assert.ok(names.includes("runs"));
  assert.ok(names.includes("attempts"));
});

test("ensureDirectories creates dirs without error", () => {
  assert.doesNotThrow(() => ensureDirectories());
});
