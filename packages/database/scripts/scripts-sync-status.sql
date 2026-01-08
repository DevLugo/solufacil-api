 -- Query de validación: Préstamos pagados con finishedDate incorrecto
  SELECT
    l.id,
    l.status,
    l."totalDebtAcquired",
    l."totalPaid",
    l."finishedDate" AS current_finished_date,
    last_payment."receivedAt" AS last_payment_date,
    CASE
      WHEN l."finishedDate" != last_payment."receivedAt" THEN 'NEEDS_FIX'
      WHEN l."finishedDate" IS NULL THEN 'MISSING_DATE'
      ELSE 'OK'
    END AS status_check
  FROM "Loan" l
  INNER JOIN (
    SELECT
      loan,
      SUM(amount) AS total_payments,
      MAX("receivedAt") AS "receivedAt"
    FROM "LoanPayment"
    GROUP BY loan
  ) last_payment ON last_payment.loan = l.id
  WHERE l."totalPaid" >= l."totalDebtAcquired"
    AND (
      l."finishedDate" IS NULL
      OR l."finishedDate" != last_payment."receivedAt"
    )
  ORDER BY last_payment."receivedAt" DESC;

  Y la query UPDATE para corregirlos:

  -- UPDATE: Corregir finishedDate con la fecha del último pago
  UPDATE "Loan" l
  SET "finishedDate" = last_payment."receivedAt"
  FROM (
    SELECT
      loan,
      MAX("receivedAt") AS "receivedAt"
    FROM "LoanPayment"
    GROUP BY loan
  ) last_payment
  WHERE last_payment.loan = l.id
    AND l."totalPaid" >= l."totalDebtAcquired"
    AND (
      l."finishedDate" IS NULL
      OR l."finishedDate" != last_payment."receivedAt"
    );

------------------


-- Query de validación: Préstamos con renewedDate incorrecto (solo fecha)
  SELECT
    l.id,
    l.status,
    l."renewedDate",
    last_payment."receivedAt" AS last_payment_date,
    CASE
      WHEN l."renewedDate"::date = last_payment."receivedAt"::date THEN 'OK'
      ELSE 'NEEDS_NULL'
    END AS status_check
  FROM "Loan" l
  INNER JOIN (
    SELECT
      loan,
      MAX("receivedAt") AS "receivedAt"
    FROM "LoanPayment"
    GROUP BY loan
  ) last_payment ON last_payment.loan = l.id
  WHERE l."renewedDate" IS NOT NULL
    AND l."renewedDate"::date != last_payment."receivedAt"::date
  ORDER BY l."renewedDate" DESC;

  Y el UPDATE:

  -- UPDATE: Poner NULL en renewedDate cuando la fecha no coincide con último pago
  UPDATE "Loan" l
  SET "renewedDate" = NULL
  FROM (
    SELECT
      loan,
      MAX("receivedAt") AS "receivedAt"
    FROM "LoanPayment"
    GROUP BY loan
  ) last_payment
  WHERE last_payment.loan = l.id
    AND l."renewedDate" IS NOT NULL
    AND l."renewedDate"::date != last_payment."receivedAt"::date;