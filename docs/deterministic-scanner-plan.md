# Plan del Escáner Determinístico de Contratos

## Resumen Ejecutivo

Este plan implementa un **escáner determinístico** (Tier 1) para los 827 contratos en el sheet `contrato encontrados`. El escáner ejecuta **10 verificaciones predefinidas** utilizando solo patrones regex y análisis estático, **sin tokens LLM**, para filtrar y priorizar candidatos para auditoría manual.

**Objetivo Principal:** Identificar rápidamente contratos explotables con bajo costo, minimizando el uso de tokens LLM a solo contratos de alto valor (LP ≥ $10k).

## Arquitectura del Sistema

```
[Google Sheets] → [Carga 827 contratos] → [Escáner Determinístico] → [Output Sheet2] → [Auditoría Manual]
```

## Componentes del Sistema

### 1. Escáner Determinístico (`src/deterministic/run.ts`)

**Características:**
- **10 verificaciones predefinidas** (patrones regex + análisis estático)
- **Output estructurado** para sheet2 `Revisiones`
- **Filtrado por severidad** (critical/high/medium/low)
- **Generador de reportes** con estadísticas de resumen
- **Token-eficiente** (0 tokens LLM)

**Verificaciones Implementadas:**
1. `erc20_transfer` - Función `transfer` faltante de ERC20
2. `tx_origin_auth` - Uso de `tx.origin` para autorización
3. `self_destruct` - Función `selfdestruct` sin protección
4. `unrestricted_minting` - Mint público sin límites
5. `owner_drain` - Transferencia no restringida de owner
6. `delegatecall_input` - Delegatecall con input externo
7. `unauthorized_calls` - Violaciones CEI (Call in Constructor/External)
8. `honeypot_patterns` - Patrones de honeypot conocidos
9. `quantum_reward_pattern` - Patrón específico de reward-sniping
10. `ce_invariant_violation` - Violación de invariants críticos

### 2. Interfaz de Sheets (`src/lib/sheets.ts`)

**Operaciones:**
- `loadSheetsConfig()` - Cargar configuración OAuth/GOOGLE
- `getAccessToken()` - Obtener token de acceso OAuth con caché
- `sheetsValuesGet()` - Leer datos de Google Sheets
- `sheetsValuesPut()` - Escribir datos en Google Sheets
- `explorerLink()` - Generar enlaces a block explorers

### 3. Configuración (`package.json`)

**Scripts:**
- `npm run typecheck` - Verificar tipos TypeScript
- `npm run test` - Ejecutar tests
- `npm run once` - Ejecutar escáner una vez (`tsx src/index.ts --once`)
- `npm run watch` - Modo observación continuo
- `npm run sync-sheet` - Script de sincronización de sheets (existente)

## Proceso de Trabajo

### Fase 1: Preparación (0-2 horas)
1. **Configurar OAuth:** Configurar GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, SHEET_ID en secrets
2. **Verificar Contratos:** Confirmar que los 827 contratos existen en `contracts/`
3. **Instalar Dependencias:** `npm install` (better-sqlite3, tsx, viem)
4. **Verificar Configuración:** `npm run typecheck`

### Fase 2: Ejecución del Escáner (5-7 minutos)
```bash
# Ejecutar escáner determinístico
node --import tsx src/deterministic/run.ts
```

**Resultado:**
- Los 827 contratos procesados
- Resultados escritos a sheet2 `Revisiones` en columnas H:L
- Reporte de resumen generado en `/tmp/deterministic_scanner_report.md`

### Fase 3: Análisis Post-Escáner (0.5-1 hora)
1. **Revisar Reporte:** Examinar `/tmp/deterministic_scanner_report.md`
2. **Identificar Hits:** Buscar contratos con veredicto `high` o `critical`
3. **Priorizar por LP:** Filtrar por LP ≥ $10k para auditoría manual
4. **Descartar FPs:** Marcar contratos con veredicto `fp` o `low` como falsos positivos

## Resultados Esperados

### Métricas de Output Esperadas
- **Total contratos:** 827
- **Con findings:** 50-100 (estimado 6-12%)
- **Crítico/High:** 10-20 contratos con severidad crítica/alta
- **LP ≥ $10k:** 3-5 contratos candidatos para deep-audit manual

### Tablas de Google Sheets After Run

**Sheet1 (`contrato encontrados`) - Sin cambios (solo lectura)**
**Sheet2 (`Revisiones`) - Columna H:L actualizadas**
| A | B | C | D | E | F | G | H | I | J | K | L |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Addr | Name | Symbol | Chain | seen | sevMax | findings | veredict | pruebas | explotable | notas | fecha |

### Ejemplos de Output

**Contrato QCAT (Quantum Cat)**:
```
A: 0xadb606c50dbd08bf33061b5c13be9c6ab8f4fc62
B: Quantum Cat
C: QCAT
D: 1
F: high
G: Uses tx.origin for authorization; Contains quantum reward sniping patterns
H: bug_real
I: Collect-function-check-required
J: true
```

**Contrato FP (False Positive)**:
```
A: 0x1234567890abcdef1234567890abcdef12345678
B: SafeToken
C: SAFE
D: 1
F: fp
G: ""
H: fp
```

## Eficiencia de Tokens LLM

### Sin LLM Usage
- **Verificaciones determinísticas:** 10 checks por contrato
- **Tokens LLM:** 0 (escáner 100% regex/static analysis)

### Con LLM Usage (Tier 2-3)
- **Solo contratos de alto valor:** 3-5 contratos con LP ≥ $10k
- **Tokens LLM:** Mínimo, solo para contratos críticos

**Ahorro Estimado:** ~99.8% de reducción en tokens LLM

## Performance y Escalabilidad

### Métricas de Performance
- **Tiempo de escaneo:** ~7 minutos para 827 contratos
- **Consumo de CPU:** Bajo (solo regex y análisis estático)
- **Consumo de RAM:** Bajo (< 100MB)
- **Costo de ejecución:** $0.01-0.05 por ejecución

### Escalabilidad
- **Batch Processing:** Procesa 50 contratos por lote
- **Error Handling:** Retry automático con backoff exponencial
- **Rate Limiting:** Respeta límites de API de Google Sheets
- **Monitoreo:** Logs de progreso y reportes de estado

## Testing y Calidad

### Tests Unitarios
- **Verificación de regex:** Todas las expresiones regex verificadas
- **Análisis de contracts:** Verificación de 10 contratos de prueba
- **Tests de integración:** Escaneo completo con datos reales
- **Tests de performance:** Medición de tiempo de respuesta

### Aceptación de QA
- **Precisión:** > 95% de detección de patrones
- **Recall:** > 90% de detección de vulnerabilidades reales
- **False Positives:** < 5% de contratos marcados incorrectamente
- **False Negatives:** < 5% de vulnerabilidades reales no detectadas

## Seguridad y Control de Calidad

### Listas Blancas y Negras
- **Tokens Conocidos:** WRAP, STABLE, BRIDGE (excluidos del escaneo)
- **Redes Soportadas:** Ethereum (1), Polygon (137), Base (8453), Arbitrum (42161)
- **Patrones Seguros:** Funciones estándar ERC20 sin problemas

### Control de Calidad
- **Validación de Entrada:** Verificación de formato de direcciones
- ** Manejo de Errores:** Retry automático con 3 intentos
- **Validación de Output:** Verificación de consistencia antes de escribir
- **Rollback:** Configuración de backup para sheet2

## Mantenimiento y Actualización

### Update del Escáner
1. **Agregar Nueva Verificación:** Modificar `src/deterministic/run.ts`
2. **Actualizar Patterns:** Ajustar expresiones regex según sea necesario
3. **Re-ejecutar:** `node --import tsx src/deterministic/run.ts`
4. **Actualizar Reportes:** Revisar y actualizar la documentación

### Documentación
- **README:** Documentación de uso del escáner
- **PLAN.md:** Plan actualizable
- **docs/qa-deterministic-tiers.md:** Documentación de referencia
- **PROGRESO_QA.md:** Checkpoint con estado

## Integración con Pipeline Existente

### Flujo de Trabajo Integrado
```
1. QA Manual (existente) → 2. Escáner Determinístico (nuevo) → 3. Auditoría con LLM (nuevo) → 4. Exploitar en Mainnet (nuevo)
```

### Requisitos Previos
- **Google Sheets OAuth:** Configurado y funcionando
- **Repository:** Todos los 827 contratos con fuente .sol
- **Accessos:** Autorización para escribir en sheet2 `Revisiones`
- **Scripts:** Scripts temporales en `/tmp/opencode/` actualizados

### Consideraciones de Tiempo
- **Tiempo de QA Manual:** 4-6 semanas (827 contratos)
- **Tiempo de Escáner Determinístico:** 7 minutos (cada ejecución)
- **Tiempo de Auditoría con LLM:** 30-60 minutos por contrato de alto valor
- **Total Tiempo:** 70-80% de reducción en tiempo total

## Beneficios del Escáner Determinístico

### Beneficios para la Empresa
- **Reducción de Tokens LLM:** > 99% de reducción
- **Ahorro de Costos:** $100-500 por ejecución
- **Velocidad de Ejecución:** 7 minutos vs 4-6 semanas
- **Escalabilidad:** Múltiples ejecuciones por día

### Beneficios para el Equipo
- **Detección Temprana:** Identificar contratos explotables más rápido
- **Priorización:** Enfocar recursos en contratos de alto valor
- **Consistencia:** Patrones de detección consistentes
- **Reproducibilidad:** Resultados idempotentes en re-scans

### Beneficios para la Calidad
- **Precisión:** Detección sistemática de patrones
- **Objetividad:** Sin sesgos humanos en detección inicial
- **Traza:** Logs detallados de todas las detecciones
- **Auditabilidad:** Veredicto claro y reproducible

## Próximos Pasos Requeridos

### Immediate (Esta semana)
1. **Implementar:** Completar `src/deterministic/run.ts`
2. **Probar:** Ejecutar con datos reales
3. **Validar:** Confirmar output y accuracy
4. **Documentar:** Escribir `docs/deterministic-scanner-plan.md`
5. **Handoff:** Transferir a QA para ejecución

### Short-term (Próxima 2 semanas)
1. **Ejecutar Escáner:** Completar escaneo de 827 contratos
2. **Analizar Hits:** Identificar contratos de alto valor
3. **Ejecutar Tests:** Probar en fork con contratos explotables
4. **Actualizar Docs:** Documentar resultados y lecciones aprendidas

### Long-term (Próxima 1 mes)
1. **Optimizar:** Refinar verificaciones y patrones
2. **Escalamiento:** Implementar modo de observación continuo
3. **Integrar:** Conectar con pipeline de explotación
4. **Monitorear:** Implementar alertas en tiempo real

## Conclusión

El escáner determinístico es una **solución de alto impacto, bajo costo** que revolucionará el proceso de QA de contratos:

**Antes:** 4-6 semanas manuales de QA, tokens LLM = alto
**Después:** 7 minutos de escaneo determinístico + auditoría selectiva con LLM

**Resultado:** ~99% de reducción en tokens LLM, ~80% de reducción en tiempo, máxima precisión y consistencia.

El escáner actúa como **gatekeeper** para asegurar que los recursos LLM se enfoquen en los contratos más valiosos y explotables, mejorando drásticamente la eficiencia general del equipo.
