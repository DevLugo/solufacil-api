# LoanEngine - Flutter/Dart Conversion Guide

## Overview

This document explains how to convert the `LoanEngine` class to Flutter/Dart for use with PowerSync offline-first architecture.

## Core Business Rules

### 1. New Loan Creation
```
profitAmount = requestedAmount × rate
totalDebtAcquired = requestedAmount + profitAmount
amountGived = requestedAmount (full amount for new loans)
expectedWeeklyPayment = totalDebtAcquired / weekDuration
profitRatio = profitAmount / totalDebtAcquired
```

### 2. Loan Renewal
```
profitBase = requestedAmount × rate
profitRatio = previousLoan.profitAmount / previousLoan.totalDebtAcquired
profitHeredado = previousLoan.pendingAmountStored × profitRatio
profitAmount = profitBase + profitHeredado
totalDebtAcquired = requestedAmount + profitAmount
amountGived = requestedAmount - previousLoan.pendingAmountStored
```

**CRITICAL**: Only the PROFIT portion of pending debt is inherited, NOT the full pending debt!

### 3. Payment Processing & Distribution

Every payment is split proportionally between **profit** (ganancia) and **returnToCapital** (capital recuperado).

```
profitRatio = loanProfitAmount / loanTotalDebt
profitPortion = paymentAmount × profitRatio
returnToCapital = paymentAmount - profitPortion
newPendingAmount = currentPending - paymentAmount
```

**CRITICAL RULES**:
1. Profit can NEVER exceed the payment amount. If someone pays $100, the maximum profit is $100.
2. `profitPortion + returnToCapital` must ALWAYS equal `paymentAmount`
3. Both values must be stored in the Transaction table for accurate financial reporting

**Bad Debt Exception**: When `isBadDebt = true`, 100% goes to profit, 0% to returnToCapital.

---

## Payment Distribution Examples

### Example 1: Standard Loan Payment

```
Loan Details:
├── profitAmount: $1,200
├── totalDebtAcquired: $4,200
└── profitRatio: 1200/4200 = 0.2857 (28.57%)

Payment: $300

Distribution:
├── profitPortion: $300 × 0.2857 = $85.71
└── returnToCapital: $300 - $85.71 = $214.29

Transaction Record:
├── amount: $300
├── profitAmount: $85.71
├── returnToCapital: $214.29
└── type: INCOME
```

### Example 2: Multiple Payments Tracking

```
Original Loan: $3,000 at 40%, 14 weeks
├── profitAmount: $1,200
├── totalDebtAcquired: $4,200
└── expectedWeeklyPayment: $300

After 10 Payments ($300 each):
├── Total Paid: $3,000
├── Total Profit Collected: 10 × $85.71 = $857.10
├── Total Capital Recovered: 10 × $214.29 = $2,142.90
├── Remaining Debt: $4,200 - $3,000 = $1,200
├── Remaining Profit: $1,200 - $857.10 = $342.90
└── Remaining Capital: $3,000 - $2,142.90 = $857.10
```

### Example 3: Bad Debt Payment

```
Loan marked as BAD_DEBT (badDebtDate is set)

Payment: $500

Distribution:
├── profitPortion: $500 (100%)
└── returnToCapital: $0 (0%)

Rationale: Capital is considered lost, any recovery is pure profit.
```

### Example 4: Corrupt Data Protection

```
Edge case: profitAmount > totalDebtAcquired (should never happen)

Loan Details:
├── profitAmount: $5,000 (corrupt!)
├── totalDebtAcquired: $4,000
└── Calculated ratio: 5000/4000 = 1.25 (125%!)

Payment: $100

Without protection: profitPortion = $100 × 1.25 = $125 ❌ (more than payment!)

With protection:
├── profitPortion: $100 (capped at payment amount)
└── returnToCapital: $0

This prevents financial inconsistencies in reports.
```

---

## Database Tables

### Loan Table
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| requestedAmount | Decimal | Amount client requested |
| amountGived | Decimal | Physical money given |
| profitAmount | Decimal | Total profit (base + inherited) |
| totalDebtAcquired | Decimal | Total debt |
| pendingAmountStored | Decimal | Remaining debt |
| expectedWeeklyPayment | Decimal | Weekly payment |
| status | Enum | ACTIVE, FINISHED, RENOVATED, BAD_DEBT |
| previousLoan | UUID? | FK to previous loan (renewals) |
| badDebtDate | DateTime? | When marked as bad debt |

### Payment Table
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| amount | Decimal | Payment amount |
| profitAmount | Decimal | Portion to profit |
| returnToCapital | Decimal | Portion to capital |
| loanId | UUID | FK to Loan |

### Transaction Table
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| amount | Decimal | Transaction amount |
| type | Enum | INCOME, EXPENSE, TRANSFER |
| **profitAmount** | Decimal? | **Portion of payment that is profit (ganancia)** |
| **returnToCapital** | Decimal? | **Portion of payment that returns capital** |
| sourceAccountId | UUID? | Source account |
| destinationAccountId | UUID? | Destination account |
| paymentId | UUID? | FK to Payment (for loan payments) |
| loanId | UUID? | FK to Loan (for loan disbursements) |

**Important**: For loan payment transactions:
- `profitAmount + returnToCapital = amount`
- These fields enable financial reports (profit by period, capital recovery, etc.)

### Account Table
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| balance | Decimal | Current balance |

---

## Dart Class Template

```dart
import 'package:decimal/decimal.dart';

/// Result of creating a new loan
class LoanResult {
  final Decimal requestedAmount;
  final Decimal amountGived;
  final Decimal profitBase;
  final Decimal profitHeredado;
  final Decimal profitAmount;
  final Decimal returnToCapital;
  final Decimal totalDebtAcquired;
  final Decimal pendingAmountStored;
  final Decimal expectedWeeklyPayment;
  final double profitRatio;

  LoanResult({
    required this.requestedAmount,
    required this.amountGived,
    required this.profitBase,
    required this.profitHeredado,
    required this.profitAmount,
    required this.returnToCapital,
    required this.totalDebtAcquired,
    required this.pendingAmountStored,
    required this.expectedWeeklyPayment,
    required this.profitRatio,
  });
}

/// Result of processing a payment
class PaymentResult {
  final Decimal amount;
  final Decimal profitAmount;
  final Decimal returnToCapital;
  final Decimal newPendingAmount;
  final bool isFullyPaid;

  PaymentResult({
    required this.amount,
    required this.profitAmount,
    required this.returnToCapital,
    required this.newPendingAmount,
    required this.isFullyPaid,
  });
}

/// Previous loan data for renewals
class PreviousLoanData {
  final Decimal pendingAmountStored;
  final Decimal profitAmount;
  final Decimal totalDebtAcquired;

  PreviousLoanData({
    required this.pendingAmountStored,
    required this.profitAmount,
    required this.totalDebtAcquired,
  });
}

/// LoanEngine - Centralized business logic for loans
class LoanEngine {
  /// Create a new loan or renewal
  static LoanResult createLoan({
    required Decimal requestedAmount,
    required Decimal rate,
    required int weekDuration,
    PreviousLoanData? previousLoan,
  }) {
    // Step 1: Calculate base profit
    final profitBase = (requestedAmount * rate).round(scale: 2);

    // Step 2: Calculate inherited profit (only for renewals)
    Decimal profitHeredado = Decimal.zero;
    Decimal pendingDebt = Decimal.zero;

    if (previousLoan != null) {
      final prevPending = previousLoan.pendingAmountStored;
      final prevProfit = previousLoan.profitAmount;
      final prevTotalDebt = previousLoan.totalDebtAcquired;

      // Calculate profit ratio
      final profitRatio = prevTotalDebt == Decimal.zero
          ? Decimal.zero
          : prevProfit / prevTotalDebt;

      // Inherited profit = pending debt × profit ratio
      profitHeredado = (prevPending * profitRatio).round(scale: 2);
      pendingDebt = prevPending;
    }

    // Step 3: Calculate totals
    final profitAmount = (profitBase + profitHeredado).round(scale: 2);
    final returnToCapital = requestedAmount;
    final totalDebtAcquired = (returnToCapital + profitAmount).round(scale: 2);

    // Step 4: Calculate amount to give
    Decimal amountGived = requestedAmount - pendingDebt;
    if (amountGived < Decimal.zero) {
      amountGived = Decimal.zero;
    }

    // Step 5: Calculate weekly payment
    final expectedWeeklyPayment = (totalDebtAcquired / Decimal.fromInt(weekDuration)).round(scale: 2);

    // Step 6: Calculate profit ratio
    final profitRatioNum = totalDebtAcquired == Decimal.zero
        ? 0.0
        : (profitAmount / totalDebtAcquired).toDouble();

    return LoanResult(
      requestedAmount: requestedAmount,
      amountGived: amountGived.round(scale: 2),
      profitBase: profitBase,
      profitHeredado: profitHeredado,
      profitAmount: profitAmount,
      returnToCapital: returnToCapital,
      totalDebtAcquired: totalDebtAcquired,
      pendingAmountStored: totalDebtAcquired,
      expectedWeeklyPayment: expectedWeeklyPayment,
      profitRatio: profitRatioNum,
    );
  }

  /// Process a payment on a loan
  static PaymentResult processPayment({
    required Decimal amount,
    required Decimal loanProfitAmount,
    required Decimal loanTotalDebt,
    required Decimal loanPendingAmount,
    bool isBadDebt = false,
  }) {
    Decimal profitAmount;
    Decimal returnToCapital;

    // Bad debt: 100% goes to profit
    if (isBadDebt) {
      profitAmount = amount;
      returnToCapital = Decimal.zero;
    } else if (loanTotalDebt == Decimal.zero) {
      profitAmount = Decimal.zero;
      returnToCapital = amount;
    } else {
      // Normal: proportional distribution
      profitAmount = ((amount * loanProfitAmount) / loanTotalDebt).round(scale: 2);

      // CRITICAL: profit can NEVER exceed the payment amount
      if (profitAmount > amount) {
        profitAmount = amount;
      }

      returnToCapital = (amount - profitAmount).round(scale: 2);
    }

    // Calculate new pending amount
    Decimal newPendingAmount = loanPendingAmount - amount;
    if (newPendingAmount < Decimal.zero) {
      newPendingAmount = Decimal.zero;
    }

    return PaymentResult(
      amount: amount,
      profitAmount: profitAmount,
      returnToCapital: returnToCapital,
      newPendingAmount: newPendingAmount.round(scale: 2),
      isFullyPaid: newPendingAmount <= Decimal.parse('0.01'),
    );
  }
}
```

---

## PowerSync Considerations

### Sync Strategy
1. **Loan Creation**: Create locally, sync when online
2. **Payments**: Create locally, update loan.pendingAmountStored locally
3. **Renewals**: Create new loan locally, update old loan status to RENOVATED

### Payment Processing Flow (Offline-First)

When processing a payment in Flutter/PowerSync, follow this sequence:

```dart
/// Process payment offline-first
Future<void> processPaymentOffline({
  required String loanId,
  required Decimal paymentAmount,
  required String accountId,
}) async {
  // 1. Get loan from local PowerSync database
  final loan = await db.get('SELECT * FROM loans WHERE id = ?', [loanId]);

  // 2. Calculate distribution using LoanEngine (pure function)
  final result = LoanEngine.processPayment(
    amount: paymentAmount,
    loanProfitAmount: Decimal.parse(loan['profitAmount']),
    loanTotalDebt: Decimal.parse(loan['totalDebtAcquired']),
    loanPendingAmount: Decimal.parse(loan['pendingAmountStored']),
    isBadDebt: loan['badDebtDate'] != null,
  );

  // 3. Create Payment record
  final paymentId = uuid.v4();
  await db.execute('''
    INSERT INTO payments (id, amount, profitAmount, returnToCapital, loanId, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
  ''', [paymentId, paymentAmount, result.profitAmount, result.returnToCapital, loanId, DateTime.now()]);

  // 4. Create Transaction record with profit distribution
  await db.execute('''
    INSERT INTO transactions (id, amount, type, profitAmount, returnToCapital, destinationAccountId, paymentId, createdAt)
    VALUES (?, ?, 'INCOME', ?, ?, ?, ?, ?)
  ''', [uuid.v4(), paymentAmount, result.profitAmount, result.returnToCapital, accountId, paymentId, DateTime.now()]);

  // 5. Update Loan pendingAmountStored
  await db.execute('''
    UPDATE loans SET pendingAmountStored = ?, status = ? WHERE id = ?
  ''', [result.newPendingAmount, result.isFullyPaid ? 'FINISHED' : 'ACTIVE', loanId]);

  // 6. Update Account balance
  await db.execute('''
    UPDATE accounts SET balance = balance + ? WHERE id = ?
  ''', [paymentAmount, accountId]);

  // PowerSync will automatically sync these changes when online
}
```

### Conflict Resolution
- Use last-write-wins for most fields
- For `pendingAmountStored`, sum all payments and recalculate
- Never modify `profitAmount` or `totalDebtAcquired` after creation
- **Critical**: `profitAmount` and `returnToCapital` in transactions are immutable once created

### Offline Operations
All calculations in `LoanEngine` are pure functions with no external dependencies, making them perfect for offline-first architecture.

### Financial Report Queries (PowerSync)

```dart
/// Get total profit collected in a date range
Future<Decimal> getTotalProfitByPeriod(DateTime start, DateTime end) async {
  final result = await db.get('''
    SELECT COALESCE(SUM(profitAmount), 0) as totalProfit
    FROM transactions
    WHERE type = 'INCOME'
      AND createdAt >= ?
      AND createdAt <= ?
  ''', [start.toIso8601String(), end.toIso8601String()]);

  return Decimal.parse(result['totalProfit'].toString());
}

/// Get total capital recovered in a date range
Future<Decimal> getTotalCapitalRecovered(DateTime start, DateTime end) async {
  final result = await db.get('''
    SELECT COALESCE(SUM(returnToCapital), 0) as totalCapital
    FROM transactions
    WHERE type = 'INCOME'
      AND createdAt >= ?
      AND createdAt <= ?
  ''', [start.toIso8601String(), end.toIso8601String()]);

  return Decimal.parse(result['totalCapital'].toString());
}

/// Get profit breakdown by loan
Future<List<Map>> getProfitByLoan() async {
  return await db.getAll('''
    SELECT
      l.id,
      l.profitAmount as expectedProfit,
      COALESCE(SUM(t.profitAmount), 0) as collectedProfit,
      l.profitAmount - COALESCE(SUM(t.profitAmount), 0) as pendingProfit
    FROM loans l
    LEFT JOIN payments p ON p.loanId = l.id
    LEFT JOIN transactions t ON t.paymentId = p.id
    GROUP BY l.id
  ''');
}
```

---

## Test Cases to Implement

### Loan Creation Tests
1. **New Loan**: $3,000 at 40%, 14 weeks → profit $1,200, debt $4,200
2. **Renewal with 10 payments**: pending $1,200 → profitHeredado $342.86
3. **Renewal with 0 payments**: pending $4,200 → profitHeredado $1,200 (full)

### Payment Distribution Tests
4. **Standard payment**: $300 on $4,200 debt with $1,200 profit → profit $85.71, capital $214.29
5. **Bad debt payment**: 100% to profit, 0% to capital
6. **Full payment**: $4,200 → profit $1,200, capital $3,000, marks FINISHED
7. **Corrupt data protection**: profit > totalDebt → profit capped at payment amount
8. **Zero debt edge case**: payment goes 100% to capital

### Transaction Storage Tests
9. **Payment creates transaction**: profitAmount + returnToCapital = amount
10. **Transaction immutability**: profit/capital values never change after creation

### Financial Report Tests
11. **Profit by period**: SUM(profitAmount) for date range
12. **Capital recovered**: SUM(returnToCapital) for date range
13. **Pending profit**: loan.profitAmount - SUM(collected profitAmount)

### Full Flow Integration Tests
14. **10 payments + renewal**: verify profitHeredado matches remaining uncollected profit
15. **Bulk payment vs individual**: same total should produce same distribution
16. **Double renewal**: profit inheritance chains correctly
