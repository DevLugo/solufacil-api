# Payments Module - Pagos

## Descripcion General

Modulo que maneja los pagos de prestamos, su distribucion entre cuentas (efectivo/banco), comisiones y la logica de abonos (LeadPaymentReceived).

## Archivos Principales

| Archivo | Descripcion |
|---------|-------------|
| `src/services/PaymentService.ts` | Logica de pagos y abonos |
| `src/repositories/PaymentRepository.ts` | Acceso a datos de pagos |
| `src/resolvers/payments.ts` | Resolvers GraphQL |
| `packages/business-logic/src/calculations/payment.ts` | Calculos de distribucion |
| `docs/payment-distribution-logic.md` | Documentacion detallada de distribucion |

## Modelo de Datos

### LoanPayment
```prisma
model LoanPayment {
  id            String        @id
  amount        Decimal       // Monto del pago
  comission     Decimal       // Comision del pago
  receivedAt    DateTime      // Fecha de recepcion
  paymentMethod PaymentMethod // CASH o MONEY_TRANSFER
  type          String        // PAYMENT

  loan String                 // Prestamo asociado
  leadPaymentReceived String? // Abono del dia asociado
}

enum PaymentMethod {
  CASH           // Pago en efectivo
  MONEY_TRANSFER // Transferencia bancaria
}
```

### LeadPaymentReceived (Abono)
```prisma
model LeadPaymentReceived {
  id             String  @id
  expectedAmount Decimal // Monto esperado a cobrar
  paidAmount     Decimal // Monto realmente cobrado
  cashPaidAmount Decimal // Distribucion final en efectivo
  bankPaidAmount Decimal // Distribucion final en banco
  falcoAmount    Decimal // Faltante (perdida)
  paymentStatus  String  // COMPLETE o PARTIAL

  lead  String  // Lead responsable
  agent String  // Agente que registro

  payments LoanPayment[] // Pagos individuales del abono
  falcoCompensatoryPayments FalcoCompensatoryPayment[]
}
```

## Business Rules (CRITICAS)

### BR-PAY-001: Distribucion de Pago (Profit vs Capital)
```typescript
// Cada pago se distribuye proporcionalmente entre ganancia y capital:
profitRatio = loan.profitAmount / loan.totalDebtAcquired
paymentProfit = payment.amount * profitRatio
paymentCapital = payment.amount - paymentProfit
```

**Ejemplo**: Pago de $300 en prestamo de $3,000 al 40%
- profitRatio = 1200 / 4200 = 0.2857
- paymentProfit = 300 * 0.2857 = $85.71
- paymentCapital = 300 - 85.71 = $214.29

### BR-PAY-002: Cartera Vencida (Bad Debt)
- Si el prestamo esta marcado como `badDebt`:
- **100% del pago va a profit** (incentiva cobranza)
- No se aplica el ratio normal

### BR-PAY-003: Distribucion Cash/Bank
```
Total Paid = Sum de todos los pagos
cashPaidAmount = (pagos CASH) - cashToBank
bankPaidAmount = (pagos MONEY_TRANSFER) + cashToBank
```

- `cashToBank` = Efectivo que el lead deposita al banco

### BR-PAY-004: Calculo de cashToBank desde Valores Almacenados
```typescript
// Los valores almacenados ya tienen cashToBank "horneado"
moneyTransferSum = Sum de pagos MONEY_TRANSFER
cashToBank = bankPaidAmount - moneyTransferSum
```

### BR-PAY-005: Metricas del Prestamo
- `pendingAmountStored` se recalcula desde la suma de pagos
- `totalPaid` = SUM(payment.amount) del prestamo
- Si `pendingAmountStored <= 0`: status = FINISHED

### BR-PAY-006: Falco (Faltante)
- Representa dinero faltante del lead
- Se registra como DEBIT con sourceType FALCO_LOSS
- Puede compensarse posteriormente con FalcoCompensatoryPayment

### BR-PAY-007: Comisiones
- Cada pago puede tener una comision
- La comision por defecto viene de `loantype.loanPaymentComission`
- La comision se registra como DEBIT (gasto)

## API GraphQL

### Queries
```graphql
# Pagos por prestamo
paymentsByLoan(loanId: ID!): [LoanPayment!]!

# Abonos del lead
leadPaymentsReceived(
  leadId: ID
  fromDate: DateTime
  toDate: DateTime
): [LeadPaymentReceived!]!
```

### Mutations
```graphql
# Crear abono con pagos
createLeadPaymentReceived(input: CreateLeadPaymentReceivedInput!): LeadPaymentReceived!

# Actualizar abono (editar pagos/distribucion)
updateLeadPaymentReceived(id: ID!, input: UpdateLeadPaymentReceivedInput!): LeadPaymentReceived

# Crear compensacion de falco
createFalcoCompensatoryPayment(input: FalcoCompensatoryInput!): FalcoCompensatoryPayment!
```

## Flujos Principales

### Crear Abono (LeadPaymentReceived)
```
1. Obtener cuentas del agente (CASH y BANK)
2. Crear registro LeadPaymentReceived
3. Para cada pago:
   a. Calcular profit y capital (calculatePaymentProfit)
   b. Crear LoanPayment
   c. Crear AccountEntry CREDIT (segun paymentMethod)
   d. Crear AccountEntry DEBIT para comision
4. Registrar transferencia cash->bank si cashToBank > 0
5. Registrar falco si falcoAmount > 0
6. Actualizar metricas de cada prestamo
```

### Editar Distribucion
```
1. Calcular cashToBank actual desde valores almacenados
2. Obtener monto original de efectivo (antes de transferencia)
3. Usuario ingresa nuevo cashToBank
4. Validar que no exceda efectivo disponible
5. Recalcular: newCash = originalCash - newCashToBank
6. Actualizar AccountEntry correspondientes
```

### Eliminar Pago
```
1. Eliminar AccountEntry asociados
2. Eliminar LoanPayment
3. Recalcular metricas del prestamo desde pagos restantes
4. Si era el ultimo pago del abono: eliminar LeadPaymentReceived
```

## AccountEntry por Operacion

| Operacion | EntryType | SourceType |
|-----------|-----------|------------|
| Pago en efectivo | CREDIT | LOAN_PAYMENT_CASH |
| Pago transferencia | CREDIT | LOAN_PAYMENT_BANK |
| Comision de pago | DEBIT | PAYMENT_COMMISSION |
| Transfer cash->bank (origen) | DEBIT | TRANSFER_OUT |
| Transfer cash->bank (destino) | CREDIT | TRANSFER_IN |
| Falco registrado | DEBIT | FALCO_LOSS |
| Compensacion falco | CREDIT | FALCO_COMPENSATORY |

## Precision Financiera

- Todos los calculos usan `Decimal.js`
- El profit NUNCA puede exceder el monto del pago
- Los totales se recalculan desde la fuente de verdad (pagos)

## Documentacion Adicional

Ver `docs/payment-distribution-logic.md` para casos edge detallados:
- Editar solo distribucion (sin cambiar pagos)
- Cambiar metodo de pago (CASH <-> MONEY_TRANSFER)
- Eliminar pagos con transferencia existente
- Validaciones de limites

---

**Ultima actualizacion**: 2024
