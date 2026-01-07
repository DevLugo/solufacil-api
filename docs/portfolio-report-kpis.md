# Reporte de Cartera - Cálculo de KPIs

## Resumen

Este documento explica cómo se calculan los KPIs del Reporte de Cartera (Portfolio Report).

---

## 1. Clientes Activos (`totalClientesActivos`)

### Definición
Número de préstamos activos al final del período (mes).

### Cálculo Actual

**Para el mes ACTUAL:**
```typescript
// Usa isActiveLoan() - verifica estado actual del préstamo
isActiveLoan(loan) =
  loan.renewedDate === null &&  // ✅ IMPORTANTE: Préstamos renovados NO cuentan
  loan.pendingAmountStored > 0 &&
  loan.badDebtDate === null &&
  loan.excludedByCleanup === null
```

> ⚠️ **IMPORTANTE**: Un préstamo con `renewedDate` establecido NO se cuenta como activo,
> aunque tenga `pendingAmountStored > 0`. El préstamo que lo reemplazó es el que cuenta.

**Para meses PASADOS:**
```typescript
// Usa wasLoanActiveInWeek() - verifica estado en la última semana del mes
wasLoanActiveInWeek(loan, lastCompletedWeek) =
  loan.signDate <= week.end &&
  (loan.finishedDate === null || loan.finishedDate >= week.start) &&
  (loan.renewedDate === null || loan.renewedDate >= week.start) &&
  (loan.badDebtDate === null || loan.badDebtDate >= week.start) &&
  loan.excludedByCleanup === null
```

### Archivos Relevantes
- `api/src/services/PortfolioReportService.ts` - líneas 1392-1414
- `api/packages/business-logic/src/calculations/portfolio.ts` - funciones `isActiveLoan`, `wasLoanActiveInWeek`

### Problemas Conocidos
- Para meses pasados, depende de que los préstamos tengan las fechas correctamente registradas (finishedDate, renewedDate, badDebtDate)

---

## 2. Clientes Activos al Inicio (`clientesActivosInicio`)

### Definición
Número de clientes activos al inicio del mes.

### Cálculo Actual
```typescript
// Usa el totalClientesActivos del mes anterior
clientesActivosInicio = previousReport.summary.totalClientesActivos
```

### Archivos Relevantes
- `web/app/(auth)/reportes/cartera/page.tsx` - líneas 371-375

### Notas
- Se obtiene del frontend usando el reporte del mes anterior
- Antes se intentó calcular en el backend con fórmulas, pero era inconsistente

---

## 3. Cartera Vencida (`clientesEnCV` / `promedioCV`)

### Definición
Un préstamo está en CV si NO recibió ningún pago durante la semana activa.

### Cálculo

**Para datos históricos:**
```typescript
wasInCarteraVencidaForWeek(loan, payments, week) =
  wasLoanActiveInWeek(loan, week) &&
  !isDateInWeek(loan.signDate, week) &&  // Nuevos tienen gracia
  countPaymentsInWeek(payments, week) === 0
```

**Para datos actuales:**
```typescript
isInCarteraVencida(loan, payments, week) =
  isActiveLoan(loan) &&
  !isDateInWeek(loan.signDate, week) &&
  countPaymentsInWeek(payments, week) === 0
```

### Promedio CV del Mes
```typescript
promedioCV = totalCVFromCompletedWeeks / completedWeeks.length
```

Solo se calcula con semanas COMPLETADAS (ya pasadas).

### Archivos Relevantes
- `api/packages/business-logic/src/calculations/portfolio.ts` - funciones `isInCarteraVencida`, `wasInCarteraVencidaForWeek`

---

## 4. Balance de Clientes (`clientBalance`)

### Definición
Cambio neto en el número de clientes durante el período.

### Componentes

| Campo | Descripción | Cálculo |
|-------|-------------|---------|
| `nuevos` | Clientes nuevos | Préstamos con `previousLoan === null` firmados en el período |
| `terminadosSinRenovar` | Clientes que se fueron | Préstamos terminados sin renovación en el período |
| `renovados` | Clientes que renovaron | Préstamos renovados en el período |
| `balance` | Cambio neto | `nuevos - terminadosSinRenovar` |

### Funciones de Cálculo

```typescript
// Cliente nuevo
isNewClientInPeriod(loan, periodStart, periodEnd) =
  loan.previousLoan === null &&
  loan.signDate >= periodStart &&
  loan.signDate <= periodEnd

// Terminado sin renovar
isFinishedWithoutRenewal(loan, periodStart, periodEnd) =
  loan.finishedDate >= periodStart &&
  loan.finishedDate <= periodEnd &&
  loan.renewedDate === null  // Si tiene renewedDate, fue renovado

// Renovación VERDADERA
// Un préstamo ES una renovación si:
// 1. Tiene previousLoan (referencia a un préstamo anterior)
// 2. El préstamo anterior TENÍA DEUDA pendiente (amountGived < requestedAmount)
// 3. Se firmó en el período
isRenewalInPeriod(loan, periodStart, periodEnd) =
  loan.previousLoan !== null &&
  loan.signDate >= periodStart && loan.signDate <= periodEnd &&
  loan.amountGived < loan.requestedAmount  // ← Había deuda pendiente
```

### Archivos Relevantes
- `api/packages/business-logic/src/calculations/portfolio.ts` - función `calculateClientBalance`
- `api/src/services/PortfolioReportService.ts` - función `getLoansWithActivityInPeriod`

---

## 5. Tasa de Renovación (`tasaRenovacion`)

### Definición
Porcentaje de préstamos que terminaron y fueron renovados.

### Cálculo
```typescript
tasaRenovacion = totalRenovaciones / (totalRenovaciones + totalCierresSinRenovar)
```

### Archivos Relevantes
- `api/packages/business-logic/src/calculations/portfolio.ts` - función `calculateRenovationKPIs`

---

## Flujo de Datos

### 1. Query Principal
```
getActiveLoansWithPaymentsForMonth(periodStart, periodEnd, filters)
```

**Criterios de inclusión:**
- `signDate <= periodEnd` (firmado antes del fin del período)
- `finishedDate` es NULL o `>= periodStart` (activo durante el período)
- `renewedDate` es NULL o `>= periodStart` (no renovado antes del período)
- `badDebtDate` es NULL o `>= periodStart` (no marcado bad debt antes)
- `excludedByCleanup` es NULL

### 2. Filtrado por Semana
Para cada semana del mes, se filtran los pagos y se calcula el status:
```typescript
for (const week of weeks) {
  const weekPaymentsMap = filterPaymentsByWeek(allPayments, week)
  const weekStatus = countClientsStatus(loans, weekPaymentsMap, week, isCompleted)
}
```

### 3. Cálculo de Summary
```typescript
calculateSummaryForMonth(loans, paymentsMap, lastCompletedWeek, ...)
```

---

## Semanas y Períodos

### Semana Activa
- Lunes 00:00:00 a Domingo 23:59:59
- Una semana está "completada" si `now > week.end`

### Semanas del Mes
Las semanas se asignan al mes donde tienen más días (>= 4 días).

---

## Filtros

### Filtro por Ruta
Se aplica a todas las queries:
```typescript
OR: [
  { snapshotRouteId: { in: routeIds } },
  { leadRelation.routes.some: { id: { in: routeIds } } }
]
```

---

## Problemas Conocidos y Pendientes

### 1. Inconsistencia en Datos Históricos
- **Problema**: Si `finishedDate`, `renewedDate`, o `badDebtDate` no están correctamente registrados, los cálculos históricos serán incorrectos.
- **Solución**: Depende de la integridad de los datos.

### 2. Doble Conteo en Renovaciones
- **Problema**: Cuando un préstamo se renueva dentro de una semana, tanto el préstamo antiguo como el nuevo podrían contarse.
- **Estado**: Pendiente de verificar.

### 3. Clientes Activos en Mes Actual
- **Problema**: El conteo debe reflejar el estado ACTUAL, no de una semana pasada.
- **Solución aplicada**: Para el mes actual, se usa `isActiveLoan` (pendingAmountStored > 0).

---

## Glosario

| Término | Significado |
|---------|-------------|
| `pendingAmountStored` | Monto pendiente del préstamo (0 = pagado) |
| `finishedDate` | Fecha en que el préstamo terminó (pagado completamente) |
| `renewedDate` | Fecha en que el préstamo fue renovado |
| `badDebtDate` | Fecha en que el préstamo fue marcado como cartera muerta |
| `excludedByCleanup` | Préstamo excluído por limpieza de datos |
| `previousLoan` | ID del préstamo anterior (null = cliente nuevo) |
| `signDate` | Fecha de firma del préstamo |
| `status` | Estado del préstamo: 'ACTIVE', 'FINISHED', 'CANCELLED' |
| `renewedDate` | ⚠️ Si está establecido, indica que el préstamo fue renovado (reemplazado por otro). **NO cuenta como activo** |

---

## Archivos Principales

| Archivo | Descripción |
|---------|-------------|
| `api/src/services/PortfolioReportService.ts` | Servicio principal que orquesta los cálculos |
| `api/packages/business-logic/src/calculations/portfolio.ts` | Funciones de cálculo de KPIs |
| `api/packages/business-logic/src/calculations/active-week.ts` | Funciones de manejo de semanas |
| `api/packages/business-logic/src/types/portfolio.ts` | Tipos TypeScript |
| `web/app/(auth)/reportes/cartera/page.tsx` | Frontend del reporte |
| `web/app/(auth)/reportes/cartera/hooks/usePortfolioReport.ts` | Hook de datos |
