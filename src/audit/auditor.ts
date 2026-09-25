// AUDITOR: real static analysis rules on Solidity source code.
// Phase 2: replaces StubAuditor. Read-only analysis of cached source.
// Rules: delegatecall, tx.origin, selfdestruct, reentrancy, ecrecover,
// ownable, block.timestamp, mint/burn, proxy initializer.
//
// FP reduction (2026-09-25): sources are expanded from Etherscan's
// {{...}} multi-file wrappers, vendored library files (OZ et al.) and
// comments are excluded before rules run, mint/burn requires a public
// entry point, and findings are deduped per rule.

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

interface SourceFile {
  path: string;
  content: string;
}

// Library/infra paths we never audit: vendored deps and proxy plumbing.
const VENDORED_PATH_RE =
  /(^|\/)(node_modules|lib)\//;
const VENDORED_PATH_PREFIX_RE =
  /^(@|contracts\/(?:proxy|upgradeability|util)\/)/;
// Content markers for flattened OZ forks with custom paths.
const VENDORED_CONTENT_RE =
  /openzeppelin-contracts|@custom:oz-upgrades|OpenZeppelin Contracts \(|forked from https:\/\/github\.com\/OpenZeppelin/i;

function isVendored(file: SourceFile): boolean {
  if (VENDORED_PATH_RE.test(file.path)) return true;
  if (VENDORED_PATH_PREFIX_RE.test(file.path)) return true;
  // Import statements mentioning a dep are not proof the file IS the dep:
  // strip them before testing content markers (project files legitimately
  // import "openzeppelin-contracts-upgradeable/...").
  const nonImport = file.content.replace(/^\s*import\s.*$/gm, "");
  return VENDORED_CONTENT_RE.test(nonImport);
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, "");
}

// Etherscan wraps multi-file sources as {{ "language": ..., "sources": {...} }};
// single-file sources are plain Solidity text.
function expandSources(sources: Record<string, string>): SourceFile[] {
  const files: SourceFile[] = [];
  for (const [path, content] of Object.entries(sources)) {
    const trimmed = content.trimStart();
    if (trimmed.startsWith("{")) {
      try {
        const json = JSON.parse(trimmed.startsWith("{{") ? trimmed.slice(1, -1) : trimmed);
        const map = json?.sources;
        if (map && typeof map === "object") {
          for (const [p, v] of Object.entries(map)) {
            const inner = v as { content?: string };
            if (typeof inner?.content === "string") files.push({ path: p, content: inner.content });
          }
          continue;
        }
      } catch {
        // not a JSON wrapper: fall through and treat as plain source
      }
    }
    files.push({ path, content });
  }
  return files;
}

export class RealAuditor implements Auditor {
  async run(input: AuditInput): Promise<Finding[]> {
    const projectFiles = expandSources(input.code.sources).filter((f) => !isVendored(f));
    if (projectFiles.length === 0) return [];

    const src = stripComments(projectFiles.map((f) => f.content).join("\n"));
    if (src.trim() === "") return [];

    const findings: Finding[] = [];
    findings.push(...this.checkDelegatecall(src));
    findings.push(...this.checkTxOrigin(src));
    findings.push(...this.checkSelfdestruct(src));
    findings.push(...this.checkReentrancy(src));
    findings.push(...this.checkEcrecover(src));
    findings.push(...this.checkOwnable(src));
    findings.push(...this.checkBlockTimestamp(src));
    findings.push(...this.checkMintBurn(src, input.code.abi));
    findings.push(...this.checkProxyInitializer(src, input.implementation));

    return dedupeByTitle(findings);
  }

  private checkDelegatecall(src: string): Finding[] {
    for (const line of src.split("\n")) {
      if (line.includes("delegatecall")) {
        return [
          {
            severity: "high",
            title: "delegatecall detected",
            detail: "delegatecall forwards all storage context; ensure target contract is trusted and storage layout is compatible",
            snippet: line.trim(),
          },
        ];
      }
    }
    return [];
  }

  private checkTxOrigin(src: string): Finding[] {
    for (const line of src.split("\n")) {
      if (line.includes("tx.origin")) {
        return [
          {
            severity: "high",
            title: "tx.origin used for authentication",
            detail: "tx.origin is vulnerable to phishing attacks; use msg.sender instead",
            snippet: line.trim(),
          },
        ];
      }
    }
    return [];
  }

  private checkSelfdestruct(src: string): Finding[] {
    for (const line of src.split("\n")) {
      if (line.includes("selfdestruct") || line.includes("suicide")) {
        return [
          {
            severity: "critical",
            title: "selfdestruct/suicide detected",
            detail: "selfdestruct permanently destroys the contract and sends remaining ether; ensure this is intentional and access-controlled",
            snippet: line.trim(),
          },
        ];
      }
    }
    return [];
  }

  private checkReentrancy(src: string): Finding[] {
    const hasCallValue = src.includes(".call{") || src.includes(".call(");
    const hasGuard = src.includes("nonReentrant") || src.includes("ReentrancyGuard");

    if (hasCallValue && !hasGuard) {
      return [
        {
          severity: "high",
          title: "Potential reentrancy vulnerability",
          detail: ".call() used without reentrancy guard (nonReentrant/ReentrancyGuard); consider using Checks-Effects-Interactions pattern",
          snippet: ".call() without guard",
        },
      ];
    }
    return [];
  }

  private checkEcrecover(src: string): Finding[] {
    if (src.includes("EIP712") || src.includes("EIP-712")) return [];
    if (src.includes("ecrecover")) {
      const line = src.split("\n").find((l) => l.includes("ecrecover")) ?? "ecrecover";
      return [
        {
          severity: "medium",
          title: "ecrecover without EIP-712",
          detail: "ecrecover used without EIP-712 typed structured data; signatures may be replayable across contracts",
          snippet: line.trim(),
        },
      ];
    }
    return [];
  }

  private checkOwnable(src: string): Finding[] {
    const hasOwnable = src.includes("Ownable");
    const hasRenounce = src.includes("renounceOwnership") || src.includes("renounce");
    // Two-step = OZ Ownable2Step pattern: acceptOwnership / pendingOwner.
    const hasTwoStep = /acceptOwnership|pendingOwner|confirmOwnership/i.test(src);

    if (hasOwnable && hasRenounce && !hasTwoStep) {
      return [
        {
          severity: "low",
          title: "Ownable without two-step ownership transfer",
          detail: "single-step ownership transfer/renounce; typo or lost key can brick ownership. Informational centralization note, not an exploit",
          snippet: "renounceOwnership without acceptOwnership pattern",
        },
      ];
    }
    return [];
  }

  private checkBlockTimestamp(src: string): Finding[] {
    if (!src.includes("block.timestamp")) return [];
    if (!(src.includes("oracle") || src.includes("Oracle") || src.includes("price"))) return [];
    const line = src.split("\n").find((l) => l.includes("block.timestamp")) ?? "block.timestamp";
    return [
      {
        severity: "medium",
        title: "block.timestamp used in price oracle",
        detail: "block.timestamp is manipulable by miners/validators; do not rely on it for price oracles",
        snippet: line.trim(),
      },
    ];
  }

  private checkMintBurn(src: string, abi: unknown): Finding[] {
    const abiNames = Array.isArray(abi)
      ? abi.filter((e): e is { name?: string } => !!e && typeof e === "object" && "name" in e).map((e) => e.name ?? "")
      : [];
    // Public entry point required: internal _mint/_burn (constructor mint) is not reachable.
    const publicMint =
      /function\s+\w*mint\w*\s*\([^)]*\)[^{]*(public|external)/i.test(src) ||
      abiNames.some((n) => /^mint/i.test(n));
    const publicBurn =
      /function\s+\w*burn\w*\s*\([^)]*\)[^{]*(public|external)/i.test(src) ||
      abiNames.some((n) => /^burn/i.test(n));
    const hasCap =
      /\b_cap\b|MAX_SUPPLY|maxSupply|ERC20Capped|\bcap\b/i.test(src) || abiNames.includes("cap");

    if ((publicMint || publicBurn) && !hasCap) {
      return [
        {
          severity: "medium",
          title: "Mint/burn without supply cap",
          detail: "public mint/burn entry point found but no supply cap; verify minter access control and cap expectations",
          snippet: "public mint/burn without cap",
        },
      ];
    }
    return [];
  }

  private checkProxyInitializer(src: string, implementation: `0x${string}` | null): Finding[] {
    if (!implementation) return [];
    const hasInitializer = src.includes("initializer") || src.includes("Initializable");
    const hasReinitializer = src.includes("reinitializer") || src.includes("Reinitializable");

    if (hasInitializer && !hasReinitializer) {
      return [
        {
          severity: "medium",
          title: "Proxy implementation without reinitializer guard",
          detail: "implementation uses initializer modifiers but lacks reinitializer guard; vulnerable to re-initialization attacks",
          snippet: "initializer without reinitializer",
        },
      ];
    }
    return [];
  }
}

function dedupeByTitle(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    if (seen.has(f.title)) return false;
    seen.add(f.title);
    return true;
  });
}
