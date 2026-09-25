import test from "node:test";
import assert from "node:assert/strict";
import { filterKnownSymbols, isKnownSymbol, parseGeckoPools, parseDexTokens } from "./index.js";

test("filterKnownSymbols filters wrap/stable/bridge", () => {
  const candidates = [
    { address: "0x1", name: "Wrapped Token", symbol: "WETH" },
    { address: "0x2", name: "Normal Token", symbol: "NORM" },
  ];
  const filtered = filterKnownSymbols(candidates as any);
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].symbol, "NORM");
});

test("isKnownSymbol detects wrap/stable/bridge", () => {
  assert.ok(isKnownSymbol("Wrapped Something", "WSYM"));
});

test("isKnownSymbol does not flag normal tokens", () => {
  assert.ok(!isKnownSymbol("Normal Token", "NORM"));
});

test("parseGeckoPools extracts base token from included", () => {
  const json = {
    data: [
      { id: "eth_pool1", relationships: { base_token: { data: { id: "eth_0xtok1" } } } },
      { id: "eth_pool2", relationships: { base_token: { data: { id: "eth_missing" } } } },
    ],
    included: [
      { id: "eth_0xtok1", type: "token", attributes: { address: "0xAAAA000000000000000000000000000000000001", name: "NewCoin", symbol: "NEW" } },
    ],
  };
  const out = parseGeckoPools(json, 1);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].address, "0xaaaa000000000000000000000000000000000001");
  assert.strictEqual(out[0].name, "NewCoin");
  assert.strictEqual(out[0].symbol, "NEW");
  assert.strictEqual(out[0].chainId, 1);
});

test("parseGeckoPools skips pools without valid token address", () => {
  const json = {
    data: [{ id: "p", relationships: { base_token: { data: { id: "t" } } } }],
    included: [{ id: "t", type: "token", attributes: { address: "not-an-address" } }],
  };
  assert.strictEqual(parseGeckoPools(json, 1).length, 0);
});

test("parseDexTokens maps valid tokens and skips invalid", () => {
  const json = [
    { address: "0xbbbb000000000000000000000000000000000002", name: "DexToken", symbol: "DXT" },
    { address: "0x123", name: "Bad", symbol: "BAD" },
    { name: "NoAddress", symbol: "NA" },
  ];
  const out = parseDexTokens(json, 1);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].symbol, "DXT");
  assert.strictEqual(out[0].chainId, 1);
});
