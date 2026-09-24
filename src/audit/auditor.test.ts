import test from "node:test";
import assert from "node:assert/strict";
import { StubAuditor } from "./auditor.js";
import type { AuditInput } from "./auditor.js";

test("StubAuditor returns one info finding", async () => {
  const auditor = new StubAuditor();
  const input: AuditInput = {
    address: "0x1234567890abcdef1234567890abcdef12345678",
    implementation: null,
    code: { language: "Solidity", sources: {}, abi: [] },
    context: { protocolName: "Test", chainId: 1 },
  };
  const findings = await auditor.run(input);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].severity, "info");
  assert.strictEqual(findings[0].title, "Stub auditor");
});
