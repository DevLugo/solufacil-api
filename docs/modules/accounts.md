# Accounts Module - Cuentas y Transacciones (Ledger)

## Descripcion General

Modulo de contabilidad basado en ledger (libro mayor). Todas las operaciones financieras se registran como AccountEntry, y el balance se deriva de la suma de entradas.

## Archivos Principales

| Archivo | Descripcion |
|---------|-------------|
| `src/services/BalanceService.ts` | **Servicio centralizado de ledger** |
| `src/services/AccountService.ts` | CRUD de cuentas |
| `src/services/TransactionService.ts` | Consultas de movimientos |
| `src/repositories/AccountRepository.ts` | Acceso a datos |
| `src/resolvers/accounts.ts` | Resolvers GraphQL |
| `src/resolvers/transactions.ts` | Resolvers de movimientos |

## Modelo de Datos

### Account
```prisma
model Account {
  id     String      @id
  name   String      // Nombre de la cuenta
  type   AccountType // Tipo de cuenta
  amount Decimal     // Balance materializado (cache)

  routes Route[]     // Rutas asociadas
  entries AccountEntry[] // Entradas del ledger
}

enum AccountType {
  BANK               // Cuenta bancaria
  OFFICE_CASH_FUND   // Caja de oficina
  EMPLOYEE_CASH_FUND // Fondo de empleado/lead
  PREPAID_GAS        // Prepago gasolina
  TRAVEL_EXPENSES    // Gastos de viaje
}
```

### AccountEntry (Ledger)
```prisma
model AccountEntry {
  id String @id

  accountId  String
  amount     Decimal         // Siempre positivo
  entryType  AccountEntryType // DEBIT o CREDIT
  sourceType SourceType      // Origen de la operacion

  profitAmount    Decimal?  // Para pagos: porcion de ganancia
  returnToCapital Decimal?  // Para pagos: porcion de capital

  snapshotLeadId  String    // Lead al momento del registro
  snapshotRouteId String    // Ruta al momento del registro

  entryDate DateTime        // Fecha de la operacion
  description String

  // Referencias opcionales
  loanId String?
  loanPaymentId String?
  leadPaymentReceivedId String?
  destinationAccountId String? // Para transferencias
}

enum AccountEntryType {
  DEBIT  // Dinero SALE (efecto negativo)
  CREDIT // Dinero ENTRA (efecto positivo)
}
```

## Business Rules (CRITICAS)

### BR-ACC-001: Balance = Ledger
```
Balance = SUM(CREDIT) - SUM(DEBIT)
```

- El balance SIEMPRE se deriva de las entradas del ledger
- `Account.amount` es un cache materializado
- Puede reconciliarse en cualquier momento

### BR-ACC-002: Solo BalanceService Modifica Balances
- **NUNCA** modificar `Account.amount` directamente
- **SIEMPRE** usar `BalanceService.createEntry()`
- El servicio crea la entrada Y actualiza el cache atomicamente

### BR-ACC-003: Entradas Siempre Positivas
```typescript
// El amount SIEMPRE es positivo
// El signo lo determina entryType:
CREDIT = +amount (entra dinero)
DEBIT  = -amount (sale dinero)
```

### BR-ACC-004: Transferencias Balanceadas
```typescript
// Una transferencia crea DOS entradas:
DEBIT  en cuenta origen  (TRANSFER_OUT)
CREDIT en cuenta destino (TRANSFER_IN)

// El balance neto es 0
```

### BR-ACC-005: Reversiones vs Eliminaciones
- **Operaciones normales**: Crear entrada opuesta (reverseEntry)
- **Cancelaciones**: Eliminar entradas (deleteEntries*)
- Las eliminaciones actualizan el balance cache automaticamente

## SourceType (Tipos de Operacion)

### Operaciones de Prestamos
| SourceType | Tipo | Descripcion |
|------------|------|-------------|
| LOAN_GRANT | DEBIT | Otorgamiento de prestamo |
| LOAN_GRANT_COMMISSION | DEBIT | Comision de otorgamiento |
| LOAN_CANCELLED_RESTORE | CREDIT | Restauracion por cancelacion |

### Operaciones de Pagos
| SourceType | Tipo | Descripcion |
|------------|------|-------------|
| LOAN_PAYMENT_CASH | CREDIT | Pago en efectivo |
| LOAN_PAYMENT_BANK | CREDIT | Pago por transferencia |
| PAYMENT_COMMISSION | DEBIT | Comision de pago |

### Transferencias
| SourceType | Tipo | Descripcion |
|------------|------|-------------|
| TRANSFER_OUT | DEBIT | Salida por transferencia |
| TRANSFER_IN | CREDIT | Entrada por transferencia |

### Gastos Operativos
| SourceType | Tipo | Descripcion |
|------------|------|-------------|
| GASOLINE | DEBIT | Gasolina |
| NOMINA_SALARY | DEBIT | Nomina/salarios |
| VIATIC | DEBIT | Viaticos |
| EMPLOYEE_EXPENSE | DEBIT | Gastos de empleado |
| GENERAL_EXPENSE | DEBIT | Gastos generales |

### Especiales
| SourceType | Tipo | Descripcion |
|------------|------|-------------|
| FALCO_LOSS | DEBIT | Perdida por falco |
| FALCO_COMPENSATORY | CREDIT | Compensacion de falco |
| BALANCE_ADJUSTMENT | VAR | Ajuste de reconciliacion |
| INITIAL_BALANCE | CREDIT | Balance inicial |

## API de BalanceService

```typescript
// Crear entrada y actualizar balance
await balanceService.createEntry({
  accountId: 'acc_123',
  entryType: 'CREDIT',
  amount: new Decimal(100),
  sourceType: 'LOAN_PAYMENT_CASH',
  loanPaymentId: 'pay_456',
  snapshotLeadId: 'lead_789',
  snapshotRouteId: 'route_abc',
}, tx)

// Crear transferencia (par de entradas)
await balanceService.createTransfer({
  sourceAccountId: 'cash_acc',
  destinationAccountId: 'bank_acc',
  amount: new Decimal(1000),
  description: 'Deposito a banco',
}, tx)

// Revertir entrada (crea entrada opuesta)
await balanceService.reverseEntry(entryId, {
  description: 'Correccion de error',
})

// Eliminar entradas por pago (para cancelaciones)
await balanceService.deleteEntriesByLoanPayment(paymentId, tx)

// Reconciliar cuenta (verificar consistencia)
const result = await balanceService.reconcileAccount(accountId)
// result: { storedBalance, calculatedBalance, difference, isConsistent }
```

## Flujos Principales

### Reconciliacion
```
1. Obtener balance almacenado (Account.amount)
2. Calcular balance desde entradas (SUM CREDIT - SUM DEBIT)
3. Comparar diferencia
4. Si hay diferencia: opcion de crear BALANCE_ADJUSTMENT
```

### Reporte de Movimientos
```
1. Filtrar entradas por cuenta, fecha, sourceType
2. Agrupar por tipo de operacion
3. Calcular totales por categoria
4. Generar resumen (ingresos, gastos, transferencias)
```

## Snapshots Historicos

Cada AccountEntry guarda:
- `snapshotLeadId`: Lead responsable al momento
- `snapshotRouteId`: Ruta asociada al momento

Esto permite:
- Reportes historicos correctos aunque el lead/ruta cambie
- Rastreo de operaciones por periodo

## Consideraciones de Arquitectura

### Preparacion para Flutter/PowerSync
- La logica de balance esta encapsulada
- Las operaciones son atomicas y reversibles
- El modelo permite sincronizacion offline

### Auditoria
- Cada entrada tiene timestamp de creacion
- Las eliminaciones son rastreables
- Los ajustes quedan registrados con descripcion

---

**Ultima actualizacion**: 2024
