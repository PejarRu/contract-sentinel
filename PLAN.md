# PLAN.md — contract-sentinel

## Visión

Bot **read-only** de auditoría automática de protocolos/tokens recién desplegados en Ethereum mainnet. Pipeline: `SCANNER → ENLAZADOR → RESOLVER → AUDITOR (stub) → ORQUESTADOR`. Sin firmar tx, sin claves privadas.

## Stack

- Node 22 + TypeScript (ESM)
- SQLite (`better-sqlite3`)
- Etherscan API v2 como fuente primaria de discovery y verificación
- Docker opcional (env-driven)

## Árbol

```
contract-sentinel/
├── src/
│   ├── lib/
│   │   └── db.ts          # SQLite: schema + helpers
│   ├── scanner/
│   │   └── index.ts       # SCANNER: discovery de candidatos
│   ├── resolve/
│   │   ├── link.ts        # ENLAZADOR: URL oficial + regex de direcciones
│   │   └── contract.ts    # RESOLVER: proxy, EIP-1967, source, ABI
│   ├── audit/
│   │   ├── auditor.ts     # Auditor interface + StubAuditor
│   │   └── index.ts       # createAuditor() factory
│   ├── orchestrator.ts    # Cadena a→b→c→d + retries + CLI
│   └── index.ts           # Entry point
├── tests/
│   ├── scanner.test.ts
│   ├── link.test.ts
│   ├── contract.test.ts
│   ├── auditor.test.ts
│   ├── orchestrator.test.ts
│   └── db.test.ts
├── fixtures/              # Respuestas Ethersn mock para tests
├── contracts/             # Source files guardados por dirección
├── reports/               # JSON + HTML output
├── email_templates/       # HTML email {{KEY}}
├── data/                  # SQLite DB
├── docs/
│   ├── SESSION_HANDOFF.md
│   └── ...
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── PLAN.md
├── README.md
├── START.md
├── AGENTS.md
├── DECISIONS.md
└── PROMPTS/
```

## Pipeline detallado

### a) SCANNER (`src/scanner/`)

- Intervalo: `SCAN_INTERVAL_MIN` (default 15 min).
- Fuentes con fallback:
  1. **Etherscan API v2** (`chainid=1`) con `ETHERSCAN_API_KEY` — preferente.
  2. Fallback: DefiLlama / DexScreener / GeckoTerminal.
- Filtros: dedupe SQLite; `src/config/known_symbols.ts` (wrap/stable/bridge); excluir sin código verificado.
- Salida: lista de `Candidate` (address, name, symbol, chainId).

### b) ENLAZADOR (`src/resolve/link.ts`)

- URL oficial (fuente o heurística homepage).
- Regex `0x[a-fA-F0-9]{40}` solo en `etherscan.io/(address|token|proxy)` + links.
- Fallback: Etherscan por nombre/símbolo.
- Salida: `LinkedContract | null`.

### c) RESOLVER (`src/resolve/contract.ts`)

- Proxy: badge, **EIP-1967** implementation slot (`0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc`), admin slot (`0xa887051b171657b13c56c5395a81d5375a1b1a1b1a1b1a1b1a1b1a1b1a1b1a1b`... no, el admin slot EIP-1967 es `0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc` para admin de UUPS, y `0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103` para implementation de Beacon Proxy).
- `getsourcecode` Etherscan para código verificado; multi-file → disco `contracts/<address>/`.
- Cache por dirección (disco + DB).
- Salida normalizada: `{ proxy, implementation, language, sources, abi }`.

### d) AUDITOR (`src/audit/`) — STUB

- `StubAuditor`: `// TODO: fase 2` → `[]` o un info stub.
- Inyección: `createAuditor()` en `src/audit/index.ts`.
- Fase 2 (PROMPTS/02) implementará reglas reales.

### e) ORQUESTADOR (`src/orchestrator.ts`)

- Cadena a→b→c→d.
- SQLite: `candidates`, `links`, `contracts`, `findings`, `runs` (+ `attempts`, `next_retry_at`).
- Exponential backoff + jitter; rate-limit Etherscan → cooldown global.
- CLI: `npm run once` / `npm run watch`.
- `reports/` JSON+HTML; `email_templates/` estilo morpho; solo si `EMAIL_ENABLED=true` + SMTP_* env.

## Esquema SQLite

| Tabla | Contenido |
|---|---|
| `candidates` | address, name, symbol, chainId, discovered_at |
| `links` | candidate_id, url, linked_address, method |
| `contracts` | address, proxy, implementation, admin, language, sources_path, abi, cached_at |
| `findings` | run_id, contract_address, severity, title, detail, snippet |
| `runs` | id, status, started_at, finished_at, error |
| `attempts` | run_id, step, attempt, status, next_retry_at, error |

## Env (`.env.example`)

```
ETHERSCAN_API_KEY=
DATABASE_PATH=data/contract-sentinel.sqlite
CONTRACTS_DIR=contracts
REPORTS_DIR=reports
SCAN_INTERVAL_MIN=15
EMAIL_ENABLED=false
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
EMAIL_FROM=
EMAIL_TO=
CHAIN_ID=1
RPC_URL=
MOCK_MODE=
```

## Tests

- Unit: regex direcciones, proxy con fixtures de slots/bytecode, filtros símbolos, backoff, dedupe.
- Integration: fixtures Etherscan en `fixtures/`.
- `typecheck` + `npm test` verdes; smoke `--once` con `MOCK_MODE=1`.
- Sin red por defecto.

## Fases

| Fase | PROMPT | Contenido |
|---|---|---|
| 01 | `PROMPTS/01_plan_scaffold.md` | PLAN.md + scaffold + pipeline a–e (auditor stub) |
| 02 | `PROMPTS/02_auditor.md` | Fase auditor real |
| 03 | `PROMPTS/03_deploy.md` | Docker/VPS |

## Restricciones

- Autónomo; dudas → `DECISIONS.md`.
- Sin firmar tx ni claves.
- Sin secretos en git.
- Mainnet; parametrizar chainId si es trivial.
- Comentarios mínimos (stub, slots EIP-1967).
