// AUDITOR factory: creates the Auditor instance.
// Phase 1 returns StubAuditor; phase 2 may inject real auditor.

import { StubAuditor, type Auditor, type AuditInput, type Finding } from "./auditor.js";

export { type AuditInput, type Finding };
export function createAuditor(): Auditor {
  return new StubAuditor();
}
