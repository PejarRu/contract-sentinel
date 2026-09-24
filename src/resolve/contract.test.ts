import test from "node:test";
import assert from "node:assert/strict";
import { EIP1967_IMPLEMENTATION_SLOT, EIP1967_ADMIN_SLOT } from "./contract.js";

test("EIP1967 slots are valid hex addresses", () => {
  assert.ok(EIP1967_IMPLEMENTATION_SLOT.startsWith("0x"));
  assert.ok(EIP1967_ADMIN_SLOT.startsWith("0x"));
});

test("EIP1967 slots start with 0x", () => {
  assert.ok(EIP1967_IMPLEMENTATION_SLOT.startsWith("0x"));
  assert.ok(EIP1967_ADMIN_SLOT.startsWith("0x"));
});
