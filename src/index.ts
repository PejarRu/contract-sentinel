// contract-sentinel — entry point.
// Supports --once (single cycle) and --watch (continuous).

import { Orchestrator } from "./orchestrator.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args.includes("--watch") ? "watch" : "once";

  const orchestrator = new Orchestrator();

  if (mode === "watch") {
    console.log("contract-sentinel starting in watch mode...");
    await orchestrator.runWatch();
  } else {
    console.log("contract-sentinel running once...");
    const result = await orchestrator.runOnce();
    console.log(`Run ${result.runId}: ${result.status} — ${result.candidatesFound} candidates, ${result.contractsResolved} contracts, ${result.findings} findings`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
