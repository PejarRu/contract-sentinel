# PROMPTS/01 — PLAN.md + scaffold completo (auditor stub)

**Fase activa por defecto.** Ejecutar tras leer `START.md` + `AGENTS.md`.

---

Nuevo proyecto en el equipo cripto que ya tiene corriendo:

1) Radar read-only de spreads stocks ↔ tokenized equities (medida de quotes, sin ejecutar) — **fuera de este repo**.
2) Hermano: `morpho-liquidation` en `/mnt/shared/work_projects/Proyectos de trabajo/_activos/morpho-liquidation` (remote `github.com:PejarRu/morpho-liquidation`) — scanner TS, executors, email 12h. **Solo referencia de estilo.**
3) **ESTE:** bot de auditoría automática de protocolos recién desplegados. Repo en `.../_activos/contract-sentinel` (misma convención).

## Contexto del equipo (NO reinventar)

- Convención: `/mnt/shared/work_projects/Proyectos de trabajo/_activos/<repo>`
- Estilo: `AGENTS.md`, `docs/SESSION_HANDOFF.md` (STATUS LATEST + Date), `DECISIONS.md`, SQLite, `email_templates/` + SMTP por env, `node --test` + `npm run typecheck`, docker opcional.
- SHA morpho: usar `git -C …/morpho-liquidation log -1` (no hardcodear `e3a0521`).
- VPS equipo (si se despliega después): patrón morpho — bundle+scp, sin SSH GitHub, `/opt/<repo>`, sin secretos en imagen/git.
- Handoff obligatorio al cerrar fase (ver `AGENTS.md`).

## Repo

`/mnt/shared/work_projects/Proyectos de trabajo/_activos/contract-sentinel`  
Al final: `git init` + remote `github.com:PejarRu/contract-sentinel` + commit + push.

Stack: **Node 22 + TypeScript**, SQLite, Docker opcional (env-driven).

## Pipeline (read-only Ethereum chainId 1)

### a) SCANNER `src/scanner/`

- Intervalo: `SCAN_INTERVAL_MIN` (default 15).
- Fuentes con fallback:
  1. **Etherscan API v2** (`chainid=1`) con `ETHERSCAN_API_KEY` — preferir API oficial a HTML; si scrapeas directorio: UA + cache + outage como en morpho.
  2. Fallback discovery: DefiLlama / DexScreener / GeckoTerminal.
- Filtros: dedupe SQLite; `src/config/known_symbols.ts` (wrap/stable/bridge); excluir sin código verificado.

### b) ENLAZADOR `src/resolve/link.ts`

- URL oficial (fuente o heurística homepage).
- Regex `0x[a-fA-F0-9]{40}` solo en `etherscan.io/(address|token|proxy)` + links.
- Fallback: Etherscan por nombre/símbolo.
- `LinkedContract | null`.

### c) RESOLVER `src/resolve/contract.ts`

- Proxy: badge, **EIP-1967** implementation slot, admin slot, EIP-1822, legacy OZ, `delegatecall` en bytecode.
- `implementation` (+ admin opcional).
- `getsourcecode` verificado; multi-file → disco `contracts/<address>/`.
- Cache por dirección (disco + DB).
- Salida normalizada: `{ proxy, implementation, language, sources, abi }`.

### d) AUDITOR `src/audit/auditor.ts` — STUB

```ts
export interface AuditInput {
  address: `0x${string}`;
  implementation: `0x${string}` | null;
  code: { language: string; sources: Record<string, string>; abi: unknown };
  context: { protocolName: string; website?: string; chainId: 1; symbol?: string };
}
export interface Finding {
  severity: "info" | "low" | "medium" | "high" | "critical";
  title: string;
  detail: string;
  snippet?: string;
}
export interface Auditor { run(input: AuditInput): Promise<Finding[]>; }
```

- `StubAuditor`: `// TODO: fase 2` → `[]` o un info stub.
- Inyección: `createAuditor()` en `src/audit/index.ts`.

### e) ORQUESTADOR `src/orchestrator.ts`

- Cadena a→b→c→d.
- SQLite: `candidates`, `links`, `contracts`, `findings`, `runs` (+ `attempts`, `next_retry_at`).
- Exponential backoff + jitter; rate-limit Etherscan → cooldown global.
- CLI: `npm run once` / `npm run watch`.
- `reports/` JSON+HTML; `email_templates/` estilo morpho; solo si `EMAIL_ENABLED=true` + SMTP_* env.

## Env (`.env.example`)

`ETHERSCAN_API_KEY`, `DATABASE_PATH`, `CONTRACTS_DIR`, `REPORTS_DIR`, `SCAN_INTERVAL_MIN`, `EMAIL_ENABLED`, `SMTP_*`, `FROM`/`TO`, `CHAIN_ID=1`, `RPC_URL` (opcional `eth_getStorageAt`), `MOCK_MODE`.

## Tests

- Unit: regex direcciones, proxy con fixtures de slots/bytecode, filtros símbolos, backoff, dedupe.
- Integration: fixtures Etherscan en `fixtures/`.
- `typecheck` + `npm test` verdes; smoke `--once` con `MOCK_MODE=1`.
- Sin red por defecto.

## Docs

1. **PLAN.md** — arquitectura, árbol, interfaces, fuentes, env, tests, fases.
2. **README** — quickstart, salida de ejemplo, Docker (`docker compose run sentinel once`, volumes `./data`, `./contracts`, `./reports`).
3. **AGENTS.md** — rellenar tabla key files + comandos (ya hay base).
4. **SESSION_HANDOFF** + **DECISIONS** D001 (elección SQLite lib, fuentes Etherscan).

## Restricciones

- Autónomo; dudas → `DECISIONS.md`.
- Sin firmar tx ni claves.
- Sin secretos en git.
- mainnet; parametrizar chainId si es trivial.
- Comentarios mínimos (stub, slots EIP-1967).

## Orden

**PLAN.md → scaffold + implementación + tests → README/AGENTS/handoff → git init, commit, push.**
