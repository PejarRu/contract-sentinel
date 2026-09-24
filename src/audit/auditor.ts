// AUDITOR: real static analysis rules on Solidity source code.
// Phase 2: replaces StubAuditor. Read-only analysis of cached source.
// Rules: delegatecall, tx.origin, selfdestruct, reentrancy, ecrecover,
// ownable, block.timestamp, mint/burn, proxy initializer.

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

export class RealAuditor implements Auditor {
  async run(input: AuditInput): Promise<Finding[]> {
    const findings: Finding[] = [];
    const allSource = Object.values(input.code.sources).join("\n");
    if (!allSource || allSource.trim() === "") return findings;

    findings.push(...this.checkDelegatecall(allSource));
    findings.push(...this.checkTxOrigin(allSource));
    findings.push(...this.checkSelfdestruct(allSource));
    findings.push(...this.checkReentrancy(allSource));
    findings.push(...this.checkEcrecover(allSource));
    findings.push(...this.checkOwnable(allSource));
    findings.push(...this.checkBlockTimestamp(allSource));
    findings.push(...this.checkMintBurn(allSource, input.code.abi));
    findings.push(...this.checkProxyInitializer(allSource, input.implementation));

    return findings;
  }

  private checkDelegatecall(src: string): Finding[] {
    const findings: Finding[] = [];
    const lines = src.split("\n");
    for (const line of lines) {
      if (line.includes("delegatecall")) {
        findings.push({
          severity: "high",
          title: "delegatecall detected",
          detail: "delegatecall forwards all storage context; ensure target contract is trusted and storage layout is compatible",
          snippet: line.trim(),
        });
      }
    }
    return findings;
  }

  private checkTxOrigin(src: string): Finding[] {
    const findings: Finding[] = [];
    const lines = src.split("\n");
    for (const line of lines) {
      if (line.includes("tx.origin")) {
        findings.push({
          severity: "high",
          title: "tx.origin used for authentication",
          detail: "tx.origin is vulnerable to phishing attacks; use msg.sender instead",
          snippet: line.trim(),
        });
      }
    }
    return findings;
  }

  private checkSelfdestruct(src: string): Finding[] {
    const findings: Finding[] = [];
    const lines = src.split("\n");
    for (const line of lines) {
      if (line.includes("selfdestruct") || line.includes("suicide")) {
        findings.push({
          severity: "critical",
          title: "selfdestruct/suicide detected",
          detail: "selfdestruct permanently destroys the contract and sends remaining ether; ensure this is intentional and access-controlled",
          snippet: line.trim(),
        });
      }
    }
    return findings;
  }

  private checkReentrancy(src: string): Finding[] {
    const findings: Finding[] = [];
    const lines = src.split("\n");
    let hasCallValue = false;
    let hasChecksEffectsInteractions = false;

    for (const line of lines) {
      if (line.includes(".call{") || line.includes(".call(")) {
        hasCallValue = true;
      }
      if (line.includes("nonReentrant") || line.includes("ReentrancyGuard")) {
        hasChecksEffectsInteractions = true;
      }
    }

    if (hasCallValue && !hasChecksEffectsInteractions) {
      findings.push({
        severity: "high",
        title: "Potential reentrancy vulnerability",
        detail: ".call() used without reentrancy guard (nonReentrant/ReentrancyGuard); consider using Checks-Effects-Interactions pattern",
        snippet: ".call() without guard",
      });
    }
    return findings;
  }

  private checkEcrecover(src: string): Finding[] {
    const findings: Finding[] = [];
    const lines = src.split("\n");
    for (const line of lines) {
      if (line.includes("ecrecover")) {
        if (!src.includes("EIP712") && !src.includes("EIP712")) {
          findings.push({
            severity: "medium",
            title: "ecrecover without EIP-712",
            detail: "ecrecover used without EIP-712 typed structured data; signatures may be replayable across contracts",
            snippet: line.trim(),
          });
        }
      }
    }
    return findings;
  }

  private checkOwnable(src: string): Finding[] {
    const findings: Finding[] = [];
    const lines = src.split("\n");
    let hasOwnable = false;
    let hasRenounce = false;
    let hasTwoStep = false;

    for (const line of lines) {
      if (line.includes("Ownable") || line.includes("OwnableUpgradeable")) {
        hasOwnable = true;
      }
      if (line.includes("renounceOwnership") || line.includes("renounce")) {
        hasRenounce = true;
      }
      if (line.includes("transferOwnership") || line.includes("transferOwner")) {
        hasTwoStep = true;
      }
    }

    if (hasOwnable && hasRenounce && !hasTwoStep) {
      findings.push({
        severity: "medium",
        title: "Ownable without two-step ownership transfer",
        detail: "renounceOwnership() is callable directly; two-step transfer (transferOwnership + acceptOwnership) is recommended",
        snippet: "renounceOwnership without transferOwnership pattern",
      });
    }
    return findings;
  }

  private checkBlockTimestamp(src: string): Finding[] {
    const findings: Finding[] = [];
    const lines = src.split("\n");
    for (const line of lines) {
      if (line.includes("block.timestamp") || line.includes("block.timestamp")) {
        if (src.includes("oracle") || src.includes("Oracle") || src.includes("price")) {
          findings.push({
            severity: "medium",
            title: "block.timestamp used in price oracle",
            detail: "block.timestamp is manipulable by miners/validators; do not rely on it for price oracles",
            snippet: line.trim(),
          });
        }
      }
    }
    return findings;
  }

  private checkMintBurn(src: string, abi: unknown): Finding[] {
    const findings: Finding[] = [];
    const lines = src.split("\n");
    let hasMint = false;
    let hasBurn = false;
    let hasCap = false;

    for (const line of lines) {
      if (line.includes("mint(") || line.includes("mint ") || line.includes("function mint")) {
        hasMint = true;
      }
      if (line.includes("burn(") || line.includes("burn ") || line.includes("function burn")) {
        hasBurn = true;
      }
      if (line.includes("cap") || line.includes("MAX_SUPPLY") || line.includes("maxSupply")) {
        hasCap = true;
      }
    }

    if ((hasMint || hasBurn) && !hasCap) {
      findings.push({
        severity: "medium",
        title: "Mint/burn without supply cap",
        detail: "mint/burn functions present but no supply cap found; risk of unlimited inflation",
        snippet: "mint/burn without cap",
      });
    }
    return findings;
  }

  private checkProxyInitializer(src: string, implementation: `0x${string}` | null): Finding[] {
    const findings: Finding[] = [];
    if (!implementation) return findings;

    const lines = src.split("\n");
    let hasInitializer = false;
    let hasReinitializable = false;

    for (const line of lines) {
      if (line.includes("initializer") || line.includes("Initializable")) {
        hasInitializer = true;
      }
      if (line.includes("reinitializer") || line.includes("Reinitializable")) {
        hasReinitializable = true;
      }
    }

    if (hasInitializer && !hasReinitializable) {
      findings.push({
        severity: "medium",
        title: "Proxy implementation without reinitializer guard",
        detail: "implementation uses initializer modifiers but lacks reinitializer guard; vulnerable to re-initialization attacks",
        snippet: "initializer without reinitializer",
      });
    }
    return findings;
  }
}
