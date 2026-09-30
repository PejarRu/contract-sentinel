# Roadmap: Escalado del pipeline de auditoría

## Estado actual
- Scanner regex: **descartado** (100% falsos positivos en 22 hits auditados)
- QCAT/QPEPE: **QPEPE descartado** (pierde dinero). **QCAT viable** en fork (PnL neto +$3–$69 según capital)
- 827 contratos en sheet, mayoría sin LP significativo

## Tres estrategias complementarias

### 1. Deep-audit manual (DeepSeek)
**Dificultad: baja**

Filtrar contratos por LP>$50k + verificados + <2 años → ~30 candidatos. Yo leo source y emito veredicto.

Pros: máxima precisión. Contras: no escala masivo.

### 2. Slither/Mythril (análisis AST)
**Dificultad: media**

`pip install slither-analyzer && slither contrato.sol --detect all`. Detectores mantenidos por Trail of Bits.

Pros: mucho más preciso que regex. Contras: lento (5–10s/contrato).

### 3. LLM barato como pre-filtro
**Dificultad: media**

Enviar source a GPT-4o-mini/Claude Haiku con prompt: "¿bug/maybe/no?". Solo hits pasan a mí.

Pros: escala barato a cientos. Contras: falsos negativos posibles.

## Pipeline ideal (combinado)
```
827 → slither (Codex) → ~50 alertas → LLM barato filtra (Codex) → ~5 candidatos → DeepSeek deep-audit
```

## Próximo paso inmediato
Filtrar contratos con LP>$50k verificados → top-30 → deep-audit manual directo (Estrategia 1 ya)
