// AUDITOR: interface and stub implementation.
// Phase 1 = stub; real rules go to PROMPTS/02.

export interface AuditInput {
  address: `0x${string}`;
  implementation: `0x${string}` | null;
  code: { language: string; sources: Record<string, string>; abi: unknown };
  context: { protocolName: string; website?: string; chainId: number; symbol?: string };
}

export interface Finding {
  severity: "info" | "low" | "medium" | "high" | "critical";
  title: string;
  detail: string;
  snippet?: string;
}

export interface Auditor {
  run(input: AuditInput): Promise<Finding[]>;
}

export class StubAuditor implements Auditor {
  async run(_input: AuditInput): Promise<Finding[]> {
    // TODO: fase 2
    return [{ severity: "info" as const, title: "Stub auditor", detail: "// TODO: fase 2" }];
  }
}
