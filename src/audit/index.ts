// AUDITOR factory: creates the Auditor instance.
// Phase 1 returns StubAuditor; phase 2 returns RealAuditor.

import { RealAuditor, type Auditor, type AuditInput, type Finding } from "./auditor.js";

export function createAuditor(): Auditor {
  return new RealAuditor();
}

export { RealAuditor, type AuditInput, type Finding };
export { type Auditor } from "./auditor.js";
