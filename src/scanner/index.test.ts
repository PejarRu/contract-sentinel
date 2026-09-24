import test from "node:test";
import assert from "node:assert/strict";
import { filterKnownSymbols, isKnownSymbol } from "./index.js";

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
