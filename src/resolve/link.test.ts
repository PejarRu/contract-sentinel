import test from "node:test";
import assert from "node:assert/strict";
import { extractAddresses, isValidEtherscanUrl } from "./link.js";

test("extractAddresses finds 0x addresses in text", () => {
  const text = "Check 0x1234567890abcdef1234567890abcdef12345678 on etherscan";
  const addresses = extractAddresses(text);
  assert.strictEqual(addresses.length, 1);
  assert.strictEqual(addresses[0], "0x1234567890abcdef1234567890abcdef12345678");
});

test("extractAddresses returns empty for no addresses", () => {
  const addresses = extractAddresses("no addresses here");
  assert.strictEqual(addresses.length, 0);
});

test("extractAddresses deduplicates", () => {
  const text = "0x1234567890abcdef1234567890abcdef12345678 and 0x1234567890abcdef1234567890abcdef12345678 again";
  const addresses = extractAddresses(text);
  assert.strictEqual(addresses.length, 1);
});

test("isValidEtherscanUrl validates correctly", () => {
  assert.ok(isValidEtherscanUrl("https://etherscan.io/address/0x1234567890abcdef1234567890abcdef12345678"));
  assert.ok(!isValidEtherscanUrl("https://google.com"));
});
