# Payment Distribution Logic - Abonos Tab

## Overview

The distribution system handles how payments are allocated between CASH and BANK accounts. There are two sources of bank deposits:

1. **MONEY_TRANSFER payments**: Payments where the client paid directly via bank transfer
2. **Leader Cash to Bank (cashToBank)**: Cash collected by the leader and deposited to the bank

## Key Formulas

```
Total Paid = Sum of all payment amounts
cashPaidAmount = (CASH payments) - cashToBank
bankPaidAmount = (MONEY_TRANSFER payments) + cashToBank
```

Where:
- `cashToBank` = Amount the leader transfers from collected cash to bank

## Stored Values

The `LeadPaymentReceived` record stores:
- `paidAmount`: Total of all payments
- `cashPaidAmount`: Final cash distribution (after leader transfer)
- `bankPaidAmount`: Final bank distribution (after leader transfer)

**Important**: These stored values already have the `cashToBank` "baked in".

## Calculating cashToBank from Stored Values

```
moneyTransferSum = Sum of payments where paymentMethod = 'MONEY_TRANSFER'
cashToBank = bankPaidAmount - moneyTransferSum
```

## Edge Cases

### 1. Editing Distribution Only (No Payment Changes)

**Scenario**: User wants to change how much cash the leader transfers to bank without modifying any payments.

**Flow**:
1. Open "Editar Distribución" modal
2. System calculates `originalCash = cashPaidAmount + cashToBank` (total cash before any transfer)
3. User enters new `cashToBank` value
4. New distribution: `cash = originalCash - newCashToBank`, `bank = moneyTransferSum + newCashToBank`

**Example**:
- Before: cash=8000, bank=1000, moneyTransferSum=300, cashToBank=700
- User changes cashToBank to 500
- After: cash=8200, bank=800

### 2. Changing Payment Method (CASH → MONEY_TRANSFER)

**Scenario**: User changes a payment's method from CASH to MONEY_TRANSFER.

**Effect**: This moves money from the cash pool to the bank pool.

**Flow**:
1. `cashDelta = -paymentAmount` (leaves cash pool)
2. `bankDelta = +paymentAmount` (enters bank pool)
3. Available cash for leader transfer decreases

**Example**:
- Before: CASH payments=8700, MONEY_TRANSFER=300, cashToBank=700
- User changes $300 payment to MONEY_TRANSFER
- After: CASH payments=8400, MONEY_TRANSFER=600
- Available for transfer: 8400 (was 8700)

### 3. Changing Payment Method + Distribution Together

**Scenario**: User both changes payment methods AND adjusts the leader transfer.

**Critical Issue**: The stored `cashPaidAmount` already has the OLD `cashToBank` subtracted. When calculating the new distribution, we must use the DELTA of cashToBank, not the absolute new value.

**Correct Calculation**:
```javascript
// Get old cashToBank from stored values
oldCashToBank = existingBankPaid - existingMoneyTransferSum

// Calculate raw cash (before any leader transfer)
rawCashAfterMethodChanges = existingCashPaid + oldCashToBank + cashDelta

// Calculate delta of leader transfer
cashToBankDelta = newCashToBank - oldCashToBank

// Apply delta to existing values
newCashPaid = existingCashPaid + cashDelta - cashToBankDelta
newBankPaid = existingBankPaid + bankDelta + cashToBankDelta
```

**Example**:
- Before: cash=8000, bank=1000, moneyTransferSum=300, cashToBank=700
- User changes $300 CASH→MONEY_TRANSFER (cashDelta=-300, bankDelta=+300)
- User wants newCashToBank=750 (was 700, so delta=+50)
- Calculation:
  - rawCash = 8000 + 700 + (-300) = 8400
  - newCash = 8000 + (-300) - 50 = 7650
  - newBank = 1000 + 300 + 50 = 1350
- After: cash=7650, bank=1350

### 4. Pre-loading Distribution When Editing Payments

**Scenario**: User clicks "Guardar Cambios" after editing payment methods.

**Requirement**: The modal should pre-load the EXISTING cashToBank value, not reset to 0.

**Flow**:
1. Calculate `existingCashToBank = existingBankPaid - existingMoneyTransferSum`
2. Pre-load this value in the transfer input
3. User can adjust if needed
4. Validation: newCashToBank cannot exceed rawCashAfterMethodChanges

### 5. Validation: Transfer Exceeds Available Cash

**Scenario**: After changing payment methods, the available cash decreases below the existing cashToBank.

**Behavior**:
1. Modal shows validation error: "El monto no puede ser mayor al efectivo real disponible"
2. Save button is disabled
3. User must manually reduce the transfer amount
4. System does NOT auto-cap the value (user sees their original value and decides)

**Safety Net**: If somehow save is triggered with invalid values, the backend auto-adjusts and shows a toast warning.

### 6. Deleting Payments

**Scenario**: User marks a payment as deleted.

**Frontend Effect**:
- `cashDelta` or `bankDelta` decreases by the deleted amount
- Total paid decreases
- Available cash for transfer may decrease

**Backend Handling** (Critical for balance correctness):

When payments are deleted, the backend automatically treats this as a distribution change, even if the frontend didn't explicitly send new distribution values. This ensures:

1. **TRANSFER adjustment is applied**: The existing `cashToBank` is factored into `oldCashChange`/`oldBankChange`
2. **TRANSFER transaction is cleaned up**: If all payments are deleted, the TRANSFER transaction is also deleted
3. **Balance reversal is correct**: Account balances are properly reversed including the TRANSFER effect

**Example - Deleting all payments with TRANSFER**:
- Before: cash=8000, bank=1000, CASH payments=8700, MONEY_TRANSFER=300, cashToBank=700
- When all payments deleted:
  - oldCashChange = 8700 - 700 = 8000 (includes TRANSFER adjustment)
  - oldBankChange = 300 + 700 = 1000 (includes TRANSFER adjustment)
  - newCashChange = 0, newBankChange = 0
  - netCashChange = 0 - 8000 = -8000 ✓
  - netBankChange = 0 - 1000 = -1000 ✓
  - TRANSFER transaction is deleted
  - LeadPaymentReceived is deleted

**Implementation Note**: The backend uses `hasAnyDeletion` flag to force `distributionChanged = true` when payments are being deleted, ensuring the TRANSFER logic always runs.

### 7. Commission-Only Changes

**Scenario**: User only changes commissions, not amounts or methods.

**Behavior**: Distribution modal is skipped entirely. Commissions don't affect cash/bank distribution.

## Balance Account Updates

When distribution changes, the system must also update account balances:

1. **CASH account**: Changes by `netCashChange`
2. **BANK account**: Changes by `netBankChange`
3. **TRANSFER transaction**: Created/Updated/Deleted based on `cashToBank`

The TRANSFER transaction represents the leader's deposit of collected cash to the bank.

## Summary: Data Flow

```
User Actions
    │
    ▼
┌─────────────────────┐
│ Edit Payments       │
│ (method, amount)    │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Calculate Deltas    │
│ cashDelta, bankDelta│
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Distribution Modal  │
│ (pre-load existing) │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Calculate New       │
│ Distribution        │
│ (using delta logic) │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Update Backend      │
│ - LeadPaymentRcvd   │
│ - Account Balances  │
│ - TRANSFER tx       │
└─────────────────────┘
```
