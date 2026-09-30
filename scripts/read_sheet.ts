import { loadSheetsConfig, sheetsValuesGet } from "../src/lib/sheets.js";

const cfg = loadSheetsConfig();
const data = await sheetsValuesGet(cfg, "Revisiones!A790:L870");

console.log("Got " + data.length + " rows\n");
for (let i = 0; i < data.length; i++) {
  const r = data[i];
  if (!r || !r[0]) continue;
  const row = 830 + i;
  const addr = (r[0] || "");
  const nombre = (r[1] || "").slice(0, 40);
  const sev = (r[2] || "").slice(0, 10);
  const findings = (r[3] || "").slice(0, 80);
  const estado = (r[6] || "");
  const vered = (r[7] || "");
  const explot = (r[9] || "").slice(0, 80);
  const notas = (r[10] || "").slice(0, 150);

  console.log("Row " + row + ": " + addr.slice(0, 14) + " | " + nombre);
  console.log("  sev=" + sev + " | findings=" + findings);
  console.log("  estado=" + estado + " | veredicto=" + vered + " | explotable=" + explot);
  if (notas) console.log("  notas=" + notas);
  console.log("");
}
