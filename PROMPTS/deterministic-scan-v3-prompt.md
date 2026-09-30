# Prompt Codex: Arreglar patrones del escáner determinista (v3)

## Problema

El escáner v2 solo encontró `quantum_reward_pattern` y TODOS (~60) son falsos positivos: son tokens del protocolo **stfusend** (LaunchToken factory) con fee-sharing legítimo. Las regex actuales no detectan vulnerabilidades reales.

## Objetivo

Reemplazar los 10 checks actuales en `src/deterministic/run.ts` por patrones que detecten bugs REALES. Los patrones actuales son demasiado genéricos o simplemente incorrectos.

## Nuevos checks (sustituir TODOS los existentes)

Cada check debe ser una regex que busque la firma de la vulnerabilidad, NO solo nombres de funciones aislados.

### 1. `selfdestruct_unprotected`
Buscar `selfdestruct` O `suicide` que NO esté protegido por `onlyOwner`:
```
/(?<!onlyOwner.*\n.*)(selfdestruct|suicide)\s*\(/
```
Severity: critical

### 2. `tx_origin_auth_real`
Buscar `tx.origin` usado como mecanismo de autenticación (no en comentarios):
```
/tx\.origin\s*[=!]=|require\s*\([^)]*tx\.origin/
```
Severity: high

### 3. `unchecked_external_call`
Buscar `call{` o `.call(` que ignore el return value o no tenga `require(success` después:
```
/\.call\{(?!.*require\s*\([^)]*success)/s
```
(Usar flag `s` para multilínea)
Severity: high

### 4. `delegatecall_user_input`
Buscar `delegatecall` cuyo target venga de un parámetro de función externa/public (input controlable por usuario):
```
/function\s+\w+\s*\([^)]*address\s+\w+[^)]*\)[^{]*\{[^}]*\.delegatecall\(/
```
Severity: critical

### 5. `reentrancy_cei`
Buscar llamadas externas (`.call{`, `.transfer(`, `.send(`) ANTES de cambios de estado (balances, flags). Patrón: external call antes de `=` o `-=` o `= 0` o `= false`:
```
/\.call\{[^}]*\}[^}]*\n[^}]*\s*(=|[-+]=)\s*/
```
Severity: high

### 6. `public_mint_no_access`
Buscar `function mint` que sea `external` o `public` SIN modificador `onlyOwner`/`onlyRole`:
```
/function\s+mint\s*\([^)]*\)\s*(external|public)\s+(?:(?!onlyOwner|onlyRole|onlyMinter|onlyAdmin)[\s\S])*?\{/
```
Severity: critical

### 7. `sweep_token_unrestricted`
Buscar `sweepToken` o `withdrawToken` que permita al owner drenar cualquier token (incluyendo los de usuarios):
```
/function\s+(sweepToken|withdrawToken|rescueToken)\s*\([^)]*\)\s*(external|public)[^}]*onlyOwner/
```
Severity: high

### 8. `unlimited_approval`
Buscar `approve(spender, type(uint256).max)` o `approve(spender, ~uint256(0))` sin control:
```
/approve\s*\([^,]*,\s*(type\s*\(\s*uint256\s*\)\s*\.\s*max|~\s*uint256\s*\(\s*0\s*\))/
```
Severity: medium

### 9. `unverified_proxy`
Buscar contratos que usen `delegatecall` en `fallback()` (patrón típico de proxy no verificado):
```
/fallback\s*\(\s*\)\s*external[^}]*delegatecall/
```
Severity: high

### 10. `flash_loan_no_fee`
Buscar funciones de flash loan que no cobren fee (posible exploit de préstamo gratuito):
```
/function\s+(flashLoan|flashSwap)\s*\([^)]*\)[^}]*fee\s*==\s*0|flashLoan[^}]*amount\s*=\s*0/
```
Severity: medium

## Cambios técnicos en el código

1. **Sustituir array `CHECKS` completo** en `src/deterministic/run.ts` por los 10 nuevos
2. **Añadir flag `s` (dotAll)** a las regex que usan `[\s\S]` o `\n`:
   ```ts
   pattern: new RegExp("regex_aqui", "s"),
   ```
3. **El check `quantum_reward_pattern` DESAPARECE** — era falso positivo
4. **Mantener todo el resto** del código: fetch de Etherscan V2, rate limiting, caché, escritura al sheet

## Verificación

```bash
cd "/mnt/shared/work_projects/Proyectos de trabajo/_activos/contract-sentinel"
set -a; . secrets/local.env; set +a
npx tsx src/deterministic/run.ts
```

Esperado:
- Menos de 5 hits "high" o "critical" (no 60 falsos positivos)
- Los hits deben ser contratos con vulnerabilidades reales, no stfusend
- QCAT/QPEPE NO deben aparecer como "high"

## Notas
- No tocar `src/lib/sheets.js` ni `secrets/local.env`
- No commit sin preguntar
- Si un patrón no compila, ajustar escaping de regex en string de JS
