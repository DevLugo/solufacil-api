# Reports Module - Reportes y Analitica

## Descripcion General

Modulo de generacion de reportes financieros, estadisticas de cobranza y exportacion de datos en PDF.

## Archivos Principales

| Archivo | Descripcion |
|---------|-------------|
| `src/services/ReportService.ts` | Reportes financieros |
| `src/services/PortfolioReportService.ts` | Reportes de cartera |
| `src/services/PdfService.ts` | Base de generacion PDF |
| `src/services/PdfExportService.ts` | Exportacion de historial |
| `src/services/ListadoPDFService.ts` | Listados de prestamos |
| `src/resolvers/reports.ts` | Resolvers GraphQL |

## Tipos de Reportes

### 1. Reporte Financiero (por Ruta/Periodo)
```typescript
interface FinancialReport {
  period: { year: number; month: number }
  route: Route

  // Ingresos
  totalPaymentsReceived: Decimal
  profitFromPayments: Decimal
  capitalReturned: Decimal

  // Gastos
  totalLoansGranted: Decimal
  totalCommissions: Decimal
  operatingExpenses: Decimal

  // Neto
  netBalance: Decimal
  recoveryRate: Decimal
}
```

### 2. Reporte de Cartera (Portfolio Report)
Ver `docs/portfolio-report-kpis.md` para detalle completo.

```typescript
interface PortfolioReport {
  summary: {
    totalClientesActivos: number    // Prestamos activos
    clientesActivosInicio: number   // Al inicio del mes
    clientesEnCV: number            // En cartera vencida
    promedioCV: number              // Promedio semanal CV
  }
  clientBalance: {
    nuevos: number                  // Clientes nuevos
    terminadosSinRenovar: number    // Clientes que salieron
    renovados: number               // Renovaciones
    balance: number                 // nuevos - terminados
  }
  tasaRenovacion: number            // % renovaciones
  weeks: WeekReport[]               // Desglose semanal
}
```

### 3. Listado de Prestamos
```typescript
interface LoanListReport {
  loans: Loan[]
  filters: {
    status?: LoanStatus
    routeId?: string
    locationId?: string
    dateRange?: { from: Date; to: Date }
  }
  totals: {
    count: number
    totalRequested: Decimal
    totalPending: Decimal
  }
}
```

## Business Rules

### BR-REP-001: Periodo de Reporte
- Los reportes financieros son mensuales
- Las semanas se asignan al mes donde tienen >= 4 dias
- La semana activa puede estar incompleta

### BR-REP-002: Cartera Vencida (CV)
```typescript
// Un prestamo esta en CV si:
isInCV = isActiveLoan(loan) &&
         !isNewLoanThisWeek(loan) &&  // Nuevos tienen gracia
         countPaymentsThisWeek(loan) === 0
```

### BR-REP-003: Tasa de Recuperacion
```typescript
recoveryRate = (totalPaid / expectedPayments) * 100

// expectedPayments = suma de pagos esperados de prestamos activos
```

### BR-REP-004: Balance de Clientes
```typescript
// Nuevos: primer prestamo del cliente en el periodo
isNewClient = loan.previousLoan === null && signedInPeriod

// Terminados sin renovar: terminaron y NO renovaron
isTerminated = finishedInPeriod && !wasRenewed

// Balance
balance = nuevos - terminadosSinRenovar
```

### BR-REP-005: Filtro por Ruta Historica
- Los reportes deben respetar la ruta historica
- Usar `snapshotRouteId` o `LocationRouteHistory`
- No asumir ruta actual = ruta historica

## API GraphQL

### Queries
```graphql
# Reporte financiero
financialReport(
  routeId: ID
  year: Int!
  month: Int!
): FinancialReport!

# Reporte de cartera
portfolioReport(
  routeIds: [ID!]
  year: Int!
  month: Int!
): PortfolioReport!

# Listado para PDF
loanListForPDF(
  routeId: ID
  locationId: ID
  status: LoanStatus
): LoanListExport!
```

## Endpoints REST (PDFs)

```
POST /api/export-client-history-pdf
Body: { borrowerId, format: 'detailed' | 'summary' }

POST /api/export-loan-list-pdf
Body: { routeId?, locationId?, status? }

POST /api/export-portfolio-report-pdf
Body: { routeIds, year, month }
```

## Flujos Principales

### Generacion de Reporte Financiero
```
1. Obtener AccountEntry del periodo (mes)
2. Agrupar por sourceType
3. Calcular ingresos (LOAN_PAYMENT_*)
4. Calcular gastos (LOAN_GRANT, *_EXPENSE)
5. Calcular neto y metricas
6. Comparar con periodo anterior (variacion %)
```

### Generacion de Reporte de Cartera
```
1. Obtener prestamos activos en el periodo
2. Calcular semanas del mes
3. Para cada semana: contar activos, CV, nuevos
4. Calcular promedios y balances
5. Determinar tendencias (vs mes anterior)
```

### Exportacion PDF
```
1. Obtener datos del reporte
2. Crear documento PDFKit
3. Agregar encabezado, tablas, graficos
4. Generar buffer
5. Retornar como descarga o base64
```

## Metricas Clave

### KPIs de Cartera
| KPI | Formula | Descripcion |
|-----|---------|-------------|
| Clientes Activos | COUNT(activos) | Prestamos sin terminar |
| Cartera Vencida | COUNT(sinPagoEstaSemana) | Sin pago esta semana |
| Tasa Renovacion | renovados/(renovados+terminados) | % que renuevan |
| Balance Clientes | nuevos - terminados | Crecimiento neto |

### KPIs Financieros
| KPI | Formula | Descripcion |
|-----|---------|-------------|
| Cobranza | SUM(pagos) | Total cobrado |
| Colocacion | SUM(otorgamientos) | Total prestado |
| Recuperacion | cobranza/esperado | % de cobro |
| Ganancia Neta | ingresos - gastos | Utilidad |

## Documentacion Adicional

- `docs/portfolio-report-kpis.md`: KPIs detallados de cartera
- `docs/payment-distribution-logic.md`: Logica de distribucion

---

**Ultima actualizacion**: 2024
