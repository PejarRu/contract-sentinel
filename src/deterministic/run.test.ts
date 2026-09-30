import assert from "node:assert/strict";
import test from "node:test";
import { buildReviewValues, CHECKS, isReviewRowEligible, isValidAddress, type Contract } from "./run.js";

const contract = (findings: Contract["findings"]): Contract => ({
  address: "0x0000000000000000000000000000000000000001",
  name: "Test",
  symbol: "TST",
  chain: "1",
  sheetRow: 2,
  findings,
});

test("only empty Revisiones H cells are eligible", () => {
  assert.equal(isReviewRowEligible(undefined), true);
  assert.equal(isReviewRowEligible([]), true);
  assert.equal(isReviewRowEligible(["", "", "", "", "", "", "", "  "]), true);
  assert.equal(isReviewRowEligible(["", "", "", "", "", "", "", "fp"]), false);
});

test("validates Ethereum addresses", () => {
  assert.equal(isValidAddress("0x0000000000000000000000000000000000000001"), true);
  assert.equal(isValidAddress("0x123"), false);
});

test("builds exact H:L values for verified source without findings", () => {
  assert.deepEqual(buildReviewValues({ ...contract([]), sourceVerified: true }, "2026-09-29T00:00:00.000Z"), [
    "fp",
    "Scanner determinista v3: sin patrones detectados",
    "no",
    "Sin hallazgos deterministas",
    "2026-09-29T00:00:00.000Z",
  ]);
});

test("never classifies unverified source as fp", () => {
  assert.deepEqual(buildReviewValues({ ...contract([]), sourceVerified: false }, "2026-09-30"), [
    "requiere_mas_pruebas",
    "Fuente no verificada en Etherscan V2",
    "desconocido",
    "Sin fuente verificada; pendiente de verificación manual",
    "2026-09-30",
  ]);
});

test("builds exact H:L values with findings", () => {
  const finding = CHECKS[0];
  assert.deepEqual(buildReviewValues(contract([finding]), "2026-09-29T00:00:00.000Z"), [
    "requiere_mas_pruebas",
    `${finding.name}: ${finding.description}`,
    "pendiente",
    "Scanner determinista v3; requiere deep-audit manual",
    "2026-09-29T00:00:00.000Z",
  ]);
});

test("uses exactly five active v3 checks", () => {
  assert.deepEqual(CHECKS.map((check) => check.name), [
    "selfdestruct_unprotected",
    "tx_origin_auth_real",
    "public_mint_no_access",
    "sweep_token_unrestricted",
    "unlimited_approval",
  ]);
});
