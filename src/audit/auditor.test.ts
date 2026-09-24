import test from "node:test";
import assert from "node:assert/strict";
import { RealAuditor } from "./auditor.js";
import type { AuditInput } from "./auditor.js";

const makeInput = (sources: Record<string, string>, implementation: string | null = null): AuditInput => ({
  address: "0x1234567890abcdef1234567890abcdef12345678",
  implementation: implementation as `0x${string}` | null,
  code: { language: "Solidity", sources, abi: [] },
  context: { protocolName: "TestProtocol", chainId: 1 },
});

test("no findings for empty source", async () => {
  const auditor = new RealAuditor();
  const input = makeInput({});
  const findings = await auditor.run(input);
  assert.strictEqual(findings.length, 0);
});

test("detects delegatecall", async () => {
  const auditor = new RealAuditor();
  const input = makeInput({ "Test.sol": "contract A { function x() { target.delegatecall(data); } }" });
  const findings = await auditor.run(input);
  assert.ok(findings.some((f) => f.title === "delegatecall detected"));
  assert.strictEqual(findings.find((f) => f.title === "delegatecall detected")?.severity, "high");
});

test("detects tx.origin", async () => {
  const auditor = new RealAuditor();
  const input = makeInput({ "Test.sol": "require(tx.origin == owner);" });
  const findings = await auditor.run(input);
  assert.ok(findings.some((f) => f.title === "tx.origin used for authentication"));
});

test("detects selfdestruct", async () => {
  const auditor = new RealAuditor();
  const input = makeInput({ "Test.sol": "selfdestruct(payable(owner));" });
  const findings = await auditor.run(input);
  assert.ok(findings.some((f) => f.title === "selfdestruct/suicide detected"));
  assert.strictEqual(findings.find((f) => f.title === "selfdestruct/suicide detected")?.severity, "critical");
});

test("detects reentrancy without guard", async () => {
  const auditor = new RealAuditor();
  const input = makeInput({ "Test.sol": "function withdraw() external { (bool ok,) = msg.sender.call{value: balance}(); }" });
  const findings = await auditor.run(input);
  assert.ok(findings.some((f) => f.title === "Potential reentrancy vulnerability"));
});

test("detects ecrecover without EIP-712", async () => {
  const auditor = new RealAuditor();
  const input = makeInput({ "Test.sol": "bytes32 h = keccak256(abi.encodePacked(msg.sender)); ecrecover(h, v, r, s);" });
  const findings = await auditor.run(input);
  assert.ok(findings.some((f) => f.title === "ecrecover without EIP-712"));
});

test("detects Ownable without two-step transfer", async () => {
  const auditor = new RealAuditor();
  const input = makeInput({ "Test.sol": "contract Ownable { function renounceOwnership() public { owner = address(0); } }" });
  const findings = await auditor.run(input);
  assert.ok(findings.some((f) => f.title === "Ownable without two-step ownership transfer"));
});

test("detects block.timestamp in oracle", async () => {
  const auditor = new RealAuditor();
  const input = makeInput({ "Oracle.sol": "function getPrice() public view returns (uint) { return price * block.timestamp; }" });
  const findings = await auditor.run(input);
  assert.ok(findings.some((f) => f.title === "block.timestamp used in price oracle"));
});

test("detects mint/burn without supply cap", async () => {
  const auditor = new RealAuditor();
  const input = makeInput({ "Token.sol": "function mint(address to, uint amount) external { balances[to] += amount; }" });
  const findings = await auditor.run(input);
  assert.ok(findings.some((f) => f.title === "Mint/burn without supply cap"));
});

test("detects proxy without reinitializer", async () => {
  const auditor = new RealAuditor();
  const input = makeInput(
    { "Impl.sol": "contract Impl { function initialize() public initializer { ... } }" },
    "0xabcdef1234567890abcdef1234567890abcdef12"
  );
  const findings = await auditor.run(input);
  assert.ok(findings.some((f) => f.title === "Proxy implementation without reinitializer guard"));
});

test("detects reentrancy guard as safe", async () => {
  const auditor = new RealAuditor();
  const input = makeInput({ "Test.sol": "function withdraw() external nonReentrant { (bool ok,) = msg.sender.call{value: balance}(); }" });
  const findings = await auditor.run(input);
  assert.ok(!findings.some((f) => f.title === "Potential reentrancy vulnerability"));
});
