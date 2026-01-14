# Portfolio Module - Reportes de Cartera y Limpieza

## Descripcion General

Modulo especializado en analisis de cartera: KPIs, tendencias, limpieza de prestamos inactivos y generacion de reportes PDF.

## Archivos Principales

| Archivo | Descripcion |
|---------|-------------|
| `src/services/PortfolioReportService.ts` | Logica de reportes de cartera |
| `src/services/PortfolioReportPDFService.ts` | Generacion de PDFs |
| `src/services/PortfolioCleanupService.ts` | Limpieza de cartera |
| `src/repositories/PortfolioCleanupRepository.ts` | Acceso a datos |
| `src/resolvers/portfolioReport.ts` | Resolvers GraphQL |
| `src/resolvers/portfolioCleanup.ts` | Resolvers de limpieza |
| `packages/business-logic/src/calculations/portfolio.ts` | **Calculos portables** |
| `docs/portfolio-report-kpis.md` | Documentacion detallada de KPIs |

## Modelo de Datos

### PortfolioCleanup
```prisma
model PortfolioCleanup {
  id                 String   @id
  name               String   // Nombre descriptivo
  description        String   // Descripcion/notas
  cleanupDate        DateTime // Fecha de ejecucion
  fromDate           DateTime? // Rango inicio
  toDate             DateTime? // Rango fin
  excludedLoansCount Int      // Prestamos excluidos
  excludedAmount     Decimal  // Monto total excluido

  route       String?         // Ruta (opcional)
  executedBy  String          // Usuario que ejecuto

  loansExcluded Loan[]        // Prestamos marcados
}
```

## Business Rules (CRITICAS)

### BR-POR-001: Prestamo Activo
```typescript
// Para mes ACTUAL:
isActiveLoan(loan) =
  loan.renewedDate === null &&      // NO renovado
  loan.pendingAmountStored > 0 &&   // Tiene deuda
  loan.badDebtDate === null &&      // NO en cartera muerta
  loan.excludedByCleanup === null   // NO excluido

// Para meses PASADOS:
wasLoanActiveInWeek(loan, week) =
  loan.signDate <= week.end &&
  (loan.finishedDate === null || loan.finishedDate >= week.start) &&
  (loan.renewedDate === null || loan.renewedDate >= week.start) &&
  (loan.badDebtDate === null || loan.badDebtDate >= week.start) &&
  loan.excludedByCleanup === null
```

> **IMPORTANTE**: Un prestamo con `renewedDate` NO cuenta como activo.

### BR-POR-002: Cartera Vencida (CV)
```typescript
// Un prestamo esta en CV si:
isInCV(loan, payments, week) =
  isActiveLoan(loan) &&
  !isNewLoanThisWeek(loan, week) &&  // Nuevos tienen gracia
  countPaymentsInWeek(payments, week) === 0

// Promedio CV del mes:
promedioCV = totalCVSemanasCompletadas / semanasCompletadas.length
```

### BR-POR-003: Balance de Clientes
```typescript
// Cliente NUEVO:
isNewClient = loan.previousLoan === null && signedInPeriod

// Terminado SIN renovar:
isTerminated = finishedInPeriod && loan.renewedDate === null

// RENOVACION verdadera:
isRenewal = loan.previousLoan !== null &&
            signedInPeriod &&
            loan.amountGived < loan.requestedAmount  // Habia deuda

// Balance:
balance = nuevos - terminadosSinRenovar
```

### BR-POR-004: Tasa de Renovacion
```typescript
tasaRenovacion = renovaciones / (renovaciones + terminadosSinRenovar)
```

### BR-POR-005: Semanas del Mes
- Las semanas van de Lunes a Domingo
- Una semana pertenece al mes donde tiene >= 4 dias
- Una semana esta "completada" si `now > week.end`

### BR-POR-006: Limpieza de Cartera
```typescript
// Criterios para cleanup:
1. Prestamos sin actividad por X meses
2. Prestamos con badDebtDate muy antigua
3. Prestamos de clientes fallecidos sin pago reciente

// Al ejecutar:
- loan.excludedByCleanup = cleanupId
- El prestamo NO aparece en reportes futuros
- El historial se mantiene para auditoria
```

## API GraphQL

### Queries
```graphql
# Reporte de cartera
portfolioReport(
  routeIds: [ID!]
  year: Int!
  month: Int!
): PortfolioReport!

# Desglose semanal
portfolioWeekReport(
  routeIds: [ID!]
  year: Int!
  weekNumber: Int!
): WeekReport!

# Preview de limpieza (sin ejecutar)
previewPortfolioCleanup(
  routeId: ID
  fromDate: DateTime
  toDate: DateTime
  criteria: CleanupCriteria!
): CleanupPreview!

# Limpiezas ejecutadas
portfolioCleanups(routeId: ID): [PortfolioCleanup!]!
```

### Mutations
```graphql
# Ejecutar limpieza
executePortfolioCleanup(
  input: ExecuteCleanupInput!
): PortfolioCleanup!

# Revertir limpieza (reincluir prestamos)
revertPortfolioCleanup(
  cleanupId: ID!
): Boolean!
```

## Estructura del Reporte

### Summary (Resumen del Mes)
```typescript
interface PortfolioSummary {
  totalClientesActivos: number      // Prestamos activos final mes
  clientesActivosInicio: number     // Activos inicio mes
  clientesEnCV: number              // En CV ultima semana
  promedioCV: number                // Promedio semanal CV
}
```

### Week Report (Por Semana)
```typescript
interface WeekReport {
  weekNumber: number
  startDate: Date
  endDate: Date
  isCompleted: boolean

  activos: number         // Prestamos activos esa semana
  enCV: number            // Sin pago esa semana
  nuevos: number          // Firmados esa semana
  terminados: number      // Finalizados esa semana
  renovados: number       // Renovaciones esa semana

  cobranzaEsperada: Decimal
  cobranzaReal: Decimal
  tasaRecuperacion: number
}
```

### Client Balance
```typescript
interface ClientBalance {
  nuevos: number                // Primer prestamo
  terminadosSinRenovar: number  // Salieron
  renovados: number             // Renovaron
  balance: number               // Crecimiento neto
}
```

## Flujos Principales

### Generacion de Reporte
```
1. Obtener prestamos activos en el periodo
2. Obtener pagos del periodo
3. Calcular semanas del mes
4. Para cada semana:
   a. Filtrar pagos de la semana
   b. Calcular activos, CV, nuevos, terminados
5. Calcular summary y balance
6. Calcular tendencias vs mes anterior
```

### Limpieza de Cartera
```
1. Preview: mostrar prestamos que cumplen criterios
2. Usuario revisa y confirma
3. Ejecutar: marcar prestamos con excludedByCleanup
4. Crear registro PortfolioCleanup
5. Los prestamos excluidos no aparecen en reportes
```

## Calculos Portables

En `@solufacil/business-logic/src/calculations/portfolio.ts`:

```typescript
// Verificar si prestamo activo
export function isActiveLoan(loan: LoanSnapshot): boolean

// Verificar CV
export function isInCarteraVencida(
  loan: LoanSnapshot,
  payments: PaymentSnapshot[],
  week: WeekPeriod
): boolean

// Calcular balance de clientes
export function calculateClientBalance(
  loans: LoanSnapshot[],
  periodStart: Date,
  periodEnd: Date
): ClientBalance

// Calcular KPIs de renovacion
export function calculateRenovationKPIs(
  loans: LoanSnapshot[]
): RenovationKPIs
```

## Documentacion Adicional

Ver `docs/portfolio-report-kpis.md` para:
- Definiciones exactas de cada KPI
- Ejemplos de calculos
- Casos edge y problemas conocidos
- Archivos relevantes con lineas de codigo

---

**Ultima actualizacion**: 2024
