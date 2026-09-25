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

// --- FP regression: EURI/FINE/JPYC/PHA/SENDPEPE real-world cases (2026-09-25) ---

test("FP: delegatecall in vendored OZ lib is not reported", async () => {
  const auditor = new RealAuditor();
  const input = makeInput({
    "lib/openzeppelin-contracts/contracts/utils/Address.sol":
      "library Address { function functionDelegateCall(address t, bytes memory d) internal returns (bytes memory) { (bool s, bytes memory r) = t.delegatecall(d); return r; } }",
  });
  const findings = await auditor.run(input);
  assert.ok(!findings.some((f) => f.title === "delegatecall detected"));
});

test("FP: delegatecall in comments/NatSpec is not reported", async () => {
  const auditor = new RealAuditor();
  const input = makeInput({
    "Test.sol": "// we do not use delegatecall here\n/** @custom:oz-upgrades-unsafe-allow delegatecall */\ncontract A {}",
  });
  const findings = await auditor.run(input);
  assert.ok(!findings.some((f) => f.title === "delegatecall detected"));
});

test("FP: constructor-only _mint (no public mint) is not reported", async () => {
  const auditor = new RealAuditor();
  const input = makeInput({
    "Token.sol": "contract T { constructor() { _mint(msg.sender, 1000000); } function _mint(address a, uint256 v) internal {} }",
  });
  const findings = await auditor.run(input);
  assert.ok(!findings.some((f) => f.title === "Mint/burn without supply cap"));
});

test("multi-file Etherscan wrapper: lib delegatecall ignored, project code audited", async () => {
  const auditor = new RealAuditor();
  const wrapper = JSON.stringify({
    language: "Solidity",
    sources: {
      "lib/openzeppelin-contracts/contracts/proxy/Proxy.sol": { content: "contract P { fallback() { assembly { delegatecall(gas(), impl, 0, 0, 0, 0) } } }" },
      "src/Token.sol": { content: "contract Token { function steal() { require(tx.origin == owner); } }" },
    },
  });
  const input = makeInput({ "0xabc.sol": `{${wrapper}}` });
  const findings = await auditor.run(input);
  assert.ok(!findings.some((f) => f.title === "delegatecall detected"));
  assert.ok(findings.some((f) => f.title === "tx.origin used for authentication"));
});

test("all sources vendored => no findings", async () => {
  const auditor = new RealAuditor();
  const input = makeInput({
    "lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol": "contract ERC1967Proxy { constructor(address l, bytes memory d) { } }",
    "contracts/util/Address.sol": "library Address { function delegate1(address t) internal { t.delegatecall(\"\"); } }",
  });
  const findings = await auditor.run(input);
  assert.strictEqual(findings.length, 0);
});

test("Ownable2Step (acceptOwnership) is not reported", async () => {
  const auditor = new RealAuditor();
  const input = makeInput({
    "Test.sol": "contract Ownable2Step { function renounceOwnership() public {} function transferOwnership(address n) public {} function acceptOwnership() public {} }",
  });
  const findings = await auditor.run(input);
  assert.ok(!findings.some((f) => f.title === "Ownable without two-step ownership transfer"));
});

test("Ownable single-step downgraded to low", async () => {
  const auditor = new RealAuditor();
  const input = makeInput({ "Test.sol": "contract Ownable { function renounceOwnership() public {} }" });
  const findings = await auditor.run(input);
  const f = findings.find((f) => f.title === "Ownable without two-step ownership transfer");
  assert.ok(f);
  assert.strictEqual(f.severity, "low");
});

test("duplicate delegatecall lines deduped to one finding", async () => {
  const auditor = new RealAuditor();
  const input = makeInput({
    "Test.sol": "contract A { function x() { t.delegatecall(a); } function y() { t.delegatecall(b); } }",
  });
  const findings = await auditor.run(input);
  assert.strictEqual(findings.filter((f) => f.title === "delegatecall detected").length, 1);
});
