/**
 * Script de migración de datos - Soporta ambos modos:
 *
 * 1. SAME-DB MODE: Migración entre schemas de la misma DB (más eficiente)
 *    - Usa INSERT...SELECT directo entre schemas
 *    - Ideal para: dump importado a schema temporal → schema principal
 *
 * 2. CROSS-DB MODE: Migración entre diferentes bases de datos
 *    - Fetch de source, insert en target con batching
 *    - Ideal para: producción → local
 *
 * Uso:
 *   npx tsx scripts/migrate-data.ts           # Ejecutar migración
 *   npx tsx scripts/migrate-data.ts --dry-run # Solo mostrar qué se migraría
 *   npx tsx scripts/migrate-data.ts --count   # Solo contar registros
 *
 * Variables de entorno:
 *   SOURCE_DATABASE_URL - URL de la DB origen
 *   TARGET_DATABASE_URL - URL de la DB destino
 *   SOURCE_SCHEMA       - Schema origen (default: 'public')
 *   TARGET_SCHEMA       - Schema destino (default: 'public')
 *
 * Ejemplos:
 *   # Producción a local (Cross-DB)
 *   SOURCE_DATABASE_URL="postgresql://user:pass@neon.tech/db" \
 *   TARGET_DATABASE_URL="postgresql://postgres:test@localhost/db" \
 *   npx tsx scripts/migrate-data.ts
 *
 *   # Entre schemas de misma DB (Same-DB)
 *   DATABASE_URL="postgresql://localhost/db" \
 *   SOURCE_SCHEMA=neon_import TARGET_SCHEMA=public \
 *   npx tsx scripts/migrate-data.ts
 */

import 'dotenv/config'
import { Pool, PoolClient } from 'pg'

const SOURCE_SCHEMA = process.env.SOURCE_SCHEMA || 'public'
const TARGET_SCHEMA = process.env.TARGET_SCHEMA || 'public'
const SOURCE_DB_URL = process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL
const TARGET_DB_URL = process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL
const SAME_DATABASE = SOURCE_DB_URL === TARGET_DB_URL

const BATCH_SIZE = 1000

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const COUNT_ONLY = args.includes('--count')

// Connection pools
const sourcePool = new Pool({ connectionString: SOURCE_DB_URL })
const targetPool = SAME_DATABASE ? sourcePool : new Pool({ connectionString: TARGET_DB_URL })

interface MigrationResult {
  table: string
  sourceCount: number
  targetCount: number
  success: boolean
  error?: string
}

const MIGRATION_ORDER = [
  'State', 'Route', 'Account', 'LeadPaymentType',
  'User', 'Municipality',
  'PersonalData', 'Location', 'ReportConfig', 'TelegramUser',
  'Phone', 'Address', 'Employee', 'Borrower', 'Loantype',
  'PortfolioCleanup', 'LeadPaymentReceived',
  'Loan',
  'LoanPayment', 'DocumentPhoto', 'CommissionPayment', 'Transaction',
  'FalcoCompensatoryPayment',
  'AuditLog', 'ReportExecutionLog', 'DocumentNotificationLog',
]

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

async function tableExists(client: PoolClient, schema: string, tableName: string): Promise<boolean> {
  const result = await client.query(`
    SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2)
  `, [schema, tableName])
  return result.rows[0].exists
}

async function getTableColumns(client: PoolClient, schema: string, tableName: string): Promise<string[]> {
  const result = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position
  `, [schema, tableName])
  return result.rows.map(r => r.column_name)
}

async function getExistingIds(client: PoolClient, schema: string, tableName: string): Promise<Set<string>> {
  const result = await client.query(`SELECT id FROM "${schema}"."${tableName}"`)
  return new Set(result.rows.map(r => r.id))
}

async function getNotNullColumns(client: PoolClient, schema: string, tableName: string): Promise<Set<string>> {
  const result = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO'
  `, [schema, tableName])
  return new Set(result.rows.map(r => r.column_name))
}

function getForeignKeyColumns(tableName: string): Record<string, string> {
  const fkMappings: Record<string, Record<string, string>> = {
    Municipality: { state: 'State' },
    TelegramUser: { platformUser: 'User' },
    Phone: { personalData: 'PersonalData' },
    Address: { location: 'Location', personalData: 'PersonalData' },
    Employee: { personalData: 'PersonalData', user: 'User' },
    Borrower: { personalData: 'PersonalData' },
    Location: { municipality: 'Municipality', route: 'Route' },
    PortfolioCleanup: { route: 'Route', executedBy: 'User' },
    LeadPaymentReceived: { lead: 'Employee', agent: 'Employee' },
    Loan: { borrower: 'Borrower', loantype: 'Loantype', grantor: 'Employee', lead: 'Employee', excludedByCleanup: 'PortfolioCleanup' },
    LoanPayment: { loan: 'Loan', leadPaymentReceived: 'LeadPaymentReceived' },
    DocumentPhoto: { personalData: 'PersonalData', loan: 'Loan', uploadedBy: 'User' },
    CommissionPayment: { loan: 'Loan', employee: 'Employee' },
    Transaction: { loan: 'Loan', loanPayment: 'LoanPayment', sourceAccount: 'Account', destinationAccount: 'Account', lead: 'Employee', leadPaymentReceived: 'LeadPaymentReceived' },
    FalcoCompensatoryPayment: { leadPaymentReceived: 'LeadPaymentReceived' },
    ReportExecutionLog: { reportConfig: 'ReportConfig' },
  }
  return fkMappings[tableName] || {}
}

// ============================================================================
// SAME-DB MODE: Efficient cross-schema queries
// ============================================================================

function getSameDbInsertQuery(tableName: string, sourceSchema: string, targetSchema: string): string | null {
  const src = sourceSchema
  const tgt = targetSchema

  switch (tableName) {
    case 'State':
      return `INSERT INTO "${tgt}"."State" (id, name, "createdAt", "updatedAt")
        SELECT id, name, NOW(), NOW() FROM "${src}"."State"`

    case 'Route':
      return `INSERT INTO "${tgt}"."Route" (id, name)
        SELECT id, name FROM "${src}"."Route"`

    case 'Account':
      return `INSERT INTO "${tgt}"."Account" (id, name, type, amount, "createdAt", "updatedAt")
        SELECT id, name, type::text::"${tgt}"."AccountType", amount, "createdAt", COALESCE("updatedAt", "createdAt", NOW())
        FROM "${src}"."Account"`

    case 'LeadPaymentType':
      return `INSERT INTO "${tgt}"."LeadPaymentType" (id, type)
        SELECT id, type FROM "${src}"."LeadPaymentType"`

    case 'User':
      return `INSERT INTO "${tgt}"."User" (id, name, email, password, role, "createdAt")
        SELECT id, COALESCE(name, ''), email, password, role::text::"${tgt}"."UserRole", "createdAt"
        FROM "${src}"."User"`

    case 'Municipality':
      return `INSERT INTO "${tgt}"."Municipality" (id, name, state, "createdAt", "updatedAt")
        SELECT id, name, state, NOW(), NOW() FROM "${src}"."Municipality"`

    case 'PersonalData':
      return `INSERT INTO "${tgt}"."PersonalData" (id, "fullName", "clientCode", "birthDate", "createdAt", "updatedAt")
        SELECT id, "fullName", COALESCE(NULLIF("clientCode", ''), 'AUTO-' || id), "birthDate", "createdAt", COALESCE("updatedAt", "createdAt", NOW())
        FROM "${src}"."PersonalData"`

    case 'Location':
      return `INSERT INTO "${tgt}"."Location" (id, name, municipality, route, "createdAt", "updatedAt")
        SELECT id, name, municipality, route, NOW(), NOW() FROM "${src}"."Location"`

    case 'ReportConfig':
      return `INSERT INTO "${tgt}"."ReportConfig" (id, name, "reportType", schedule, "isActive", "createdAt", "updatedAt")
        SELECT id, name, "reportType"::text, schedule, "isActive", "createdAt", COALESCE("updatedAt", "createdAt", NOW())
        FROM "${src}"."ReportConfig"`

    case 'TelegramUser':
      return `INSERT INTO "${tgt}"."TelegramUser" (id, "chatId", name, username, "isActive", "registeredAt", "lastActivity", "reportsReceived", "isInRecipientsList", notes, "platformUser", "createdAt", "updatedAt")
        SELECT t.id, t."chatId", COALESCE(t.name, ''), COALESCE(t.username, ''), t."isActive", t."registeredAt", COALESCE(t."lastActivity", NOW()), t."reportsReceived", t."isInRecipientsList", COALESCE(t.notes, ''),
          CASE WHEN EXISTS (SELECT 1 FROM "${tgt}"."User" WHERE id = t."platformUser") THEN t."platformUser" ELSE NULL END,
          NOW(), NOW()
        FROM "${src}"."TelegramUser" t`

    case 'Phone':
      return `INSERT INTO "${tgt}"."Phone" (id, number, "personalData", "createdAt", "updatedAt")
        SELECT id, COALESCE(number, ''), "personalData", "createdAt", COALESCE("updatedAt", "createdAt", NOW())
        FROM "${src}"."Phone" WHERE "personalData" IS NOT NULL`

    case 'Address':
      return `INSERT INTO "${tgt}"."Address" (id, street, "exteriorNumber", "interiorNumber", "postalCode", "references", location, "personalData", "createdAt", "updatedAt")
        SELECT id, COALESCE(street, ''), COALESCE("exteriorNumber", ''), COALESCE("interiorNumber", ''), COALESCE("postalCode", ''), COALESCE("references", ''), location, "personalData", NOW(), NOW()
        FROM "${src}"."Address" WHERE location IS NOT NULL AND "personalData" IS NOT NULL`

    case 'Employee':
      return `INSERT INTO "${tgt}"."Employee" (id, "oldId", type, "personalData", "user", "createdAt", "updatedAt")
        SELECT e.id, e."oldId", e.type::text::"${tgt}"."EmployeeType", e."personalData",
          CASE WHEN EXISTS (SELECT 1 FROM "${tgt}"."User" WHERE id = e."user") THEN e."user" ELSE NULL END, NOW(), NOW()
        FROM "${src}"."Employee" e WHERE e."personalData" IS NOT NULL`

    case 'Borrower':
      return `INSERT INTO "${tgt}"."Borrower" (id, "loanFinishedCount", "personalData", "createdAt", "updatedAt")
        SELECT id, "loanFinishedCount", "personalData", "createdAt", COALESCE("updatedAt", "createdAt", NOW())
        FROM "${src}"."Borrower"`

    case 'Loantype':
      return `INSERT INTO "${tgt}"."Loantype" (id, name, "weekDuration", rate, "loanPaymentComission", "loanGrantedComission", "createdAt", "updatedAt")
        SELECT id, name, "weekDuration", rate, "loanPaymentComission", "loanGrantedComission", "createdAt", COALESCE("updatedAt", "createdAt", NOW())
        FROM "${src}"."Loantype"`

    case 'PortfolioCleanup':
      return `INSERT INTO "${tgt}"."PortfolioCleanup" (id, name, description, "cleanupDate", "fromDate", "toDate", "excludedLoansCount", "excludedAmount", route, "executedBy", "createdAt", "updatedAt")
        SELECT p.id, p.name, COALESCE(p.description, ''), p."cleanupDate", p."fromDate", p."toDate", COALESCE(p."excludedLoansCount", 0), COALESCE(p."excludedAmount", 0), p.route, p."executedBy",
          p."createdAt", COALESCE(p."updatedAt", p."createdAt", NOW())
        FROM "${src}"."PortfolioCleanup" p
        WHERE p."executedBy" IS NOT NULL AND EXISTS (SELECT 1 FROM "${tgt}"."User" WHERE id = p."executedBy")`

    case 'LeadPaymentReceived':
      return `INSERT INTO "${tgt}"."LeadPaymentReceived" (id, "expectedAmount", "paidAmount", "cashPaidAmount", "bankPaidAmount", "falcoAmount", "paymentStatus", lead, agent, "createdAt", "updatedAt")
        SELECT lpr.id, COALESCE(lpr."expectedAmount", 0), COALESCE(lpr."paidAmount", 0), COALESCE(lpr."cashPaidAmount", 0), COALESCE(lpr."bankPaidAmount", 0), COALESCE(lpr."falcoAmount", 0), lpr."paymentStatus", lpr.lead,
          CASE WHEN EXISTS (SELECT 1 FROM "${tgt}"."Employee" WHERE id = lpr.agent) THEN lpr.agent ELSE NULL END,
          lpr."createdAt", COALESCE(lpr."updatedAt", lpr."createdAt", NOW())
        FROM "${src}"."LeadPaymentReceived" lpr
        WHERE lpr.lead IS NOT NULL AND EXISTS (SELECT 1 FROM "${tgt}"."Employee" WHERE id = lpr.lead)`

    case 'Loan':
      return `INSERT INTO "${tgt}"."Loan" (id, "oldId", "requestedAmount", "amountGived", "signDate", "finishedDate", "renewedDate", "badDebtDate", "isDeceased", "profitAmount", "totalDebtAcquired", "expectedWeeklyPayment", "totalPaid", "pendingAmountStored", "comissionAmount", status, borrower, loantype, grantor, lead, "snapshotLeadId", "snapshotLeadAssignedAt", "snapshotRouteId", "snapshotRouteName", "previousLoan", "excludedByCleanup", "createdAt", "updatedAt")
        SELECT l.id, l."oldId", COALESCE(l."requestedAmount", 0), COALESCE(l."amountGived", 0), l."signDate", l."finishedDate", l."renewedDate", l."badDebtDate", COALESCE(l."isDeceased", false), COALESCE(l."profitAmount", 0), COALESCE(l."totalDebtAcquired", 0), COALESCE(l."expectedWeeklyPayment", 0), COALESCE(l."totalPaid", 0), COALESCE(l."pendingAmountStored", 0), COALESCE(l."comissionAmount", 0), l.status::text::"${tgt}"."LoanStatus", l.borrower, l.loantype,
          CASE WHEN EXISTS (SELECT 1 FROM "${tgt}"."Employee" WHERE id = l.grantor) THEN l.grantor ELSE NULL END,
          CASE WHEN EXISTS (SELECT 1 FROM "${tgt}"."Employee" WHERE id = l.lead) THEN l.lead ELSE NULL END,
          COALESCE(l."snapshotLeadId", ''), l."snapshotLeadAssignedAt",
          CASE WHEN l."snapshotRouteId" IS NOT NULL AND l."snapshotRouteId" != '' AND EXISTS (SELECT 1 FROM "${tgt}"."Route" WHERE id = l."snapshotRouteId") THEN l."snapshotRouteId" ELSE NULL END,
          COALESCE(l."snapshotRouteName", ''), NULL,
          CASE WHEN EXISTS (SELECT 1 FROM "${tgt}"."PortfolioCleanup" WHERE id = l."excludedByCleanup") THEN l."excludedByCleanup" ELSE NULL END,
          l."createdAt", COALESCE(l."updatedAt", l."createdAt", NOW())
        FROM "${src}"."Loan" l WHERE l.borrower IS NOT NULL AND l.loantype IS NOT NULL`

    case 'LoanPayment':
      return `INSERT INTO "${tgt}"."LoanPayment" (id, amount, comission, "receivedAt", "paymentMethod", type, "oldLoanId", loan, "leadPaymentReceived", "createdAt", "updatedAt")
        SELECT lp.id, COALESCE(lp.amount, 0), COALESCE(lp.comission, 0), lp."receivedAt",
          COALESCE(NULLIF(lp."paymentMethod", ''), 'CASH')::text::"${tgt}"."PaymentMethod",
          COALESCE(lp.type, ''), lp."oldLoanId", lp.loan,
          CASE WHEN EXISTS (SELECT 1 FROM "${tgt}"."LeadPaymentReceived" WHERE id = lp."leadPaymentReceived") THEN lp."leadPaymentReceived" ELSE NULL END,
          lp."createdAt", COALESCE(lp."updatedAt", lp."createdAt", NOW())
        FROM "${src}"."LoanPayment" lp
        WHERE lp.loan IS NOT NULL AND EXISTS (SELECT 1 FROM "${tgt}"."Loan" WHERE id = lp.loan)`

    case 'DocumentPhoto':
      // Use first available user as default for NULL uploadedBy (required NOT NULL in target)
      return `INSERT INTO "${tgt}"."DocumentPhoto" (id, title, description, "photoUrl", "publicId", "documentType", "isError", "errorDescription", "isMissing", "personalData", loan, "uploadedBy", "createdAt", "updatedAt")
        SELECT d.id, COALESCE(d.title, ''), COALESCE(d.description, ''), d."photoUrl", d."publicId", d."documentType"::text::"${tgt}"."DocumentType", COALESCE(d."isError", false), COALESCE(d."errorDescription", ''), COALESCE(d."isMissing", false), d."personalData", d.loan,
          COALESCE(d."uploadedBy", (SELECT id FROM "${tgt}"."User" LIMIT 1)),
          d."createdAt", COALESCE(d."updatedAt", d."createdAt", NOW())
        FROM "${src}"."DocumentPhoto" d`

    case 'CommissionPayment':
      return `INSERT INTO "${tgt}"."CommissionPayment" (id, amount, loan, employee, "createdAt", "updatedAt")
        SELECT id, amount, loan, employee, "createdAt", COALESCE("updatedAt", "createdAt", NOW())
        FROM "${src}"."CommissionPayment"`

    case 'Transaction':
      return `INSERT INTO "${tgt}"."Transaction" (id, amount, date, type, description, "incomeSource", "expenseSource", "snapshotLeadId", "snapshotRouteId", "expenseGroupId", "profitAmount", "returnToCapital", loan, "loanPayment", "sourceAccount", "destinationAccount", route, lead, "leadPaymentReceived", "createdAt", "updatedAt")
        SELECT t.id, COALESCE(t.amount, 0), t.date, t.type::text::"${tgt}"."TransactionType", COALESCE(t.description, ''), t."incomeSource", t."expenseSource", COALESCE(t."snapshotLeadId", ''), COALESCE(t."snapshotRouteId", ''), t."expenseGroupId", COALESCE(t."profitAmount", 0), COALESCE(t."returnToCapital", 0),
          CASE WHEN EXISTS (SELECT 1 FROM "${tgt}"."Loan" WHERE id = t.loan) THEN t.loan ELSE NULL END,
          CASE WHEN EXISTS (SELECT 1 FROM "${tgt}"."LoanPayment" WHERE id = t."loanPayment") THEN t."loanPayment" ELSE NULL END,
          CASE WHEN t."sourceAccount" IS NOT NULL AND t."sourceAccount" != '' AND EXISTS (SELECT 1 FROM "${tgt}"."Account" WHERE id = t."sourceAccount") THEN t."sourceAccount"
               WHEN t."destinationAccount" IS NOT NULL AND t."destinationAccount" != '' AND EXISTS (SELECT 1 FROM "${tgt}"."Account" WHERE id = t."destinationAccount") THEN t."destinationAccount"
          END,
          CASE WHEN t."destinationAccount" IS NOT NULL AND t."destinationAccount" != '' AND EXISTS (SELECT 1 FROM "${tgt}"."Account" WHERE id = t."destinationAccount") THEN t."destinationAccount" ELSE NULL END,
          t.route,
          CASE WHEN EXISTS (SELECT 1 FROM "${tgt}"."Employee" WHERE id = t.lead) THEN t.lead ELSE NULL END,
          CASE WHEN EXISTS (SELECT 1 FROM "${tgt}"."LeadPaymentReceived" WHERE id = t."leadPaymentReceived") THEN t."leadPaymentReceived" ELSE NULL END,
          t."createdAt", COALESCE(t."updatedAt", t."createdAt", NOW())
        FROM "${src}"."Transaction" t
        WHERE t.date IS NOT NULL AND (
          (t."sourceAccount" IS NOT NULL AND t."sourceAccount" != '' AND EXISTS (SELECT 1 FROM "${tgt}"."Account" WHERE id = t."sourceAccount"))
          OR (t.type = 'INCOME' AND t."destinationAccount" IS NOT NULL AND t."destinationAccount" != '' AND EXISTS (SELECT 1 FROM "${tgt}"."Account" WHERE id = t."destinationAccount"))
          OR (t.type = 'INCOME' AND (t."sourceAccount" IS NULL OR t."sourceAccount" = '') AND (t."destinationAccount" IS NULL OR t."destinationAccount" = ''))
        )`

    case 'FalcoCompensatoryPayment':
      return `INSERT INTO "${tgt}"."FalcoCompensatoryPayment" (id, amount, "leadPaymentReceived", "createdAt", "updatedAt")
        SELECT f.id, f.amount, f."leadPaymentReceived", f."createdAt", COALESCE(f."updatedAt", f."createdAt", NOW())
        FROM "${src}"."FalcoCompensatoryPayment" f
        WHERE EXISTS (SELECT 1 FROM "${tgt}"."LeadPaymentReceived" WHERE id = f."leadPaymentReceived")`

    case 'AuditLog':
      return `INSERT INTO "${tgt}"."AuditLog" (id, operation, "modelName", "recordId", "userName", "userEmail", "userRole", "sessionId", "ipAddress", "userAgent", "previousValues", "newValues", "changedFields", description, metadata, "user", "createdAt")
        SELECT id, operation, COALESCE("modelName", ''), COALESCE("recordId", ''), COALESCE("userName", ''), COALESCE("userEmail", ''), COALESCE("userRole", ''), COALESCE("sessionId", ''), COALESCE("ipAddress", ''), COALESCE("userAgent", ''), "previousValues", "newValues", "changedFields", COALESCE(description, ''), metadata, "user", "createdAt"
        FROM "${src}"."AuditLog"`

    case 'ReportExecutionLog':
      return `INSERT INTO "${tgt}"."ReportExecutionLog" (id, status, "executionType", message, "errorDetails", "recipientsCount", "successfulDeliveries", "failedDeliveries", "startTime", "endTime", duration, "cronExpression", timezone, "reportConfig", "createdAt", "updatedAt")
        SELECT id, status, "executionType", COALESCE(message, ''), COALESCE("errorDetails", ''), "recipientsCount", "successfulDeliveries", "failedDeliveries", "startTime", "endTime", duration, COALESCE("cronExpression", ''), COALESCE(timezone, ''), "reportConfig", "createdAt", COALESCE("updatedAt", "createdAt", NOW())
        FROM "${src}"."ReportExecutionLog"`

    case 'DocumentNotificationLog':
      return `INSERT INTO "${tgt}"."DocumentNotificationLog" (id, "documentId", "documentType", "personalDataId", "personName", "loanId", "routeId", "routeName", "localityName", "routeLeadId", "routeLeadName", "routeLeadUserId", "telegramUserId", "telegramChatId", "telegramUsername", "issueType", description, "messageContent", status, "telegramResponse", "telegramErrorCode", "telegramErrorMessage", "sentAt", "responseTimeMs", "retryCount", "lastRetryAt", notes, "createdAt", "updatedAt")
        SELECT id, COALESCE("documentId", ''), COALESCE("documentType", ''), COALESCE("personalDataId", ''), COALESCE("personName", ''), COALESCE("loanId", ''), COALESCE("routeId", ''), COALESCE("routeName", ''), COALESCE("localityName", ''), COALESCE("routeLeadId", ''), COALESCE("routeLeadName", ''), COALESCE("routeLeadUserId", ''), COALESCE("telegramUserId", ''), COALESCE("telegramChatId", ''), COALESCE("telegramUsername", ''), "issueType", COALESCE(description, ''), COALESCE("messageContent", ''), status, COALESCE("telegramResponse", ''), "telegramErrorCode", COALESCE("telegramErrorMessage", ''), "sentAt", "responseTimeMs", "retryCount", "lastRetryAt", COALESCE(notes, ''), "createdAt", COALESCE("updatedAt", "createdAt", NOW())
        FROM "${src}"."DocumentNotificationLog"`

    default:
      return null
  }
}

async function migrateTableSameDb(tableName: string): Promise<MigrationResult> {
  const client = await sourcePool.connect()
  try {
    if (!await tableExists(client, SOURCE_SCHEMA, tableName)) {
      return { table: tableName, sourceCount: 0, targetCount: 0, success: true, error: 'No existe en origen' }
    }

    const countResult = await client.query(`SELECT COUNT(*)::int as count FROM "${SOURCE_SCHEMA}"."${tableName}"`)
    const sourceCount = countResult.rows[0].count

    if (sourceCount === 0) {
      return { table: tableName, sourceCount: 0, targetCount: 0, success: true }
    }

    const insertQuery = getSameDbInsertQuery(tableName, SOURCE_SCHEMA, TARGET_SCHEMA)
    if (!insertQuery) {
      return { table: tableName, sourceCount, targetCount: 0, success: false, error: 'No hay query definido' }
    }

    await client.query(insertQuery)

    const targetCountResult = await client.query(`SELECT COUNT(*)::int as count FROM "${TARGET_SCHEMA}"."${tableName}"`)
    return { table: tableName, sourceCount, targetCount: targetCountResult.rows[0].count, success: true }
  } catch (error) {
    return { table: tableName, sourceCount: 0, targetCount: 0, success: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    client.release()
  }
}

// ============================================================================
// CROSS-DB MODE: Fetch and insert with batching
// ============================================================================

function transformRow(tableName: string, row: Record<string, any>, fkSets: Record<string, Set<string>>): Record<string, any> | null {
  const result = { ...row }

  // Convert string 'null' to actual null for all FK columns
  for (const col of Object.keys(fkSets)) {
    if (result[col] === 'null' || result[col] === '') result[col] = null
  }

  // Helper to check if value is effectively null
  const isNullish = (val: any) => val === null || val === undefined || val === 'null' || val === ''

  // Table-specific filters
  switch (tableName) {
    case 'Phone': if (!row.personalData) return null; break
    case 'Address': if (!row.location || !row.personalData) return null; break
    case 'Employee': if (!row.personalData) return null; break
    case 'Loan': if (!row.borrower || !row.loantype) return null; break
    case 'LoanPayment': if (!row.loan) return null; break
    // DocumentPhoto: uploadedBy handled with COALESCE in query (uses first User as default)
    case 'Transaction':
      if (!row.date) return null
      // Check if accounts are valid (not nullish AND exist in target)
      const srcAcct = isNullish(row.sourceAccount) ? null : row.sourceAccount
      const dstAcct = isNullish(row.destinationAccount) ? null : row.destinationAccount
      const hasValidSource = srcAcct && fkSets.sourceAccount?.has(srcAcct)
      const hasValidDest = dstAcct && fkSets.destinationAccount?.has(dstAcct)
      // INCOME transactions can have no accounts (payment records, etc)
      const isIncomeWithoutAccount = row.type === 'INCOME' && !srcAcct && !dstAcct
      // INCOME transactions with valid destination are allowed
      const isIncomeWithValidDest = row.type === 'INCOME' && hasValidDest
      if (!hasValidSource && !hasValidDest && !isIncomeWithoutAccount && !isIncomeWithValidDest) return null
      break
  }

  // Nullify invalid FK references
  for (const [col, refSet] of Object.entries(fkSets)) {
    if (result[col] && result[col] !== 'null' && !refSet.has(result[col])) result[col] = null
  }

  // Default values for NOT NULL columns
  const now = new Date()

  // String fields
  if (result.name === null || result.name === undefined) result.name = ''
  if (result.description === null || result.description === undefined) result.description = ''
  if (result.notes === null || result.notes === undefined) result.notes = ''
  if (result.fullName === null || result.fullName === undefined) result.fullName = ''
  if (result.street === null || result.street === undefined) result.street = ''

  // Timestamps
  if (result.createdAt === null || result.createdAt === undefined) result.createdAt = now
  if (result.updatedAt === null || result.updatedAt === undefined) result.updatedAt = result.createdAt || now

  // Numeric fields
  if (result.amount === null || result.amount === undefined) result.amount = 0
  if (result.comission === null || result.comission === undefined) result.comission = 0
  if (result.comissionAmount === null || result.comissionAmount === undefined) result.comissionAmount = 0
  if (result.excludedLoansCount === null || result.excludedLoansCount === undefined) result.excludedLoansCount = 0
  if (result.excludedAmount === null || result.excludedAmount === undefined) result.excludedAmount = 0
  if (result.loanFinishedCount === null || result.loanFinishedCount === undefined) result.loanFinishedCount = 0

  // Table-specific defaults
  if (tableName === 'LoanPayment' && !result.paymentMethod) result.paymentMethod = 'CASH'
  if (tableName === 'PersonalData' && (!result.clientCode || result.clientCode === '')) {
    result.clientCode = 'AUTO-' + result.id
  }
  // DocumentPhoto.uploadedBy is NOT NULL in target but nullable in source
  // Will be resolved in migrateTableCrossDb using first User as default
  if (tableName === 'DocumentPhoto' && !result.uploadedBy) {
    result.uploadedBy = '__NEEDS_DEFAULT_USER__'
  }

  return result
}

async function migrateTableCrossDb(tableName: string): Promise<MigrationResult> {
  const sourceClient = await sourcePool.connect()
  const targetClient = await targetPool.connect()

  try {
    if (!await tableExists(sourceClient, SOURCE_SCHEMA, tableName)) {
      return { table: tableName, sourceCount: 0, targetCount: 0, success: true, error: 'No existe en origen' }
    }

    const countResult = await sourceClient.query(`SELECT COUNT(*)::int as count FROM "${SOURCE_SCHEMA}"."${tableName}"`)
    const sourceCount = countResult.rows[0].count

    if (sourceCount === 0) {
      return { table: tableName, sourceCount: 0, targetCount: 0, success: true }
    }

    const sourceColumns = await getTableColumns(sourceClient, SOURCE_SCHEMA, tableName)
    const targetColumns = await getTableColumns(targetClient, TARGET_SCHEMA, tableName)
    const notNullColumns = await getNotNullColumns(targetClient, TARGET_SCHEMA, tableName)
    const commonColumns = sourceColumns.filter(c => targetColumns.includes(c))

    if (commonColumns.length === 0) {
      return { table: tableName, sourceCount, targetCount: 0, success: false, error: 'No hay columnas comunes' }
    }

    // Find NOT NULL columns in target that don't exist in source - we need to provide defaults
    const missingNotNull = [...notNullColumns].filter(c => !sourceColumns.includes(c) && c !== 'id')

    // Build insert columns - common columns + missing NOT NULL columns
    const insertColumns = [...commonColumns, ...missingNotNull]
    const quotedInsertColumns = insertColumns.map(c => `"${c}"`).join(', ')
    const placeholders = insertColumns.map((_, i) => `$${i + 1}`).join(', ')

    // Load FK reference sets
    const fkSets: Record<string, Set<string>> = {}
    for (const [col, refTable] of Object.entries(getForeignKeyColumns(tableName))) {
      if (commonColumns.includes(col)) {
        fkSets[col] = await getExistingIds(targetClient, TARGET_SCHEMA, refTable)
      }
    }

    // Get default User ID for DocumentPhoto.uploadedBy fallback
    let defaultUserId: string | null = null
    if (tableName === 'DocumentPhoto') {
      const userResult = await targetClient.query(`SELECT id FROM "${TARGET_SCHEMA}"."User" LIMIT 1`)
      defaultUserId = userResult.rows[0]?.id || null
    }

    // Fetch source columns for SELECT
    const quotedSourceColumns = commonColumns.map(c => `"${c}"`).join(', ')

    let offset = 0
    let insertedCount = 0
    let errorCount = 0
    let lastError = ''

    while (offset < sourceCount) {
      const batch = await sourceClient.query(
        `SELECT ${quotedSourceColumns} FROM "${SOURCE_SCHEMA}"."${tableName}" ORDER BY "id" LIMIT ${BATCH_SIZE} OFFSET ${offset}`
      )

      for (const row of batch.rows) {
        const transformed = transformRow(tableName, row, fkSets)
        if (!transformed) continue

        // Replace placeholder with actual default User ID for DocumentPhoto
        if (tableName === 'DocumentPhoto' && transformed.uploadedBy === '__NEEDS_DEFAULT_USER__') {
          if (!defaultUserId) continue // Skip if no default user available
          transformed.uploadedBy = defaultUserId
        }

        // Add default values for missing NOT NULL columns
        const now = new Date()
        for (const col of missingNotNull) {
          if (col === 'createdAt' || col === 'updatedAt') {
            transformed[col] = transformed[col] || now
          } else if (col === 'name' || col === 'description' || col === 'notes') {
            transformed[col] = transformed[col] || ''
          }
        }

        try {
          await targetClient.query(
            `INSERT INTO "${TARGET_SCHEMA}"."${tableName}" (${quotedInsertColumns}) VALUES (${placeholders})`,
            insertColumns.map(col => transformed[col])
          )
          insertedCount++
        } catch (err) {
          errorCount++
          lastError = err instanceof Error ? err.message : String(err)
          // Log first few errors for debugging
          if (errorCount <= 3) {
            console.error(`\n   ⚠️  ${tableName} INSERT error: ${lastError}`)
          }
        }
      }

      offset += BATCH_SIZE
      process.stdout.write(`\r   ${tableName}... ${Math.min(offset, sourceCount)}/${sourceCount}`)
    }

    const targetCountResult = await targetClient.query(`SELECT COUNT(*)::int as count FROM "${TARGET_SCHEMA}"."${tableName}"`)
    const result: MigrationResult = { table: tableName, sourceCount, targetCount: targetCountResult.rows[0].count, success: true }

    if (errorCount > 0) {
      result.error = `${errorCount} errores (último: ${lastError.slice(0, 50)}...)`
    }

    return result
  } catch (error) {
    return { table: tableName, sourceCount: 0, targetCount: 0, success: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    sourceClient.release()
    targetClient.release()
  }
}

// ============================================================================
// JUNCTION TABLES & EMPLOYEE ROUTES
// ============================================================================

async function migrateJunctionTable(sourceTable: string, targetTable: string): Promise<MigrationResult> {
  const sourceClient = await sourcePool.connect()
  const targetClient = await targetPool.connect()

  try {
    if (!await tableExists(sourceClient, SOURCE_SCHEMA, sourceTable)) {
      return { table: `${sourceTable}→${targetTable}`, sourceCount: 0, targetCount: 0, success: true, error: 'No existe' }
    }

    const countResult = await sourceClient.query(`SELECT COUNT(*)::int as count FROM "${SOURCE_SCHEMA}"."${sourceTable}"`)
    const sourceCount = countResult.rows[0].count

    if (sourceCount === 0) {
      return { table: `${sourceTable}→${targetTable}`, sourceCount: 0, targetCount: 0, success: true }
    }

    let errorCount = 0
    let lastError = ''

    if (SAME_DATABASE) {
      await sourceClient.query(`
        INSERT INTO "${TARGET_SCHEMA}"."${targetTable}" ("A", "B")
        SELECT "A", "B" FROM "${SOURCE_SCHEMA}"."${sourceTable}"
      `)
    } else {
      const records = await sourceClient.query(`SELECT "A", "B" FROM "${SOURCE_SCHEMA}"."${sourceTable}"`)
      for (const row of records.rows) {
        try {
          await targetClient.query(
            `INSERT INTO "${TARGET_SCHEMA}"."${targetTable}" ("A", "B") VALUES ($1, $2)`,
            [row.A, row.B]
          )
        } catch (err) {
          errorCount++
          lastError = err instanceof Error ? err.message : String(err)
          if (errorCount <= 2) console.error(`\n   ⚠️  ${targetTable} error: ${lastError}`)
        }
      }
    }

    const targetCountResult = await targetClient.query(`SELECT COUNT(*)::int as count FROM "${TARGET_SCHEMA}"."${targetTable}"`)
    return { table: `${sourceTable}→${targetTable}`, sourceCount, targetCount: targetCountResult.rows[0].count, success: true }
  } catch (error) {
    return { table: `${sourceTable}→${targetTable}`, sourceCount: 0, targetCount: 0, success: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    sourceClient.release()
    targetClient.release()
  }
}

async function migrateEmployeeRoutes(): Promise<MigrationResult> {
  const sourceClient = await sourcePool.connect()
  const targetClient = await targetPool.connect()

  try {
    if (SAME_DATABASE) {
      await sourceClient.query(`
        INSERT INTO "${TARGET_SCHEMA}"."_RouteEmployees" ("A", "B")
        SELECT e.id, e.routes FROM "${SOURCE_SCHEMA}"."Employee" e
        WHERE e.routes IS NOT NULL
          AND EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."Employee" WHERE id = e.id)
          AND EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."Route" WHERE id = e.routes)
      `)
    } else {
      const result = await sourceClient.query(`SELECT id, routes FROM "${SOURCE_SCHEMA}"."Employee" WHERE routes IS NOT NULL`)
      const targetEmployees = await getExistingIds(targetClient, TARGET_SCHEMA, 'Employee')
      const targetRoutes = await getExistingIds(targetClient, TARGET_SCHEMA, 'Route')

      let errorCount = 0
      for (const row of result.rows) {
        if (targetEmployees.has(row.id) && targetRoutes.has(row.routes)) {
          try {
            await targetClient.query(
              `INSERT INTO "${TARGET_SCHEMA}"."_RouteEmployees" ("A", "B") VALUES ($1, $2)`,
              [row.id, row.routes]
            )
          } catch (err) {
            errorCount++
            if (errorCount <= 2) console.error(`\n   ⚠️  _RouteEmployees error: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
      }
    }

    const countResult = await targetClient.query(`SELECT COUNT(*)::int as count FROM "${TARGET_SCHEMA}"."_RouteEmployees"`)
    return { table: 'Employee Routes', sourceCount: 0, targetCount: countResult.rows[0].count, success: true }
  } catch (error) {
    return { table: 'Employee Routes', sourceCount: 0, targetCount: 0, success: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    sourceClient.release()
    targetClient.release()
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function cleanTargetSchema(): Promise<void> {
  console.log('🧹 Limpiando tablas del destino...\n')
  const client = await targetPool.connect()

  const cleanOrder = [
    '_LoanCollaterals', '_RouteAccounts', '_ReportConfigRoutes', '_ReportConfigRecipients', '_RouteEmployees',
    ...MIGRATION_ORDER.slice().reverse(),
  ]

  let truncatedCount = 0
  let skippedCount = 0

  for (const tableName of cleanOrder) {
    try {
      const exists = await tableExists(client, TARGET_SCHEMA, tableName)
      if (exists) {
        // Contar registros antes del truncate
        const countBefore = await client.query(`SELECT COUNT(*)::int as count FROM "${TARGET_SCHEMA}"."${tableName}"`)
        const recordsBefore = countBefore.rows[0].count

        await client.query(`TRUNCATE TABLE "${TARGET_SCHEMA}"."${tableName}" CASCADE`)
        truncatedCount++
        console.log(`   ✅ ${tableName} (${recordsBefore} registros eliminados)`)
      } else {
        skippedCount++
        console.log(`   ⏭️  ${tableName} (no existe)`)
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.log(`   ❌ ${tableName}: ${msg}`)
    }
  }

  client.release()
  console.log(`\n   📊 Resumen: ${truncatedCount} tablas truncadas, ${skippedCount} omitidas\n`)
}

async function countSourceRecords(): Promise<void> {
  console.log('📊 Contando registros en origen...\n')
  const client = await sourcePool.connect()

  let total = 0
  for (const tableName of MIGRATION_ORDER) {
    try {
      if (await tableExists(client, SOURCE_SCHEMA, tableName)) {
        const result = await client.query(`SELECT COUNT(*)::int as count FROM "${SOURCE_SCHEMA}"."${tableName}"`)
        total += result.rows[0].count
        console.log(`   ${tableName}: ${result.rows[0].count.toLocaleString()}`)
      } else {
        console.log(`   ${tableName}: (no existe)`)
      }
    } catch {
      console.log(`   ${tableName}: ❌ Error`)
    }
  }

  console.log(`\n   TOTAL: ${total.toLocaleString()} registros`)
  client.release()
}

function maskUrl(url: string | undefined): string {
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
  console.log(`   Source: ${maskUrl(SOURCE_DB_URL)} (${SOURCE_SCHEMA})`)
  console.log(`   Target: ${SAME_DATABASE ? '(misma DB)' : maskUrl(TARGET_DB_URL)} (${TARGET_SCHEMA})`)
  console.log(`   Mode:   ${SAME_DATABASE ? '⚡ Same-DB (INSERT...SELECT)' : '🌐 Cross-DB (fetch+insert)'}`)
  console.log('')

  try {
    await sourcePool.query('SELECT 1')
    console.log('   ✅ Conexión origen OK')
    if (!SAME_DATABASE) {
      await targetPool.query('SELECT 1')
      console.log('   ✅ Conexión destino OK')
    }
    console.log('')
  } catch (error) {
    console.error('   ❌ Error de conexión:', error)
    process.exit(1)
  }

  if (COUNT_ONLY) {
    await countSourceRecords()
    await sourcePool.end()
    if (!SAME_DATABASE) await targetPool.end()
    return
  }

  if (DRY_RUN) {
    await countSourceRecords()
    console.log('\n⚠️  Modo DRY-RUN: No se ejecutaron cambios.\n')
    await sourcePool.end()
    if (!SAME_DATABASE) await targetPool.end()
    return
  }

  await cleanTargetSchema()

  const results: MigrationResult[] = []
  const migrateTable = SAME_DATABASE ? migrateTableSameDb : migrateTableCrossDb

  console.log('📋 Migrando tablas principales...\n')
  for (const tableName of MIGRATION_ORDER) {
    const result = await migrateTable(tableName)
    results.push(result)
    console.log(result.success
      ? (result.error ? `\r   ${tableName}... ⚠️  ${result.error}` : `\r   ${tableName}... ✅ ${result.sourceCount} → ${result.targetCount}`)
      : `\r   ${tableName}... ❌ ${result.error}`)
  }

  console.log('\n📋 Migrando relaciones M:M...\n')

  const empRoutes = await migrateEmployeeRoutes()
  results.push(empRoutes)
  console.log(`   Employee Routes: ${empRoutes.success ? '✅' : '❌'} → ${empRoutes.targetCount}`)

  const junctionTables = [
    ['_Loan_collaterals', '_LoanCollaterals'],
    ['_Account_routes', '_RouteAccounts'],
    ['_ReportConfig_routes', '_ReportConfigRoutes'],
    ['_ReportConfig_telegramUsers', '_ReportConfigRecipients'],
  ]

  for (const [src, tgt] of junctionTables) {
    const result = await migrateJunctionTable(src, tgt)
    results.push(result)
    console.log(`   ${src}: ${result.success ? '✅' : '❌'} ${result.sourceCount} → ${result.targetCount}`)
  }

  console.log('\n' + '='.repeat(60))
  console.log('📊 RESUMEN')
  console.log('='.repeat(60))

  const successful = results.filter(r => r.success && !r.error).length
  const warnings = results.filter(r => r.success && r.error).length
  const failed = results.filter(r => !r.success).length

  console.log(`\n   ✅ Exitosas: ${successful}`)
  console.log(`   ⚠️  Advertencias: ${warnings}`)
  console.log(`   ❌ Fallidas: ${failed}`)

  const totalSource = results.reduce((sum, r) => sum + r.sourceCount, 0)
  const totalTarget = results.reduce((sum, r) => sum + r.targetCount, 0)
  console.log(`\n   Total: ${totalSource.toLocaleString()} → ${totalTarget.toLocaleString()} registros`)

  await sourcePool.end()
  if (!SAME_DATABASE) await targetPool.end()
  console.log('\n✅ Migración completada!\n')
}

main().catch(console.error)
