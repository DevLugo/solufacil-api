-- ============================================================
-- SCRIPT DE INTEGRIDAD DE PRÉSTAMOS
-- Detecta y corrige inconsistencias en Loan basándose en LoanPayment
-- ============================================================

-- ============================================================
-- PARTE 1: QUERIES DE DIAGNÓSTICO (ejecutar primero para ver problemas)
-- ============================================================

-- 1.1 Préstamos con totalPaid incorrecto
SELECT
  l.id,
  l.status,
  l."totalPaid" AS stored_total_paid,
  COALESCE(p.actual_total_paid, 0) AS actual_total_paid,
  l."totalPaid" - COALESCE(p.actual_total_paid, 0) AS difference,
  l."totalDebtAcquired",
  l."pendingAmountStored"
FROM "Loan" l
LEFT JOIN (
  SELECT loan, SUM(amount) AS actual_total_paid
  FROM "LoanPayment"
  GROUP BY loan
) p ON p.loan = l.id
WHERE l."totalPaid" != COALESCE(p.actual_total_paid, 0)
ORDER BY ABS(l."totalPaid" - COALESCE(p.actual_total_paid, 0)) DESC;

-- 1.2 Préstamos con pendingAmountStored incorrecto
SELECT
  l.id,
  l.status,
  l."totalDebtAcquired",
  l."totalPaid",
  l."pendingAmountStored" AS stored_pending,
  (l."totalDebtAcquired" - l."totalPaid") AS calculated_pending,
  l."pendingAmountStored" - (l."totalDebtAcquired" - l."totalPaid") AS difference
FROM "Loan" l
WHERE l."pendingAmountStored" != (l."totalDebtAcquired" - l."totalPaid")
ORDER BY ABS(l."pendingAmountStored" - (l."totalDebtAcquired" - l."totalPaid")) DESC;

-- 1.3 Préstamos con comissionAmount incorrecto
SELECT
  l.id,
  l.status,
  l."comissionAmount" AS stored_comission,
  COALESCE(p.actual_comission, 0) AS actual_comission,
  l."comissionAmount" - COALESCE(p.actual_comission, 0) AS difference
FROM "Loan" l
LEFT JOIN (
  SELECT loan, SUM(comission) AS actual_comission
  FROM "LoanPayment"
  GROUP BY loan
) p ON p.loan = l.id
WHERE l."comissionAmount" != COALESCE(p.actual_comission, 0)
ORDER BY ABS(l."comissionAmount" - COALESCE(p.actual_comission, 0)) DESC;

-- 1.4 Préstamos ACTIVE que deberían ser FINISHED (pagados completamente, sin renovar)
SELECT
  l.id,
  l.status,
  l."totalDebtAcquired",
  l."totalPaid",
  l."pendingAmountStored",
  l."renewedDate",
  l."finishedDate"
FROM "Loan" l
WHERE l.status = 'ACTIVE'
  AND l."totalPaid" >= l."totalDebtAcquired"
  AND l."renewedDate" IS NULL;

-- 1.5 Préstamos FINISHED que NO están pagados completamente
SELECT
  l.id,
  l.status,
  l."totalDebtAcquired",
  l."totalPaid",
  l."pendingAmountStored",
  l."renewedDate"
FROM "Loan" l
WHERE l.status = 'FINISHED'
  AND l."totalPaid" < l."totalDebtAcquired"
  AND l."renewedDate" IS NULL;

-- 1.6 Préstamos pagados sin finishedDate o con finishedDate incorrecto
SELECT
  l.id,
  l.status,
  l."totalPaid",
  l."totalDebtAcquired",
  l."finishedDate" AS current_finished,
  last_payment."receivedAt" AS last_payment_date,
  CASE
    WHEN l."finishedDate" IS NULL THEN 'MISSING'
    WHEN l."finishedDate"::date != last_payment."receivedAt"::date THEN 'WRONG_DATE'
    ELSE 'OK'
  END AS issue
FROM "Loan" l
INNER JOIN (
  SELECT loan, MAX("receivedAt") AS "receivedAt"
  FROM "LoanPayment"
  GROUP BY loan
) last_payment ON last_payment.loan = l.id
WHERE l."totalPaid" >= l."totalDebtAcquired"
  AND (
    l."finishedDate" IS NULL
    OR l."finishedDate"::date != last_payment."receivedAt"::date
  )
ORDER BY last_payment."receivedAt" DESC;

-- 1.7 Resumen de problemas encontrados
SELECT
  'totalPaid incorrecto' AS issue,
  COUNT(*) AS count
FROM "Loan" l
LEFT JOIN (SELECT loan, SUM(amount) AS total FROM "LoanPayment" GROUP BY loan) p ON p.loan = l.id
WHERE l."totalPaid" != COALESCE(p.total, 0)

UNION ALL

SELECT
  'pendingAmountStored incorrecto' AS issue,
  COUNT(*) AS count
FROM "Loan" l
WHERE l."pendingAmountStored" != (l."totalDebtAcquired" - l."totalPaid")

UNION ALL

SELECT
  'comissionAmount incorrecto' AS issue,
  COUNT(*) AS count
FROM "Loan" l
LEFT JOIN (SELECT loan, SUM(comission) AS total FROM "LoanPayment" GROUP BY loan) p ON p.loan = l.id
WHERE l."comissionAmount" != COALESCE(p.total, 0)

UNION ALL

SELECT
  'ACTIVE debería ser FINISHED' AS issue,
  COUNT(*) AS count
FROM "Loan" l
WHERE l.status = 'ACTIVE' AND l."totalPaid" >= l."totalDebtAcquired" AND l."renewedDate" IS NULL

UNION ALL

SELECT
  'FINISHED sin pagar completamente' AS issue,
  COUNT(*) AS count
FROM "Loan" l
WHERE l.status = 'FINISHED' AND l."totalPaid" < l."totalDebtAcquired" AND l."renewedDate" IS NULL

UNION ALL

SELECT
  'finishedDate incorrecto' AS issue,
  COUNT(*) AS count
FROM "Loan" l
INNER JOIN (SELECT loan, MAX("receivedAt") AS "receivedAt" FROM "LoanPayment" GROUP BY loan) lp ON lp.loan = l.id
WHERE l."totalPaid" >= l."totalDebtAcquired"
  AND (l."finishedDate" IS NULL OR l."finishedDate"::date != lp."receivedAt"::date);


-- ============================================================
-- PARTE 2: QUERIES DE CORRECCIÓN (ejecutar después de revisar diagnóstico)
-- ============================================================

-- 2.1 Corregir totalPaid basándose en LoanPayment
UPDATE "Loan" l
SET "totalPaid" = COALESCE(payments.total, 0),
    "updatedAt" = NOW()
FROM (
  SELECT loan, SUM(amount) AS total
  FROM "LoanPayment"
  GROUP BY loan
) payments
WHERE payments.loan = l.id
  AND l."totalPaid" != payments.total;

-- Para préstamos sin pagos (totalPaid debería ser 0)
UPDATE "Loan" l
SET "totalPaid" = 0,
    "updatedAt" = NOW()
WHERE NOT EXISTS (SELECT 1 FROM "LoanPayment" lp WHERE lp.loan = l.id)
  AND l."totalPaid" != 0;

-- 2.2 Corregir pendingAmountStored (siempre debe ser totalDebtAcquired - totalPaid)
UPDATE "Loan"
SET "pendingAmountStored" = "totalDebtAcquired" - "totalPaid",
    "updatedAt" = NOW()
WHERE "pendingAmountStored" != ("totalDebtAcquired" - "totalPaid");

-- 2.3 Corregir comissionAmount basándose en LoanPayment
UPDATE "Loan" l
SET "comissionAmount" = COALESCE(payments.total, 0),
    "updatedAt" = NOW()
FROM (
  SELECT loan, SUM(comission) AS total
  FROM "LoanPayment"
  GROUP BY loan
) payments
WHERE payments.loan = l.id
  AND l."comissionAmount" != payments.total;

-- Para préstamos sin pagos (comissionAmount debería ser 0)
UPDATE "Loan" l
SET "comissionAmount" = 0,
    "updatedAt" = NOW()
WHERE NOT EXISTS (SELECT 1 FROM "LoanPayment" lp WHERE lp.loan = l.id)
  AND l."comissionAmount" != 0;

-- 2.4 Corregir status: ACTIVE → FINISHED (pagados completamente, sin renovar)
UPDATE "Loan"
SET status = 'FINISHED',
    "updatedAt" = NOW()
WHERE status = 'ACTIVE'
  AND "totalPaid" >= "totalDebtAcquired"
  AND "renewedDate" IS NULL;

-- 2.5 Corregir status: FINISHED → ACTIVE (no pagados completamente, sin renovar)
UPDATE "Loan"
SET status = 'ACTIVE',
    "finishedDate" = NULL,
    "updatedAt" = NOW()
WHERE status = 'FINISHED'
  AND "totalPaid" < "totalDebtAcquired"
  AND "renewedDate" IS NULL;

-- 2.6 Corregir finishedDate para préstamos pagados
UPDATE "Loan" l
SET "finishedDate" = last_payment."receivedAt",
    "updatedAt" = NOW()
FROM (
  SELECT loan, MAX("receivedAt") AS "receivedAt"
  FROM "LoanPayment"
  GROUP BY loan
) last_payment
WHERE last_payment.loan = l.id
  AND l."totalPaid" >= l."totalDebtAcquired"
  AND (
    l."finishedDate" IS NULL
    OR l."finishedDate" != last_payment."receivedAt"
  );

-- 2.7 Limpiar finishedDate de préstamos NO pagados
UPDATE "Loan"
SET "finishedDate" = NULL,
    "updatedAt" = NOW()
WHERE "totalPaid" < "totalDebtAcquired"
  AND "finishedDate" IS NOT NULL
  AND "renewedDate" IS NULL;


-- ============================================================
-- PARTE 3: VERIFICACIÓN POST-CORRECCIÓN
-- ============================================================

-- Ejecutar después de las correcciones para verificar que todo está bien
SELECT
  'Inconsistencias restantes' AS check_type,
  (
    SELECT COUNT(*) FROM "Loan" l
    LEFT JOIN (SELECT loan, SUM(amount) AS total FROM "LoanPayment" GROUP BY loan) p ON p.loan = l.id
    WHERE l."totalPaid" != COALESCE(p.total, 0)
  ) AS total_paid_issues,
  (
    SELECT COUNT(*) FROM "Loan"
    WHERE "pendingAmountStored" != ("totalDebtAcquired" - "totalPaid")
  ) AS pending_issues,
  (
    SELECT COUNT(*) FROM "Loan"
    WHERE status = 'ACTIVE' AND "totalPaid" >= "totalDebtAcquired" AND "renewedDate" IS NULL
  ) AS status_issues;
