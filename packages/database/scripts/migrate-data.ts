/**
 * Script de migración de datos desde schema "public" a "solufacil_mono"
 *
 * Uso:
 *   npx tsx scripts/migrate-data.ts           # Ejecutar migración
 *   npx tsx scripts/migrate-data.ts --dry-run # Solo mostrar qué se migraría
 *   npx tsx scripts/migrate-data.ts --count   # Solo contar registros
 *
 * Variables de entorno:
 *   DATABASE_URL        - URL de conexión (usada para ambos si no se especifican las otras)
 *   SOURCE_DATABASE_URL - URL de la DB origen (opcional, default: DATABASE_URL)
 *   TARGET_DATABASE_URL - URL de la DB destino (opcional, default: DATABASE_URL)
 *   SOURCE_SCHEMA       - Schema origen (default: 'public')
 *   TARGET_SCHEMA       - Schema destino (default: 'solufacil_mono')
 *
 * Ejemplos:
 *   # Local a local (misma DB, diferentes schemas)
 *   DATABASE_URL="postgresql://localhost/solufacil" npx tsx scripts/migrate-data.ts
 *
 *   # Producción a producción (misma DB remota)
 *   DATABASE_URL="postgresql://user:pass@neon.tech/db" npx tsx scripts/migrate-data.ts
 *
 *   # Producción a local (diferentes DBs)
 *   SOURCE_DATABASE_URL="postgresql://user:pass@neon.tech/db" \
 *   TARGET_DATABASE_URL="postgresql://localhost/solufacil" \
 *   npx tsx scripts/migrate-data.ts
 *
 * Este script:
 * 1. Conecta a ambos schemas (pueden ser misma DB o diferentes)
 * 2. Copia datos mapeando nombres de columnas diferentes
 * 3. Reporta diferencias y errores encontrados
 */

import 'dotenv/config'
import { Pool } from 'pg'

const SOURCE_SCHEMA = process.env.SOURCE_SCHEMA || 'public'
const TARGET_SCHEMA = process.env.TARGET_SCHEMA || 'solufacil_mono'

// Support for different source and target databases
const SOURCE_DB_URL = process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL
const TARGET_DB_URL = process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL
const SAME_DATABASE = SOURCE_DB_URL === TARGET_DB_URL

// Parse command line arguments
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const COUNT_ONLY = args.includes('--count')

// Create connection pool (same DB for both schemas)
const pool = new Pool({
  connectionString: SOURCE_DB_URL,
})

interface MigrationResult {
  table: string
  sourceCount: number
  targetCount: number
  success: boolean
  error?: string
}

// Orden de migración (respetando foreign keys)
const MIGRATION_ORDER = [
  // Sin dependencias
  'State',
  'Route',
  'Account',
  'LeadPaymentType',
  // Dependencias nivel 1
  'User',
  'Municipality',
  // Dependencias nivel 2
  'PersonalData',
  'Location',
  'ReportConfig',
  'TelegramUser',
  // Dependencias nivel 3
  'Phone',
  'Address',
  'Employee',
  'Borrower',
  'Loantype',
  // Dependencias nivel 4
  'PortfolioCleanup',
  'LeadPaymentReceived',
  // Dependencias nivel 5
  'Loan',
  // Dependencias nivel 6
  'LoanPayment',
  'DocumentPhoto',
  'CommissionPayment',
  'Transaction',
  // Dependencias nivel 7
  'FalcoCompensatoryPayment',
  // Logs y auditoría
  'AuditLog',
  'ReportExecutionLog',
  'DocumentNotificationLog',
]

async function migrateTable(tableName: string): Promise<MigrationResult> {
  try {
    // Verificar que la tabla existe en origen
    const checkSource = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = $1 AND table_name = $2
      )
    `, [SOURCE_SCHEMA, tableName])

    if (!checkSource.rows[0].exists) {
      return {
        table: tableName,
        sourceCount: 0,
        targetCount: 0,
        success: true,
        error: `Table does not exist in source (skipped)`,
      }
    }

    // Contar registros en origen
    const countResult = await pool.query(`SELECT COUNT(*) as count FROM "${SOURCE_SCHEMA}"."${tableName}"`)
    const sourceCount = parseInt(countResult.rows[0].count, 10)

    if (sourceCount === 0) {
      return {
        table: tableName,
        sourceCount: 0,
        targetCount: 0,
        success: true,
      }
    }

    // Generar query específico por tabla con casts de enums
    let insertQuery = ''

    switch (tableName) {
      case 'State':
        insertQuery = `
          INSERT INTO "${TARGET_SCHEMA}"."State" (id, name, "createdAt", "updatedAt")
          SELECT id, name, NOW(), NOW()
          FROM "${SOURCE_SCHEMA}"."State"
          ON CONFLICT (id) DO NOTHING
        `
        break

      case 'Route':
        insertQuery = `
          INSERT INTO "${TARGET_SCHEMA}"."Route" (id, name)
          SELECT id, name
          FROM "${SOURCE_SCHEMA}"."Route"
          ON CONFLICT (id) DO NOTHING
        `
        break

      case 'Account':
        insertQuery = `
          INSERT INTO "${TARGET_SCHEMA}"."Account" (id, name, type, amount, "createdAt", "updatedAt")
          SELECT id, name, type::text::"${TARGET_SCHEMA}"."AccountType", amount, "createdAt", COALESCE("updatedAt", "createdAt", NOW())
          FROM "${SOURCE_SCHEMA}"."Account"
          ON CONFLICT (id) DO NOTHING
        `
        break

      case 'LeadPaymentType':
        insertQuery = `
          INSERT INTO "${TARGET_SCHEMA}"."LeadPaymentType" (id, type)
          SELECT id, type
          FROM "${SOURCE_SCHEMA}"."LeadPaymentType"
          ON CONFLICT (id) DO NOTHING
        `
        break

      case 'User':
        insertQuery = `
          INSERT INTO "${TARGET_SCHEMA}"."User" (id, name, email, password, role, "createdAt")
          SELECT id, COALESCE(name, ''), email, password, role::text::"${TARGET_SCHEMA}"."UserRole", "createdAt"
          FROM "${SOURCE_SCHEMA}"."User"
          ON CONFLICT (id) DO NOTHING
        `
        break

      case 'Municipality':
        insertQuery = `
          INSERT INTO "${TARGET_SCHEMA}"."Municipality" (id, name, state, "createdAt", "updatedAt")
          SELECT id, name, state, NOW(), NOW()
          FROM "${SOURCE_SCHEMA}"."Municipality"
          ON CONFLICT (id) DO NOTHING
        `
        break

      case 'PersonalData':
        // clientCode is unique, so we use the id as fallback for NULL values
        insertQuery = `
          INSERT INTO "${TARGET_SCHEMA}"."PersonalData" (id, "fullName", "clientCode", "birthDate", "createdAt", "updatedAt")
          SELECT id, "fullName", COALESCE(NULLIF("clientCode", ''), 'AUTO-' || id), "birthDate", "createdAt", COALESCE("updatedAt", "createdAt", NOW())
          FROM "${SOURCE_SCHEMA}"."PersonalData"
          ON CONFLICT (id) DO NOTHING
        `
        break

      case 'Location':
        insertQuery = `
          INSERT INTO "${TARGET_SCHEMA}"."Location" (id, name, municipality, route, "createdAt", "updatedAt")
          SELECT id, name, municipality, route, NOW(), NOW()
          FROM "${SOURCE_SCHEMA}"."Location"
          ON CONFLICT (id) DO NOTHING
        `
        break

      case 'ReportConfig':
        insertQuery = `
          INSERT INTO "${TARGET_SCHEMA}"."ReportConfig" (id, name, "reportType", schedule, "isActive", "createdAt", "updatedAt")
          SELECT id, name, "reportType"::text, schedule, "isActive", "createdAt", COALESCE("updatedAt", "createdAt", NOW())
          FROM "${SOURCE_SCHEMA}"."ReportConfig"
          ON CONFLICT (id) DO NOTHING
        `
        break

      case 'TelegramUser':
        // Set platformUser to NULL if user doesn't exist in target
        insertQuery = `
          INSERT INTO "${TARGET_SCHEMA}"."TelegramUser" (id, "chatId", name, username, "isActive", "registeredAt", "lastActivity", "reportsReceived", "isInRecipientsList", notes, "platformUser", "createdAt", "updatedAt")
          SELECT t.id, t."chatId", COALESCE(t.name, ''), COALESCE(t.username, ''), t."isActive", t."registeredAt", COALESCE(t."lastActivity", NOW()), t."reportsReceived", t."isInRecipientsList", COALESCE(t.notes, ''),
            CASE WHEN EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."User" WHERE id = t."platformUser") THEN t."platformUser" ELSE NULL END,
            NOW(), NOW()
          FROM "${SOURCE_SCHEMA}"."TelegramUser" t
          ON CONFLICT (id) DO NOTHING
        `
        break

      case 'Phone':
        insertQuery = `
          INSERT INTO "${TARGET_SCHEMA}"."Phone" (id, number, "personalData", "createdAt", "updatedAt")
          SELECT id, COALESCE(number, ''), "personalData", "createdAt", COALESCE("updatedAt", "createdAt", NOW())
          FROM "${SOURCE_SCHEMA}"."Phone"
          WHERE "personalData" IS NOT NULL
          ON CONFLICT (id) DO NOTHING
        `
        break

      case 'Address':
        insertQuery = `
          INSERT INTO "${TARGET_SCHEMA}"."Address" (id, street, "exteriorNumber", "interiorNumber", "postalCode", "references", location, "personalData", "createdAt", "updatedAt")
          SELECT id, COALESCE(street, ''), COALESCE("exteriorNumber", ''), COALESCE("interiorNumber", ''), COALESCE("postalCode", ''), COALESCE("references", ''), location, "personalData", NOW(), NOW()
          FROM "${SOURCE_SCHEMA}"."Address"
          WHERE location IS NOT NULL AND "personalData" IS NOT NULL
          ON CONFLICT (id) DO NOTHING
        `
        break

      case 'Employee':
        // Set user to NULL if user doesn't exist in target (User table may be empty)
        insertQuery = `
          INSERT INTO "${TARGET_SCHEMA}"."Employee" (id, "oldId", type, "personalData", "user", "createdAt", "updatedAt")
          SELECT e.id, e."oldId", e.type::text::"${TARGET_SCHEMA}"."EmployeeType", e."personalData",
            CASE WHEN EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."User" WHERE id = e."user") THEN e."user" ELSE NULL END,
            NOW(), NOW()
          FROM "${SOURCE_SCHEMA}"."Employee" e
          WHERE e."personalData" IS NOT NULL
          ON CONFLICT (id) DO NOTHING
        `
        break

      case 'Borrower':
        insertQuery = `
          INSERT INTO "${TARGET_SCHEMA}"."Borrower" (id, "loanFinishedCount", "personalData", "createdAt", "updatedAt")
          SELECT id, "loanFinishedCount", "personalData", "createdAt", COALESCE("updatedAt", "createdAt", NOW())
          FROM "${SOURCE_SCHEMA}"."Borrower"
          ON CONFLICT (id) DO NOTHING
        `
        break

      case 'Loantype':
        insertQuery = `
          INSERT INTO "${TARGET_SCHEMA}"."Loantype" (id, name, "weekDuration", rate, "loanPaymentComission", "loanGrantedComission", "createdAt", "updatedAt")
          SELECT id, name, "weekDuration", rate, "loanPaymentComission", "loanGrantedComission", "createdAt", COALESCE("updatedAt", "createdAt", NOW())
          FROM "${SOURCE_SCHEMA}"."Loantype"
          ON CONFLICT (id) DO NOTHING
        `
        break

      case 'PortfolioCleanup':
        // Only insert if executedBy exists in Employee (executedBy is NOT NULL in schema)
        insertQuery = `
          INSERT INTO "${TARGET_SCHEMA}"."PortfolioCleanup" (id, name, description, "cleanupDate", "fromDate", "toDate", "excludedLoansCount", "excludedAmount", route, "executedBy", "createdAt", "updatedAt")
          SELECT p.id, p.name, COALESCE(p.description, ''), p."cleanupDate", p."fromDate", p."toDate", COALESCE(p."excludedLoansCount", 0), COALESCE(p."excludedAmount", 0), p.route, p."executedBy",
            p."createdAt", COALESCE(p."updatedAt", p."createdAt", NOW())
          FROM "${SOURCE_SCHEMA}"."PortfolioCleanup" p
          WHERE p."executedBy" IS NOT NULL
            AND EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."Employee" WHERE id = p."executedBy")
          ON CONFLICT (id) DO NOTHING
        `
        break

      case 'LeadPaymentReceived':
        // Only insert if lead exists in Employee
        insertQuery = `
          INSERT INTO "${TARGET_SCHEMA}"."LeadPaymentReceived" (id, "expectedAmount", "paidAmount", "cashPaidAmount", "bankPaidAmount", "falcoAmount", "paymentStatus", lead, agent, "createdAt", "updatedAt")
          SELECT lpr.id, COALESCE(lpr."expectedAmount", 0), COALESCE(lpr."paidAmount", 0), COALESCE(lpr."cashPaidAmount", 0), COALESCE(lpr."bankPaidAmount", 0), COALESCE(lpr."falcoAmount", 0), lpr."paymentStatus", lpr.lead,
            CASE WHEN EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."Employee" WHERE id = lpr.agent) THEN lpr.agent ELSE NULL END,
            lpr."createdAt", COALESCE(lpr."updatedAt", lpr."createdAt", NOW())
          FROM "${SOURCE_SCHEMA}"."LeadPaymentReceived" lpr
          WHERE lpr.lead IS NOT NULL
            AND EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."Employee" WHERE id = lpr.lead)
          ON CONFLICT (id) DO NOTHING
        `
        break

      case 'Loan':
        // grantor and lead are optional - borrower and loantype are required
        // Set grantor/lead/excludedByCleanup to NULL if they don't exist in their respective tables
        insertQuery = `
          INSERT INTO "${TARGET_SCHEMA}"."Loan" (id, "oldId", "requestedAmount", "amountGived", "signDate", "finishedDate", "renewedDate", "badDebtDate", "isDeceased", "profitAmount", "totalDebtAcquired", "expectedWeeklyPayment", "totalPaid", "pendingAmountStored", "comissionAmount", status, borrower, loantype, grantor, lead, "snapshotLeadId", "snapshotLeadAssignedAt", "snapshotRouteId", "snapshotRouteName", "previousLoan", "excludedByCleanup", "createdAt", "updatedAt")
          SELECT l.id, l."oldId", COALESCE(l."requestedAmount", 0), COALESCE(l."amountGived", 0), l."signDate", l."finishedDate", l."renewedDate", l."badDebtDate", COALESCE(l."isDeceased", false), COALESCE(l."profitAmount", 0), COALESCE(l."totalDebtAcquired", 0), COALESCE(l."expectedWeeklyPayment", 0), COALESCE(l."totalPaid", 0), COALESCE(l."pendingAmountStored", 0), COALESCE(l."comissionAmount", 0), l.status::text::"${TARGET_SCHEMA}"."LoanStatus", l.borrower, l.loantype,
            CASE WHEN EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."Employee" WHERE id = l.grantor) THEN l.grantor ELSE NULL END,
            CASE WHEN EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."Employee" WHERE id = l.lead) THEN l.lead ELSE NULL END,
            COALESCE(l."snapshotLeadId", ''), l."snapshotLeadAssignedAt",
            CASE WHEN l."snapshotRouteId" IS NOT NULL AND l."snapshotRouteId" != '' AND EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."Route" WHERE id = l."snapshotRouteId") THEN l."snapshotRouteId" ELSE NULL END,
            COALESCE(l."snapshotRouteName", ''), NULL,
            CASE WHEN EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."PortfolioCleanup" WHERE id = l."excludedByCleanup") THEN l."excludedByCleanup" ELSE NULL END,
            l."createdAt", COALESCE(l."updatedAt", l."createdAt", NOW())
          FROM "${SOURCE_SCHEMA}"."Loan" l
          WHERE l.borrower IS NOT NULL AND l.loantype IS NOT NULL
          ON CONFLICT (id) DO NOTHING
        `
        break

      case 'LoanPayment':
        // Only insert if loan exists in target and leadPaymentReceived exists (if not null)
        // Note: Many payments have NULL paymentMethod, default to 'CASH' for these
        insertQuery = `
          INSERT INTO "${TARGET_SCHEMA}"."LoanPayment" (id, amount, comission, "receivedAt", "paymentMethod", type, "oldLoanId", loan, "leadPaymentReceived", "createdAt", "updatedAt")
          SELECT lp.id, COALESCE(lp.amount, 0), COALESCE(lp.comission, 0), lp."receivedAt",
            COALESCE(NULLIF(lp."paymentMethod", ''), 'CASH')::text::"${TARGET_SCHEMA}"."PaymentMethod",
            COALESCE(lp.type, ''), lp."oldLoanId", lp.loan,
            CASE WHEN EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."LeadPaymentReceived" WHERE id = lp."leadPaymentReceived") THEN lp."leadPaymentReceived" ELSE NULL END,
            lp."createdAt", COALESCE(lp."updatedAt", lp."createdAt", NOW())
          FROM "${SOURCE_SCHEMA}"."LoanPayment" lp
          WHERE lp.loan IS NOT NULL
            AND EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."Loan" WHERE id = lp.loan)
          ON CONFLICT (id) DO NOTHING
        `
        break

      case 'DocumentPhoto':
        insertQuery = `
          INSERT INTO "${TARGET_SCHEMA}"."DocumentPhoto" (id, title, description, "photoUrl", "publicId", "documentType", "isError", "errorDescription", "isMissing", "personalData", loan, "uploadedBy", "createdAt", "updatedAt")
          SELECT id, COALESCE(title, ''), COALESCE(description, ''), "photoUrl", "publicId", "documentType"::text::"${TARGET_SCHEMA}"."DocumentType", COALESCE("isError", false), COALESCE("errorDescription", ''), COALESCE("isMissing", false), "personalData", loan, "uploadedBy", "createdAt", COALESCE("updatedAt", "createdAt", NOW())
          FROM "${SOURCE_SCHEMA}"."DocumentPhoto"
          WHERE "uploadedBy" IS NOT NULL
          ON CONFLICT (id) DO NOTHING
        `
        break

      case 'CommissionPayment':
        insertQuery = `
          INSERT INTO "${TARGET_SCHEMA}"."CommissionPayment" (id, amount, loan, employee, "createdAt", "updatedAt")
          SELECT id, amount, loan, employee, "createdAt", COALESCE("updatedAt", "createdAt", NOW())
          FROM "${SOURCE_SCHEMA}"."CommissionPayment"
          ON CONFLICT (id) DO NOTHING
        `
        break

      case 'Transaction':
        // Filter invalid FKs for loanPayment, loan, lead, leadPaymentReceived
        // Note: INCOME transactions typically don't have sourceAccount set in keystone,
        // so we use destinationAccount as sourceAccount for these (the account receiving the payment)
        insertQuery = `
          INSERT INTO "${TARGET_SCHEMA}"."Transaction" (id, amount, date, type, description, "incomeSource", "expenseSource", "snapshotLeadId", "snapshotRouteId", "expenseGroupId", "profitAmount", "returnToCapital", loan, "loanPayment", "sourceAccount", "destinationAccount", route, lead, "leadPaymentReceived", "createdAt", "updatedAt")
          SELECT t.id, COALESCE(t.amount, 0), t.date, t.type::text::"${TARGET_SCHEMA}"."TransactionType", COALESCE(t.description, ''), t."incomeSource", t."expenseSource", COALESCE(t."snapshotLeadId", ''), COALESCE(t."snapshotRouteId", ''), t."expenseGroupId", COALESCE(t."profitAmount", 0), COALESCE(t."returnToCapital", 0),
            CASE WHEN EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."Loan" WHERE id = t.loan) THEN t.loan ELSE NULL END,
            CASE WHEN EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."LoanPayment" WHERE id = t."loanPayment") THEN t."loanPayment" ELSE NULL END,
            -- sourceAccount: use original if valid, otherwise use destinationAccount for INCOME transactions
            CASE
              WHEN t."sourceAccount" IS NOT NULL AND t."sourceAccount" != '' AND EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."Account" WHERE id = t."sourceAccount") THEN t."sourceAccount"
              WHEN t."destinationAccount" IS NOT NULL AND t."destinationAccount" != '' AND EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."Account" WHERE id = t."destinationAccount") THEN t."destinationAccount"
            END,
            -- destinationAccount: keep original if valid
            CASE
              WHEN t."destinationAccount" IS NOT NULL AND t."destinationAccount" != '' AND EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."Account" WHERE id = t."destinationAccount") THEN t."destinationAccount"
              ELSE NULL
            END,
            t.route,
            CASE WHEN EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."Employee" WHERE id = t.lead) THEN t.lead ELSE NULL END,
            CASE WHEN EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."LeadPaymentReceived" WHERE id = t."leadPaymentReceived") THEN t."leadPaymentReceived" ELSE NULL END,
            t."createdAt", COALESCE(t."updatedAt", t."createdAt", NOW())
          FROM "${SOURCE_SCHEMA}"."Transaction" t
          WHERE t.date IS NOT NULL
            AND (
              -- Transactions with valid sourceAccount
              (t."sourceAccount" IS NOT NULL AND t."sourceAccount" != '' AND EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."Account" WHERE id = t."sourceAccount"))
              OR
              -- INCOME transactions that have valid destinationAccount (use it as sourceAccount)
              (t.type = 'INCOME' AND t."destinationAccount" IS NOT NULL AND t."destinationAccount" != '' AND EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."Account" WHERE id = t."destinationAccount"))
            )
          ON CONFLICT (id) DO NOTHING
        `
        break

      case 'FalcoCompensatoryPayment':
        // Only insert if leadPaymentReceived exists in target
        insertQuery = `
          INSERT INTO "${TARGET_SCHEMA}"."FalcoCompensatoryPayment" (id, amount, "leadPaymentReceived", "createdAt", "updatedAt")
          SELECT f.id, f.amount, f."leadPaymentReceived", f."createdAt", COALESCE(f."updatedAt", f."createdAt", NOW())
          FROM "${SOURCE_SCHEMA}"."FalcoCompensatoryPayment" f
          WHERE EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."LeadPaymentReceived" WHERE id = f."leadPaymentReceived")
          ON CONFLICT (id) DO NOTHING
        `
        break

      case 'AuditLog':
        insertQuery = `
          INSERT INTO "${TARGET_SCHEMA}"."AuditLog" (id, operation, "modelName", "recordId", "userName", "userEmail", "userRole", "sessionId", "ipAddress", "userAgent", "previousValues", "newValues", "changedFields", description, metadata, "user", "createdAt")
          SELECT id, operation, COALESCE("modelName", ''), COALESCE("recordId", ''), COALESCE("userName", ''), COALESCE("userEmail", ''), COALESCE("userRole", ''), COALESCE("sessionId", ''), COALESCE("ipAddress", ''), COALESCE("userAgent", ''), "previousValues", "newValues", "changedFields", COALESCE(description, ''), metadata, "user", "createdAt"
          FROM "${SOURCE_SCHEMA}"."AuditLog"
          ON CONFLICT (id) DO NOTHING
        `
        break

      case 'ReportExecutionLog':
        insertQuery = `
          INSERT INTO "${TARGET_SCHEMA}"."ReportExecutionLog" (id, status, "executionType", message, "errorDetails", "recipientsCount", "successfulDeliveries", "failedDeliveries", "startTime", "endTime", duration, "cronExpression", timezone, "reportConfig", "createdAt", "updatedAt")
          SELECT id, status, "executionType", COALESCE(message, ''), COALESCE("errorDetails", ''), "recipientsCount", "successfulDeliveries", "failedDeliveries", "startTime", "endTime", duration, COALESCE("cronExpression", ''), COALESCE(timezone, ''), "reportConfig", "createdAt", COALESCE("updatedAt", "createdAt", NOW())
          FROM "${SOURCE_SCHEMA}"."ReportExecutionLog"
          ON CONFLICT (id) DO NOTHING
        `
        break

      case 'DocumentNotificationLog':
        insertQuery = `
          INSERT INTO "${TARGET_SCHEMA}"."DocumentNotificationLog" (id, "documentId", "documentType", "personalDataId", "personName", "loanId", "routeId", "routeName", "localityName", "routeLeadId", "routeLeadName", "routeLeadUserId", "telegramUserId", "telegramChatId", "telegramUsername", "issueType", description, "messageContent", status, "telegramResponse", "telegramErrorCode", "telegramErrorMessage", "sentAt", "responseTimeMs", "retryCount", "lastRetryAt", notes, "createdAt", "updatedAt")
          SELECT id, COALESCE("documentId", ''), COALESCE("documentType", ''), COALESCE("personalDataId", ''), COALESCE("personName", ''), COALESCE("loanId", ''), COALESCE("routeId", ''), COALESCE("routeName", ''), COALESCE("localityName", ''), COALESCE("routeLeadId", ''), COALESCE("routeLeadName", ''), COALESCE("routeLeadUserId", ''), COALESCE("telegramUserId", ''), COALESCE("telegramChatId", ''), COALESCE("telegramUsername", ''), "issueType", COALESCE(description, ''), COALESCE("messageContent", ''), status, COALESCE("telegramResponse", ''), "telegramErrorCode", COALESCE("telegramErrorMessage", ''), "sentAt", "responseTimeMs", "retryCount", "lastRetryAt", COALESCE(notes, ''), "createdAt", COALESCE("updatedAt", "createdAt", NOW())
          FROM "${SOURCE_SCHEMA}"."DocumentNotificationLog"
          ON CONFLICT (id) DO NOTHING
        `
        break

      default:
        return {
          table: tableName,
          sourceCount,
          targetCount: 0,
          success: false,
          error: `No migration query defined for table ${tableName}`,
        }
    }

    await pool.query(insertQuery)

    // Contar registros en destino
    const targetCountResult = await pool.query(`SELECT COUNT(*) as count FROM "${TARGET_SCHEMA}"."${tableName}"`)
    const targetCount = parseInt(targetCountResult.rows[0].count, 10)

    return {
      table: tableName,
      sourceCount,
      targetCount,
      success: true,
    }
  } catch (error) {
    return {
      table: tableName,
      sourceCount: 0,
      targetCount: 0,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function migrateEmployeeRoutes(): Promise<MigrationResult> {
  // En origen, Employee tiene una FK directa a Route (1:N)
  // En destino, es una relación M:M via _RouteEmployees
  // In Prisma M:M _RouteEmployees: A = Route ID, B = Employee ID (alphabetical order based on model names)
  try {
    // Count source records that will be migrated
    const countSource = await pool.query(`
      SELECT COUNT(*)::int as count
      FROM "${SOURCE_SCHEMA}"."Employee" e
      WHERE e.routes IS NOT NULL
        AND EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."Employee" WHERE id = e.id)
        AND EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."Route" WHERE id = e.routes)
    `)
    const sourceCount = countSource.rows[0].count

    if (sourceCount === 0) {
      return {
        table: 'Employee Routes (M:M)',
        sourceCount: 0,
        targetCount: 0,
        success: true,
      }
    }

    // Use INSERT...SELECT for atomic operation
    // In this schema based on FK constraints: A = Employee ID, B = Route ID
    await pool.query(`
      INSERT INTO "${TARGET_SCHEMA}"."_RouteEmployees" ("A", "B")
      SELECT e.id, e.routes
      FROM "${SOURCE_SCHEMA}"."Employee" e
      WHERE e.routes IS NOT NULL
        AND EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."Employee" WHERE id = e.id)
        AND EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."Route" WHERE id = e.routes)
      ON CONFLICT ("A", "B") DO NOTHING
    `)

    const targetCountResult = await pool.query(`SELECT COUNT(*) as count FROM "${TARGET_SCHEMA}"."_RouteEmployees"`)
    const targetCount = parseInt(targetCountResult.rows[0].count, 10)

    return {
      table: 'Employee Routes (M:M)',
      sourceCount,
      targetCount,
      success: true,
    }
  } catch (error) {
    return {
      table: 'Employee Routes (M:M)',
      sourceCount: 0,
      targetCount: 0,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function migrateJunctionTable(sourceName: string, targetName: string): Promise<MigrationResult> {
  try {
    // Verificar que la tabla existe en origen
    const checkSource = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = $1 AND table_name = $2
      )
    `, [SOURCE_SCHEMA, sourceName])

    if (!checkSource.rows[0].exists) {
      return {
        table: `${sourceName} → ${targetName}`,
        sourceCount: 0,
        targetCount: 0,
        success: true,
        error: `Junction table does not exist in source (skipped)`,
      }
    }

    // Contar registros en origen
    const countResult = await pool.query(`SELECT COUNT(*) as count FROM "${SOURCE_SCHEMA}"."${sourceName}"`)
    const sourceCount = parseInt(countResult.rows[0].count, 10)

    if (sourceCount === 0) {
      return {
        table: `${sourceName} → ${targetName}`,
        sourceCount: 0,
        targetCount: 0,
        success: true,
      }
    }

    // Copiar datos (junction tables tienen columnas A y B)
    const insertQuery = `
      INSERT INTO "${TARGET_SCHEMA}"."${targetName}" ("A", "B")
      SELECT "A", "B"
      FROM "${SOURCE_SCHEMA}"."${sourceName}"
      ON CONFLICT ("A", "B") DO NOTHING
    `

    await pool.query(insertQuery)

    // Contar registros en destino
    const targetCountResult = await pool.query(`SELECT COUNT(*) as count FROM "${TARGET_SCHEMA}"."${targetName}"`)
    const targetCount = parseInt(targetCountResult.rows[0].count, 10)

    return {
      table: `${sourceName} → ${targetName}`,
      sourceCount,
      targetCount,
      success: true,
    }
  } catch (error) {
    return {
      table: `${sourceName} → ${targetName}`,
      sourceCount: 0,
      targetCount: 0,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// Tablas de junction (M:M)
const JUNCTION_TABLES: Record<string, { sourceTable: string; targetTable: string }> = {
  '_Loan_collaterals': { sourceTable: '_Loan_collaterals', targetTable: '_LoanCollaterals' },
  '_Account_routes': { sourceTable: '_Account_routes', targetTable: '_RouteAccounts' },
  '_ReportConfig_routes': { sourceTable: '_ReportConfig_routes', targetTable: '_ReportConfigRoutes' },
  '_ReportConfig_telegramUsers': { sourceTable: '_ReportConfig_telegramUsers', targetTable: '_ReportConfigRecipients' },
}

/**
 * Sincroniza el snapshotRouteId de los préstamos con la ruta del líder asignado.
 *
 * CONTEXTO:
 * - Cada Loan tiene un campo `snapshotRouteId` que indica la ruta del préstamo
 * - Cada Loan tiene un `lead` (Employee) que puede tener múltiples rutas asignadas via M:M (_RouteEmployees)
 * - Este UPDATE sincroniza el snapshotRouteId con la ruta del líder
 *
 * NOTA IMPORTANTE:
 * - Si un líder tiene MÚLTIPLES rutas asignadas, se selecciona la primera alfabéticamente
 * - El orden alfabético es: CIUDAD < RUTA 3A < RUTA 3B < RUTA1A < RUTA1B < RUTA2
 * - Esto significa que RUTA 3A/3B tienen prioridad sobre RUTA1A/1B (espacio < dígito)
 *
 * Ejecutado: 2025-12-15
 */
async function syncSnapshotRouteIdWithLeadRoute(): Promise<MigrationResult> {
  try {
    // Primero contamos cuántos préstamos serán afectados
    // In this schema: A = Employee ID, B = Route ID (based on FK constraints)
    const countBefore = await pool.query(`
      SELECT COUNT(*)::int as count
      FROM "${TARGET_SCHEMA}"."Loan" l
      WHERE l.lead IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM "${TARGET_SCHEMA}"."_RouteEmployees" re
          WHERE re."A" = l.lead
        )
    `)
    const sourceCount = countBefore.rows[0].count

    // UPDATE: Sincroniza snapshotRouteId con la primera ruta del líder (alfabéticamente)
    const updateResult = await pool.query(`
      UPDATE "${TARGET_SCHEMA}"."Loan" l
      SET "snapshotRouteId" = subq.route_id
      FROM (
        SELECT DISTINCT ON (e.id)
          e.id as employee_id,
          r.id as route_id
        FROM "${TARGET_SCHEMA}"."Employee" e
        JOIN "${TARGET_SCHEMA}"."_RouteEmployees" re ON e.id = re."A"
        JOIN "${TARGET_SCHEMA}"."Route" r ON re."B" = r.id
        WHERE e.type = 'LEAD'
        ORDER BY e.id, r.name
      ) subq
      WHERE l.lead = subq.employee_id
    `)

    return {
      table: 'Loan.snapshotRouteId sync',
      sourceCount,
      targetCount: updateResult.rowCount || 0,
      success: true,
    }
  } catch (error) {
    return {
      table: 'Loan.snapshotRouteId sync',
      sourceCount: 0,
      targetCount: 0,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Limpia todas las tablas del schema destino antes de la migración.
 * Se ejecuta en orden inverso para respetar las foreign keys.
 */
async function cleanTargetSchema(): Promise<void> {
  console.log('🧹 Limpiando tablas del schema destino...\n')

  // Orden inverso de MIGRATION_ORDER + junction tables
  const cleanOrder = [
    // Junction tables primero (no tienen dependencias)
    '_LoanCollaterals',
    '_RouteAccounts',
    '_ReportConfigRoutes',
    '_ReportConfigRecipients',
    '_RouteEmployees',
    // Luego en orden inverso de dependencias
    ...MIGRATION_ORDER.slice().reverse(),
  ]

  for (const tableName of cleanOrder) {
    try {
      // Verificar si la tabla existe
      const checkTable = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = $1 AND table_name = $2
        )
      `, [TARGET_SCHEMA, tableName])

      if (checkTable.rows[0].exists) {
        await pool.query(`TRUNCATE TABLE "${TARGET_SCHEMA}"."${tableName}" CASCADE`)
        console.log(`   ✅ ${tableName} limpiada`)
      }
    } catch (error) {
      // Ignorar errores de tablas que no existen
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (!errorMessage.includes('does not exist')) {
        console.log(`   ⚠️  ${tableName}: ${errorMessage}`)
      }
    }
  }

  console.log('')
}

async function countSourceRecords(): Promise<void> {
  console.log('📊 Contando registros en schema origen...\n')

  let totalRecords = 0
  for (const tableName of MIGRATION_ORDER) {
    try {
      const checkSource = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = $1 AND table_name = $2
        )
      `, [SOURCE_SCHEMA, tableName])

      if (checkSource.rows[0].exists) {
        const countResult = await pool.query(`SELECT COUNT(*) as count FROM "${SOURCE_SCHEMA}"."${tableName}"`)
        const count = parseInt(countResult.rows[0].count, 10)
        totalRecords += count
        console.log(`   ${tableName}: ${count.toLocaleString()} registros`)
      } else {
        console.log(`   ${tableName}: (no existe)`)
      }
    } catch (error) {
      console.log(`   ${tableName}: ❌ Error`)
    }
  }

  console.log(`\n   TOTAL: ${totalRecords.toLocaleString()} registros`)
}

function maskConnectionString(url: string | undefined): string {
  if (!url) return '(no definida)'
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.username}:****@${parsed.host}${parsed.pathname}`
  } catch {
    return url.replace(/:[^:@]+@/, ':****@')
  }
}

async function main() {
  console.log('═'.repeat(60))
  console.log('🚀 Script de Migración de Datos')
  console.log('═'.repeat(60))
  console.log('')
  console.log('📍 Configuración:')
  console.log(`   Source DB:     ${maskConnectionString(SOURCE_DB_URL)}`)
  console.log(`   Source Schema: ${SOURCE_SCHEMA}`)
  console.log(`   Target DB:     ${SAME_DATABASE ? '(misma DB)' : maskConnectionString(TARGET_DB_URL)}`)
  console.log(`   Target Schema: ${TARGET_SCHEMA}`)
  console.log('')

  // Warning for different databases
  if (!SAME_DATABASE) {
    console.log('⚠️  ADVERTENCIA: Se detectaron bases de datos diferentes.')
    console.log('   Este script usa queries cross-schema que solo funcionan')
    console.log('   cuando ambos schemas están en la MISMA base de datos.')
    console.log('')
    console.log('   Para sincronizar entre DBs diferentes, considera:')
    console.log('   1. pg_dump del schema origen')
    console.log('   2. Modificar el dump para cambiar el schema')
    console.log('   3. pg_restore en la DB destino')
    console.log('')
    process.exit(1)
  }

  if (DRY_RUN) {
    console.log(`📋 Modo: 🔍 DRY-RUN (no se ejecutarán cambios)\n`)
  } else if (COUNT_ONLY) {
    console.log(`📋 Modo: 📊 CONTEO SOLAMENTE\n`)
    await countSourceRecords()
    await pool.end()
    return
  } else {
    console.log(`📋 Modo: ⚡ EJECUCIÓN REAL\n`)
  }

  // Verificar conexión
  try {
    await pool.query('SELECT 1')
    console.log('   ✅ Conexión a base de datos OK\n')
  } catch (error) {
    console.error('   ❌ Error de conexión:', error)
    process.exit(1)
  }

  // En modo DRY-RUN, solo mostrar qué se haría
  if (DRY_RUN) {
    await countSourceRecords()
    console.log('\n⚠️  Modo DRY-RUN: No se ejecutaron cambios.')
    console.log('   Para ejecutar la migración real, ejecuta sin --dry-run\n')
    await pool.end()
    return
  }

  // PASO 1: Limpiar todas las tablas del destino
  await cleanTargetSchema()

  const results: MigrationResult[] = []

  // Migrar tablas principales
  console.log('📋 Migrando tablas principales...\n')
  for (const tableName of MIGRATION_ORDER) {
    process.stdout.write(`   ${tableName}... `)
    const result = await migrateTable(tableName)
    results.push(result)

    if (result.success) {
      if (result.error) {
        console.log(`⚠️  ${result.error}`)
      } else {
        console.log(`✅ ${result.sourceCount} → ${result.targetCount} registros`)
      }
    } else {
      console.log(`❌ Error: ${result.error}`)
    }
  }

  // Migrar relación Employee-Routes
  console.log('\n📋 Migrando relación Employee-Routes...\n')
  const employeeRoutesResult = await migrateEmployeeRoutes()
  results.push(employeeRoutesResult)
  if (employeeRoutesResult.success) {
    console.log(`   ✅ ${employeeRoutesResult.sourceCount} → ${employeeRoutesResult.targetCount} registros`)
  } else {
    console.log(`   ❌ Error: ${employeeRoutesResult.error}`)
  }

  // Migrar junction tables
  console.log('\n📋 Migrando tablas de relación (M:M)...\n')
  for (const [sourceName, { targetTable }] of Object.entries(JUNCTION_TABLES)) {
    process.stdout.write(`   ${sourceName}... `)
    const result = await migrateJunctionTable(sourceName, targetTable)
    results.push(result)

    if (result.success) {
      if (result.error) {
        console.log(`⚠️  ${result.error}`)
      } else {
        console.log(`✅ ${result.sourceCount} → ${result.targetCount} registros`)
      }
    } else {
      console.log(`❌ Error: ${result.error}`)
    }
  }

  // Sincronizar snapshotRouteId con la ruta del líder
  console.log('\n📋 Sincronizando Loan.snapshotRouteId con ruta del líder...\n')
  const syncResult = await syncSnapshotRouteIdWithLeadRoute()
  results.push(syncResult)
  if (syncResult.success) {
    console.log(`   ✅ ${syncResult.sourceCount} préstamos elegibles → ${syncResult.targetCount} actualizados`)
  } else {
    console.log(`   ❌ Error: ${syncResult.error}`)
  }

  // Resumen
  console.log('\n' + '='.repeat(60))
  console.log('📊 RESUMEN DE MIGRACIÓN')
  console.log('='.repeat(60))

  const successful = results.filter(r => r.success && !r.error)
  const warnings = results.filter(r => r.success && r.error)
  const failed = results.filter(r => !r.success)

  console.log(`\n   ✅ Exitosas: ${successful.length}`)
  console.log(`   ⚠️  Advertencias: ${warnings.length}`)
  console.log(`   ❌ Fallidas: ${failed.length}`)

  if (failed.length > 0) {
    console.log('\n   Tablas con errores:')
    for (const f of failed) {
      console.log(`      - ${f.table}: ${f.error}`)
    }
  }

  const totalSource = results.reduce((sum, r) => sum + r.sourceCount, 0)
  const totalTarget = results.reduce((sum, r) => sum + r.targetCount, 0)
  console.log(`\n   Total registros: ${totalSource} → ${totalTarget}`)

  await pool.end()
  console.log('\n✅ Migración completada!\n')
}

main().catch(console.error)
