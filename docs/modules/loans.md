# Loans Module - Prestamos

## Descripcion General

Modulo central del sistema que maneja toda la logica de prestamos: creacion, renovacion, cancelacion y seguimiento. La logica de calculo esta encapsulada en `@solufacil/business-logic` para portabilidad a Flutter.

## Archivos Principales

| Archivo | Descripcion |
|---------|-------------|
| `src/services/LoanService.ts` | Orquestacion de operaciones de prestamos |
| `src/repositories/LoanRepository.ts` | Acceso a datos |
| `src/resolvers/loans.ts` | Resolvers GraphQL |
| `packages/business-logic/src/loan-engine/LoanEngine.ts` | **Motor de calculo (portable)** |
| `packages/business-logic/src/calculations/profit.ts` | Calculos de ganancia |

## Modelo de Datos

### Loan
```prisma
model Loan {
  id              String     @id
  requestedAmount Decimal    // Monto solicitado
  amountGived     Decimal    // Monto fisico entregado
  signDate        DateTime   // Fecha de firma
  finishedDate    DateTime?  // Fecha de finalizacion
  renewedDate     DateTime?  // Fecha de renovacion (si aplica)
  badDebtDate     DateTime?  // Fecha marcado cartera vencida
  isDeceased      Boolean    // Cliente fallecido

  profitAmount          Decimal // Ganancia total (base + heredada)
  totalDebtAcquired     Decimal // Deuda total = requestedAmount + profitAmount
  expectedWeeklyPayment Decimal // Pago semanal esperado
  totalPaid             Decimal // Total pagado hasta ahora
  pendingAmountStored   Decimal // Deuda pendiente
  comissionAmount       Decimal // Comision de otorgamiento

  status LoanStatus // ACTIVE, FINISHED, CANCELLED

  borrower String   // Prestatario
  loantype String   // Tipo de prestamo
  grantor  String?  // Empleado que otorgo
  lead     String?  // Lead responsable

  collaterals PersonalData[] // Avales
  previousLoan String?       // Prestamo anterior (renovacion)

  snapshotLeadId String?     // Snapshot historico del lead
}

enum LoanStatus {
  ACTIVE
  FINISHED
  CANCELLED
}
```

### Loantype (Producto)
```prisma
model Loantype {
  id                   String  @id
  name                 String  // Ej: "14 semanas 40%"
  weekDuration         Int     // Duracion en semanas
  rate                 Decimal // Tasa de interes (0.40 = 40%)
  loanPaymentComission Decimal // Comision por pago
  loanGrantedComission Decimal // Comision por otorgamiento
}
```

## Business Rules (CRITICAS)

### BR-LOAN-001: Calculo de Prestamo Nuevo
```typescript
// Formula:
profitBase = requestedAmount * rate
totalDebtAcquired = requestedAmount + profitBase
expectedWeeklyPayment = totalDebtAcquired / weekDuration
amountGived = requestedAmount // Monto completo para prestamo nuevo
```

**Ejemplo**: Prestamo de $3,000 al 40% por 14 semanas
- profitBase = 3000 * 0.40 = $1,200
- totalDebt = 3000 + 1200 = $4,200
- weeklyPayment = 4200 / 14 = $300

### BR-LOAN-002: Renovacion con Profit Heredado
```typescript
// Cuando se renueva un prestamo con deuda pendiente:
profitRatio = previousLoan.profitAmount / previousLoan.totalDebtAcquired
profitHeredado = previousLoan.pendingAmountStored * profitRatio

// Nuevo prestamo:
profitAmount = profitBase + profitHeredado
amountGived = requestedAmount - previousLoan.pendingAmountStored
```

**Ejemplo**: Renovacion con $1,200 pendientes (de prestamo 3000/40%/14sem)
- profitRatio = 1200 / 4200 = 0.2857
- profitHeredado = 1200 * 0.2857 = $342.86
- profitAmount = 1200 + 342.86 = $1,542.86
- amountGived = 3000 - 1200 = $1,800 (dinero fisico entregado)

### BR-LOAN-003: Estados del Prestamo
- **ACTIVE**: Prestamo vigente con deuda pendiente
- **FINISHED**: Prestamo pagado completamente o renovado
- **CANCELLED**: Prestamo cancelado (reversado)

### BR-LOAN-004: Fechas Importantes
- `signDate`: Fecha de firma/otorgamiento
- `finishedDate`: Cuando pendingAmount llega a 0 o se renueva
- `renewedDate`: Solo se establece en el prestamo ANTERIOR cuando se renueva
- `badDebtDate`: Cuando se marca como cartera vencida

### BR-LOAN-005: Cancelacion de Prestamo
```typescript
// Al cancelar:
1. Se revierten todos los AccountEntry asociados
2. Se eliminan los pagos
3. Si era renovacion: se reactiva el prestamo anterior
4. Se restaura el monto a la cuenta
```

### BR-LOAN-006: Primer Pago en Creacion Batch
- Al crear prestamos en batch, se puede incluir el primer pago
- El primer pago se asocia al LeadPaymentReceived del dia
- La comision del primer pago es separada de la comision de otorgamiento

## API GraphQL

### Queries
```graphql
# Obtener prestamo
loan(id: ID!): Loan

# Listar prestamos con filtros
loans(
  status: LoanStatus
  routeId: ID
  leadId: ID
  locationId: ID
  fromDate: DateTime
  toDate: DateTime
): [Loan!]!

# Prestamos para cartera vencida
loansForBadDebt(routeId: ID): [Loan!]!
```

### Mutations
```graphql
# Crear prestamos en batch (operacion principal)
createLoansInBatch(input: CreateLoansInBatchInput!): [Loan!]!

# Renovar prestamo
renewLoan(loanId: ID!, input: RenewLoanInput!): Loan!

# Cancelar prestamo
cancelLoanWithAccountRestore(loanId: ID!, accountId: ID!): CancelResult!

# Marcar como cartera vencida
markAsBadDebt(loanId: ID!, badDebtDate: DateTime!): Loan!

# Actualizar prestamo
updateLoanExtended(loanId: ID!, input: UpdateLoanExtendedInput!): Loan!
```

## LoanEngine (Portable)

El motor de prestamos esta en `@solufacil/business-logic` y es portable a Flutter:

```typescript
// Crear prestamo nuevo
const loan = LoanEngine.createLoan({
  requestedAmount: 3000,
  rate: 0.40,
  weekDuration: 14
})

// Crear renovacion
const renewal = LoanEngine.createLoan(
  { requestedAmount: 3000, rate: 0.40, weekDuration: 14 },
  { pendingAmountStored: 1200, profitAmount: 1200, totalDebtAcquired: 4200 }
)

// Cancelar prestamo
const cancel = LoanEngine.cancelLoan({
  amountGived: 3000,
  comissionAmount: 50,
  signDate: '2024-01-15',
  payments: [...]
})
```

## Flujos Principales

### Creacion de Prestamos (Batch)
```
1. Validar cuenta origen tiene fondos suficientes
2. Para cada prestamo:
   a. Obtener/crear borrower y collaterals
   b. Calcular metricas con LoanEngine
   c. Si es renovacion: procesar profit heredado
   d. Crear Loan
   e. Crear AccountEntry DEBIT (otorgamiento)
   f. Si hay primer pago: crear Payment y AccountEntry CREDIT
3. Crear/actualizar LeadPaymentReceived para primeros pagos
4. Retornar prestamos creados
```

### Cancelacion
```
1. Obtener prestamo con pagos
2. Eliminar AccountEntry de pagos
3. Actualizar LeadPaymentReceived
4. Eliminar pagos
5. Eliminar AccountEntry del prestamo
6. Si es renovacion: reactivar prestamo anterior
7. Eliminar prestamo
```

## Metricas de Prestamo

```typescript
interface LoanMetrics {
  requestedAmount: Decimal   // Monto solicitado
  amountGived: Decimal       // Monto entregado fisicamente
  profitBase: Decimal        // Ganancia base (sin heredada)
  profitHeredado: Decimal    // Ganancia heredada de renovacion
  profitAmount: Decimal      // Ganancia total
  totalDebtAcquired: Decimal // Deuda total
  pendingAmountStored: Decimal // Deuda pendiente
  expectedWeeklyPayment: Decimal // Pago semanal esperado
}
```

## Precision Financiera

- **SIEMPRE** usar `Decimal.js` para calculos
- **NUNCA** usar `number` de JavaScript para dinero
- Todas las funciones en business-logic usan Decimal
- Los resultados se redondean a 2 decimales

---

**Ultima actualizacion**: 2024
