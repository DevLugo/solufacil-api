# SQL Queries para Corregir Datos de Préstamos

Estas queries deben ejecutarse en producción para corregir inconsistencias en los datos de préstamos.

## Contexto

Se eliminó el status `RENOVATED` del enum `LoanStatus`. Ahora solo existen 3 estados:
- `ACTIVE` - Préstamo activo cobrando pagos
- `FINISHED` - Préstamo terminado (pagado o renovado)
- `CANCELLED` - Préstamo cancelado

El estado "renovado" ahora se determina por `renewedDate IS NOT NULL`.

---

## 1. Convertir status RENOVATED a FINISHED

```sql
UPDATE "Loan"
SET status = 'FINISHED'
WHERE status = 'RENOVATED';
```

---

## 2. Establecer finishedDate basado en el último pago

Para préstamos que fueron renovados o no tienen deuda pendiente pero les falta `finishedDate`:

```sql
UPDATE "Loan" l
SET "finishedDate" = (
  SELECT MAX(p."receivedAt")
  FROM "LoanPayment" p
  WHERE p.loan = l.id
)
WHERE l."finishedDate" IS NULL
  AND (
    -- Fue renovado (existe un préstamo que lo tiene como previousLoan)
    EXISTS (SELECT 1 FROM "Loan" r WHERE r."previousLoan" = l.id)
    -- O ya no tiene deuda pendiente
    OR l."pendingAmountStored" <= 0
  )
  AND EXISTS (SELECT 1 FROM "LoanPayment" p WHERE p.loan = l.id);
```

---

## 3. Establecer renewedDate para préstamos renovados

Para préstamos que fueron renovados pero no tienen `renewedDate`:

```sql
UPDATE "Loan" l
SET "renewedDate" = (
  SELECT r."signDate"
  FROM "Loan" r
  WHERE r."previousLoan" = l.id
  LIMIT 1
)
WHERE l."renewedDate" IS NULL
  AND EXISTS (SELECT 1 FROM "Loan" r WHERE r."previousLoan" = l.id);
```

---

## 4. Corregir status a FINISHED para préstamos terminados

Para préstamos que tienen `finishedDate` o `renewedDate` pero aún tienen `status = 'ACTIVE'`:

```sql
UPDATE "Loan"
SET status = 'FINISHED'
WHERE status = 'ACTIVE'
  AND ("finishedDate" IS NOT NULL OR "renewedDate" IS NOT NULL);
```

---

## 5. Corregir finishedDate usando fecha del último pago (no fecha de renovación)

Si `finishedDate` fue establecido incorrectamente como la fecha de renovación, corregirlo con la fecha del último pago:

```sql
UPDATE "Loan" l
SET "finishedDate" = (
  SELECT MAX(p."receivedAt")
  FROM "LoanPayment" p
  WHERE p.loan = l.id
)
WHERE l."finishedDate" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "LoanPayment" p WHERE p.loan = l.id);
```

---

## 6. Validar y corregir pendingAmountStored

Para asegurar que `pendingAmountStored` sea correcto basado en los pagos reales:

```sql
UPDATE "Loan" l
SET
  "totalPaid" = COALESCE(pagos.suma_pagos, 0),
  "pendingAmountStored" = GREATEST(0, l."totalDebtAcquired" - COALESCE(pagos.suma_pagos, 0))
FROM (
  SELECT loan, SUM(amount) as suma_pagos
  FROM "LoanPayment"
  GROUP BY loan
) pagos
WHERE pagos.loan = l.id
  AND l.status != 'CANCELLED'
  AND (
    l."totalPaid" != COALESCE(pagos.suma_pagos, 0)
    OR l."pendingAmountStored" != GREATEST(0, l."totalDebtAcquired" - COALESCE(pagos.suma_pagos, 0))
  );
```

---

## Queries de Verificación

### Ver préstamos con datos inconsistentes

```sql
-- Préstamos ACTIVE que deberían ser FINISHED
SELECT id, status, "finishedDate", "renewedDate", "pendingAmountStored"::numeric
FROM "Loan"
WHERE status = 'ACTIVE'
  AND ("finishedDate" IS NOT NULL OR "renewedDate" IS NOT NULL);

-- Préstamos renovados sin renewedDate
SELECT l.id, l.status, l."renewedDate"
FROM "Loan" l
WHERE l."renewedDate" IS NULL
  AND EXISTS (SELECT 1 FROM "Loan" r WHERE r."previousLoan" = l.id);

-- Préstamos con pendingAmount incorrecto
SELECT
  l.id,
  l."pendingAmountStored"::numeric as pending_actual,
  (l."totalDebtAcquired" - COALESCE(pagos.suma_pagos, 0))::numeric as pending_calculado
FROM "Loan" l
LEFT JOIN (
  SELECT loan, SUM(amount) as suma_pagos
  FROM "LoanPayment"
  GROUP BY loan
) pagos ON pagos.loan = l.id
WHERE l.status != 'CANCELLED'
  AND l."pendingAmountStored" != GREATEST(0, l."totalDebtAcquired" - COALESCE(pagos.suma_pagos, 0));
```

---

## Orden de Ejecución Recomendado

1. Query 1 - Convertir RENOVATED a FINISHED
2. Query 2 - Establecer finishedDate
3. Query 3 - Establecer renewedDate
4. Query 4 - Corregir status
5. Query 5 - Corregir finishedDate con último pago
6. Query 6 - Validar pendingAmountStored
7. Ejecutar queries de verificación para confirmar

---

## Notas Importantes

- **Backup**: Hacer backup de la tabla `Loan` antes de ejecutar
- **Transacción**: Ejecutar todas las queries dentro de una transacción
- **Ambiente**: Probar primero en staging/desarrollo antes de producción
