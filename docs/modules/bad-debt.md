# Bad Debt Module - Cartera Vencida y Muerta

## Descripcion General

Modulo para identificar, rastrear y gestionar prestamos en cartera vencida (CV) y cartera muerta (dead debt).

## Archivos Principales

| Archivo | Descripcion |
|---------|-------------|
| `src/services/BadDebtClientsService.ts` | Identificacion de clientes en CV |
| `src/services/BadDebtPDFService.ts` | Generacion de reportes PDF |
| `src/resolvers/badDebtClients.ts` | Resolvers GraphQL |
| `src/resolvers/deadDebt.ts` | Resolvers de cartera muerta |
| `packages/business-logic/src/calculations/portfolio.ts` | Calculos de CV |
| `packages/business-logic/src/calculations/vdo.ts` | Calculos de VDO |

## Conceptos Clave

### Cartera Vencida (CV)
- Prestamos activos que NO recibieron pago en la semana actual
- Es un estado **temporal** que puede cambiar semana a semana
- Los prestamos nuevos (firmados esta semana) tienen **gracia**

### Cartera Muerta (Dead Debt / Bad Debt)
- Prestamos marcados explicitamente como incobrables
- Se marca con `badDebtDate` en el prestamo
- Es un estado **permanente** (hasta que se recupere)

### VDO (Valor Deuda Observada)
- Monto de deuda en riesgo
- Se calcula sobre prestamos con semanas sin pago

## Business Rules

### BR-BD-001: Identificacion de CV
```typescript
isInCarteraVencida(loan, payments, currentWeek) =
  isActiveLoan(loan) &&
  !isNewLoanThisWeek(loan, currentWeek) &&  // Gracia para nuevos
  countPaymentsInWeek(payments, currentWeek) === 0
```

### BR-BD-002: Semanas Sin Pago
```typescript
// Contar semanas consecutivas sin pago
weeksWithoutPayment = 0
for (week from currentWeek down to signWeek) {
  if (hasPaymentInWeek(week)) break
  weeksWithoutPayment++
}
```

### BR-BD-003: Marcar como Bad Debt
```typescript
// Criterios para marcar (decision del usuario):
1. Semanas sin pago >= umbral (ej: 4+ semanas)
2. Cliente no localizable
3. Cliente fallecido (isDeceased = true)

// Al marcar:
loan.badDebtDate = fecha
// El prestamo sigue ACTIVE pero los pagos van 100% a profit
```

### BR-BD-004: Pagos en Bad Debt
```typescript
// Si badDebtDate IS NOT NULL:
paymentProfit = payment.amount  // 100% a ganancia
paymentCapital = 0              // Nada a capital

// Incentiva la cobranza de deuda dificil
```

### BR-BD-005: Calculo de VDO
```typescript
// VDO = Deuda pendiente de prestamos en riesgo
vdo = SUM(loan.pendingAmountStored)
  WHERE weeksWithoutPayment >= 2
  AND badDebtDate IS NULL
  AND excludedByCleanup IS NULL
```

### BR-BD-006: Clasificacion por Antiguedad
```typescript
// Categorias de CV:
- 1 semana sin pago: "Atraso leve"
- 2-3 semanas: "Atraso moderado"
- 4+ semanas: "Atraso severo"
- badDebtDate set: "Cartera muerta"
```

## API GraphQL

### Queries
```graphql
# Clientes en cartera vencida
badDebtClients(
  routeId: ID
  minWeeksWithoutPayment: Int
): [BadDebtClient!]!

# Resumen de cartera vencida
badDebtSummary(routeId: ID): BadDebtSummary!

# Prestamos para revision de CV
loansForBadDebt(routeId: ID): [Loan!]!

# VDO por ruta
vdoByRoute(routeId: ID!): VDOReport!
```

### Mutations
```graphql
# Marcar como bad debt
markAsBadDebt(
  loanId: ID!
  badDebtDate: DateTime!
): Loan!

# Quitar marca de bad debt (recuperacion)
clearBadDebt(loanId: ID!): Loan!

# Marcar cliente como fallecido
markAsDeceased(loanId: ID!): Loan!
```

## Estructuras de Datos

### BadDebtClient
```typescript
interface BadDebtClient {
  loan: Loan
  borrower: Borrower
  weeksWithoutPayment: number
  lastPaymentDate: Date | null
  pendingAmount: Decimal
  category: 'MILD' | 'MODERATE' | 'SEVERE' | 'DEAD'
}
```

### BadDebtSummary
```typescript
interface BadDebtSummary {
  totalLoansInCV: number
  totalAmountInCV: Decimal
  byCategory: {
    mild: { count: number; amount: Decimal }
    moderate: { count: number; amount: Decimal }
    severe: { count: number; amount: Decimal }
    dead: { count: number; amount: Decimal }
  }
  vdo: Decimal
}
```

### VDOReport
```typescript
interface VDOReport {
  totalVDO: Decimal
  loansAtRisk: number
  averageWeeksWithoutPayment: number
  byLead: {
    leadId: string
    leadName: string
    vdo: Decimal
    loansCount: number
  }[]
}
```

## Flujos Principales

### Revision de Cartera Vencida
```
1. Obtener prestamos activos de la ruta
2. Para cada prestamo:
   a. Contar semanas sin pago
   b. Categorizar por antiguedad
3. Ordenar por severidad (mayor a menor)
4. Mostrar para revision del usuario
```

### Marcar Bad Debt
```
1. Usuario selecciona prestamo
2. Confirma fecha de marca
3. Actualizar loan.badDebtDate
4. Los pagos futuros van 100% a profit
5. El prestamo sigue como ACTIVE (puede recibir pagos)
```

### Generacion de PDF
```
1. Filtrar prestamos en CV/bad debt
2. Agrupar por lead/localidad
3. Incluir: cliente, deuda, semanas sin pago
4. Calcular totales por categoria
5. Generar PDF con tablas y resumen
```

## Exportacion PDF

El reporte PDF incluye:
- Encabezado con fecha y ruta
- Tabla de clientes por categoria
- Columnas: Cliente, Localidad, Deuda, Sem. Sin Pago, Ultimo Pago
- Totales por categoria
- VDO total

## Consideraciones

### Performance
- El calculo de semanas sin pago puede ser costoso
- Se cachea/calcula en batch para listados
- Los filtros reducen el conjunto de datos

### Auditoria
- Los cambios a badDebtDate quedan en historial
- Se registra quien y cuando marco/desmarco
- La fecha de marca es importante para reportes

---

**Ultima actualizacion**: 2024
