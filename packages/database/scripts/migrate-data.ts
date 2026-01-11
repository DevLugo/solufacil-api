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
 *   npx tsx scripts/migrate-data.ts --export  # Después de migrar, exportar dump SQL
 *   npx tsx scripts/migrate-data.ts --export-only # Solo exportar (sin migrar)
 *
 * Variables de entorno:
 *   SOURCE_DATABASE_URL - URL de la DB origen
 *   TARGET_DATABASE_URL - URL de la DB destino
 *   SOURCE_SCHEMA       - Schema origen (default: 'public')
 *   TARGET_SCHEMA       - Schema destino (default: 'public')
 *   DUMP_FILE           - Archivo de salida para --export (default: migration-dump.sql)
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
 *
 *   # Migrar y exportar dump para subir a remote
 *   npx tsx scripts/migrate-data.ts --export
 *
 *   # Solo exportar dump de DB local (datos ya migrados)
 *   DATABASE_URL="postgresql://localhost/db" \
 *   npx tsx scripts/migrate-data.ts --export-only
 */

import 'dotenv/config'
import { Pool, PoolClient } from 'pg'
import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

const SOURCE_SCHEMA = process.env.SOURCE_SCHEMA || 'public'
const TARGET_SCHEMA = process.env.TARGET_SCHEMA || 'public'
const SOURCE_DB_URL = process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL
const TARGET_DB_URL = process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL
const SAME_DATABASE = SOURCE_DB_URL === TARGET_DB_URL

const BATCH_SIZE = 20000  // Rows to fetch per query from source
const INSERT_BATCH_SIZE = 2000  // Rows per multi-row INSERT (PostgreSQL limit ~65K params, Transaction has ~20 cols = max ~3200)

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const COUNT_ONLY = args.includes('--count')
const EXPORT_AFTER = args.includes('--export')
const EXPORT_ONLY = args.includes('--export-only')
const UPLOAD_TO_REMOTE = args.includes('--upload')
const DUMP_FILE = process.env.DUMP_FILE || 'migration-dump.sql'
const REMOTE_DB_URL = process.env.REMOTE_DATABASE_URL

// Connection pools with optimized settings for long-running migrations
const poolConfig = {
  max: 10,  // More connections for parallel operations
  idleTimeoutMillis: 0,  // Never timeout idle connections during migration
  connectionTimeoutMillis: 60000,  // 60s to establish connection
  keepAlive: true,  // Enable TCP keep-alive to prevent connection drops
  keepAliveInitialDelayMillis: 10000,  // Start keep-alive after 10s of inactivity
}

const sourcePool = new Pool({ connectionString: SOURCE_DB_URL, ...poolConfig })
const targetPool = SAME_DATABASE ? sourcePool : new Pool({ connectionString: TARGET_DB_URL, ...poolConfig })

// Handle pool errors gracefully
sourcePool.on('error', (err) => {
  console.error('Source pool error:', err.message)
})
if (!SAME_DATABASE) {
  targetPool.on('error', (err) => {
    console.error('Target pool error:', err.message)
  })
}

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
  'AccountEntry',  // Nueva tabla de ledger - después de Transaction
  'FalcoCompensatoryPayment',
  'AuditLog', 'ReportExecutionLog', 'DocumentNotificationLog',
]

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if an error is a connection-related error that might be retriable
 */
function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const message = err.message.toLowerCase()
  return (
    message.includes('connection terminated') ||
    message.includes('connection refused') ||
    message.includes('connection reset') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('socket hang up') ||
    message.includes('client has encountered a connection error')
  )
}

/**
 * Retry a migration with exponential backoff for connection errors
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  tableName: string,
  maxRetries = 3
): Promise<T> {
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (isConnectionError(err) && attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000) // 1s, 2s, 4s... max 10s
        console.log(`\n   ⚠️  ${tableName}: Connection error, retrying in ${delay / 1000}s (attempt ${attempt}/${maxRetries})...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      } else {
        throw err
      }
    }
  }
  throw lastError
}

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
    Loan: { borrower: 'Borrower', loantype: 'Loantype', grantor: 'Employee', lead: 'Employee', excludedByCleanup: 'PortfolioCleanup', previousLoan: 'Loan' },
    LoanPayment: { loan: 'Loan', leadPaymentReceived: 'LeadPaymentReceived' },
    DocumentPhoto: { personalData: 'PersonalData', loan: 'Loan', uploadedBy: 'User' },
    CommissionPayment: { loan: 'Loan', employee: 'Employee' },
    Transaction: { loan: 'Loan', loanPayment: 'LoanPayment', sourceAccount: 'Account', destinationAccount: 'Account', lead: 'Employee', leadPaymentReceived: 'LeadPaymentReceived' },
    AccountEntry: { accountId: 'Account', loanId: 'Loan', loanPaymentId: 'LoanPayment', leadPaymentReceivedId: 'LeadPaymentReceived', destinationAccountId: 'Account' },
    FalcoCompensatoryPayment: { leadPaymentReceived: 'LeadPaymentReceived' },
    ReportExecutionLog: { reportConfig: 'ReportConfig' },
  }
  return fkMappings[tableName] || {}
}

/**
 * Load all FK reference sets in parallel for better performance over network
 */
async function loadFkSetsParallel(
  client: PoolClient,
  tableName: string,
  schema: string,
  columns: string[]
): Promise<Record<string, Set<string>>> {
  const fkMappings = getForeignKeyColumns(tableName)
  const relevantFks = Object.entries(fkMappings).filter(([col]) => columns.includes(col))

  if (relevantFks.length === 0) return {}

  // Load all FK sets in parallel
  const results = await Promise.all(
    relevantFks.map(async ([col, refTable]) => {
      const ids = await getExistingIds(client, schema, refTable)
      return [col, ids] as const
    })
  )

  return Object.fromEntries(results)
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
      // Verificar que personalData exista en destino para evitar FK errors
      return `INSERT INTO "${tgt}"."Phone" (id, number, "personalData", "createdAt", "updatedAt")
        SELECT p.id, COALESCE(p.number, ''), p."personalData", p."createdAt", COALESCE(p."updatedAt", p."createdAt", NOW())
        FROM "${src}"."Phone" p
        WHERE p."personalData" IS NOT NULL
          AND EXISTS (SELECT 1 FROM "${tgt}"."PersonalData" WHERE id = p."personalData")`

    case 'Address':
      // Verificar que location y personalData existan en destino para evitar FK errors
      return `INSERT INTO "${tgt}"."Address" (id, street, "exteriorNumber", "interiorNumber", "postalCode", "references", location, "personalData", "createdAt", "updatedAt")
        SELECT a.id, COALESCE(a.street, ''), COALESCE(a."exteriorNumber", ''), COALESCE(a."interiorNumber", ''), COALESCE(a."postalCode", ''), COALESCE(a."references", ''), a.location, a."personalData", NOW(), NOW()
        FROM "${src}"."Address" a
        WHERE a.location IS NOT NULL AND a."personalData" IS NOT NULL
          AND EXISTS (SELECT 1 FROM "${tgt}"."Location" WHERE id = a.location)
          AND EXISTS (SELECT 1 FROM "${tgt}"."PersonalData" WHERE id = a."personalData")`

    case 'Employee':
      // Verificar que personalData exista en destino para evitar FK errors
      return `INSERT INTO "${tgt}"."Employee" (id, "oldId", type, "personalData", "user", "createdAt", "updatedAt")
        SELECT e.id, e."oldId", e.type::text::"${tgt}"."EmployeeType", e."personalData",
          CASE WHEN EXISTS (SELECT 1 FROM "${tgt}"."User" WHERE id = e."user") THEN e."user" ELSE NULL END, NOW(), NOW()
        FROM "${src}"."Employee" e
        WHERE e."personalData" IS NOT NULL
          AND EXISTS (SELECT 1 FROM "${tgt}"."PersonalData" WHERE id = e."personalData")`

    case 'Borrower':
      // Verificar que personalData exista en destino para evitar FK errors
      return `INSERT INTO "${tgt}"."Borrower" (id, "loanFinishedCount", "personalData", "createdAt", "updatedAt")
        SELECT b.id, b."loanFinishedCount", b."personalData", b."createdAt", COALESCE(b."updatedAt", b."createdAt", NOW())
        FROM "${src}"."Borrower" b
        WHERE b."personalData" IS NOT NULL
          AND EXISTS (SELECT 1 FROM "${tgt}"."PersonalData" WHERE id = b."personalData")`

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
      // NOTA: previousLoan se inserta como NULL inicialmente, luego se actualiza en un segundo paso
      // Esto evita problemas de FK ya que el préstamo referenciado podría no existir aún
      // También verificamos que borrower y loantype EXISTAN en destino para evitar FK errors
      return `INSERT INTO "${tgt}"."Loan" (id, "oldId", "requestedAmount", "amountGived", "signDate", "finishedDate", "renewedDate", "badDebtDate", "isDeceased", "profitAmount", "totalDebtAcquired", "expectedWeeklyPayment", "totalPaid", "pendingAmountStored", "comissionAmount", status, borrower, loantype, grantor, lead, "snapshotLeadId", "snapshotLeadAssignedAt", "previousLoan", "excludedByCleanup", "createdAt", "updatedAt")
        SELECT l.id, l."oldId", COALESCE(l."requestedAmount", 0), COALESCE(l."amountGived", 0), l."signDate", l."finishedDate", l."renewedDate", l."badDebtDate", COALESCE(l."isDeceased", false), COALESCE(l."profitAmount", 0), COALESCE(l."totalDebtAcquired", 0), COALESCE(l."expectedWeeklyPayment", 0), COALESCE(l."totalPaid", 0), COALESCE(l."pendingAmountStored", 0), COALESCE(l."comissionAmount", 0), l.status::text::"${tgt}"."LoanStatus", l.borrower, l.loantype,
          CASE WHEN EXISTS (SELECT 1 FROM "${tgt}"."Employee" WHERE id = l.grantor) THEN l.grantor ELSE NULL END,
          CASE WHEN EXISTS (SELECT 1 FROM "${tgt}"."Employee" WHERE id = l.lead) THEN l.lead ELSE NULL END,
          COALESCE(l."snapshotLeadId", ''), l."snapshotLeadAssignedAt", NULL,
          CASE WHEN EXISTS (SELECT 1 FROM "${tgt}"."PortfolioCleanup" WHERE id = l."excludedByCleanup") THEN l."excludedByCleanup" ELSE NULL END,
          l."createdAt", COALESCE(l."updatedAt", l."createdAt", NOW())
        FROM "${src}"."Loan" l
        WHERE l.borrower IS NOT NULL
          AND l.loantype IS NOT NULL
          AND EXISTS (SELECT 1 FROM "${tgt}"."Borrower" WHERE id = l.borrower)
          AND EXISTS (SELECT 1 FROM "${tgt}"."Loantype" WHERE id = l.loantype);

        -- Segundo paso: Actualizar previousLoan ahora que todos los préstamos existen
        -- Usa ROW_NUMBER para evitar duplicados (unique constraint en previousLoan)
        UPDATE "${tgt}"."Loan" tgt
        SET "previousLoan" = ranked.prev_loan
        FROM (
          SELECT id, "previousLoan" as prev_loan,
            ROW_NUMBER() OVER (PARTITION BY "previousLoan" ORDER BY "createdAt" DESC) as rn
          FROM "${src}"."Loan"
          WHERE "previousLoan" IS NOT NULL
            AND EXISTS (SELECT 1 FROM "${tgt}"."Loan" WHERE id = "${src}"."Loan"."previousLoan")
        ) ranked
        WHERE tgt.id = ranked.id
          AND ranked.rn = 1
          AND NOT EXISTS (SELECT 1 FROM "${tgt}"."Loan" WHERE "previousLoan" = ranked.prev_loan)`

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
      // Solo migrar transacciones que tengan sourceAccount (requerido en schema)
      // Sin validación de FK - insertar todo directamente
      return `INSERT INTO "${tgt}"."Transaction" (id, amount, date, type, description, "incomeSource", "expenseSource", "snapshotLeadId", "snapshotRouteId", "expenseGroupId", "profitAmount", "returnToCapital", loan, "loanPayment", "sourceAccount", "destinationAccount", route, lead, "leadPaymentReceived", "createdAt", "updatedAt")
        SELECT t.id, COALESCE(t.amount, 0), t.date, t.type::text::"${tgt}"."TransactionType", COALESCE(t.description, ''), t."incomeSource", t."expenseSource",
          COALESCE(NULLIF(t."snapshotLeadId", ''), t.lead, ''),
          COALESCE(NULLIF(t."snapshotRouteId", ''), t.route, ''),
          t."expenseGroupId", COALESCE(t."profitAmount", 0), COALESCE(t."returnToCapital", 0),
          t.loan,
          t."loanPayment",
          t."sourceAccount",
          t."destinationAccount",
          t.route,
          t.lead,
          t."leadPaymentReceived",
          t."createdAt", COALESCE(t."updatedAt", t."createdAt", NOW())
        FROM "${src}"."Transaction" t
        WHERE t.date IS NOT NULL
          AND t."sourceAccount" IS NOT NULL
          AND t."sourceAccount" != ''`

    case 'AccountEntry':
      return `INSERT INTO "${tgt}"."AccountEntry" (
        id, "accountId", amount, "entryType", "sourceType",
        "profitAmount", "returnToCapital",
        "snapshotLeadId", "snapshotRouteId",
        "entryDate", description,
        "loanId", "loanPaymentId", "leadPaymentReceivedId", "destinationAccountId",
        "syncId", "createdAt"
      )
      SELECT
        e.id, e."accountId", e.amount,
        e."entryType"::text::"${tgt}"."AccountEntryType",
        e."sourceType"::text::"${tgt}"."SourceType",
        COALESCE(e."profitAmount", 0),
        COALESCE(e."returnToCapital", 0),
        COALESCE(e."snapshotLeadId", ''),
        COALESCE(e."snapshotRouteId", ''),
        e."entryDate",
        COALESCE(e.description, ''),
        CASE WHEN EXISTS (SELECT 1 FROM "${tgt}"."Loan" WHERE id = e."loanId") THEN e."loanId" ELSE NULL END,
        CASE WHEN EXISTS (SELECT 1 FROM "${tgt}"."LoanPayment" WHERE id = e."loanPaymentId") THEN e."loanPaymentId" ELSE NULL END,
        CASE WHEN EXISTS (SELECT 1 FROM "${tgt}"."LeadPaymentReceived" WHERE id = e."leadPaymentReceivedId") THEN e."leadPaymentReceivedId" ELSE NULL END,
        CASE WHEN EXISTS (SELECT 1 FROM "${tgt}"."Account" WHERE id = e."destinationAccountId") THEN e."destinationAccountId" ELSE NULL END,
        COALESCE(e."syncId", gen_random_uuid()::text),
        e."createdAt"
      FROM "${src}"."AccountEntry" e
      WHERE EXISTS (SELECT 1 FROM "${tgt}"."Account" WHERE id = e."accountId")`

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

  // Table-specific filters - verificar que FK requeridas existan en destino
  switch (tableName) {
    case 'Phone':
      if (!row.personalData) return null
      if (fkSets.personalData && !fkSets.personalData.has(row.personalData)) return null
      break
    case 'Address':
      if (!row.location || !row.personalData) return null
      if (fkSets.location && !fkSets.location.has(row.location)) return null
      if (fkSets.personalData && !fkSets.personalData.has(row.personalData)) return null
      break
    case 'Employee':
      if (!row.personalData) return null
      if (fkSets.personalData && !fkSets.personalData.has(row.personalData)) return null
      break
    case 'Borrower':
      if (!row.personalData) return null
      if (fkSets.personalData && !fkSets.personalData.has(row.personalData)) return null
      break
    case 'Loan':
      if (!row.borrower || !row.loantype) return null
      // Verificar que borrower y loantype existan en destino (FK requeridas)
      if (fkSets.borrower && !fkSets.borrower.has(row.borrower)) return null
      if (fkSets.loantype && !fkSets.loantype.has(row.loantype)) return null
      // IMPORTANTE: previousLoan se setea a NULL para evitar unique constraint errors
      // Se actualiza en un segundo paso después de insertar todos los loans
      result.previousLoan = null
      break
    case 'LoanPayment':
      if (!row.loan) return null
      if (fkSets.loan && !fkSets.loan.has(row.loan)) return null
      break
    // DocumentPhoto: uploadedBy handled with COALESCE in query (uses first User as default)
    case 'Transaction':
      // Solo validar que tenga fecha y sourceAccount
      if (!row.date) return null
      if (!row.sourceAccount) return null
      break
    case 'AccountEntry':
      // Solo validar que tenga accountId
      if (!row.accountId) return null
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

/**
 * Executes a batch INSERT with multiple rows in a single statement.
 * Much faster than row-by-row inserts over network.
 */
async function executeBatchInsert(
  client: PoolClient,
  tableName: string,
  columns: string[],
  rows: Record<string, any>[]
): Promise<{ inserted: number; errors: number; lastError: string }> {
  if (rows.length === 0) return { inserted: 0, errors: 0, lastError: '' }

  const quotedColumns = columns.map(c => `"${c}"`).join(', ')
  let inserted = 0
  let errors = 0
  let lastError = ''

  // Process in smaller batches for the multi-row INSERT
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE)
    const values: any[] = []
    const valuePlaceholders: string[] = []

    batch.forEach((row, rowIndex) => {
      const rowPlaceholders = columns.map((_, colIndex) => {
        const paramIndex = rowIndex * columns.length + colIndex + 1
        return `$${paramIndex}`
      })
      valuePlaceholders.push(`(${rowPlaceholders.join(', ')})`)
      columns.forEach(col => values.push(row[col]))
    })

    try {
      await client.query(
        `INSERT INTO "${TARGET_SCHEMA}"."${tableName}" (${quotedColumns}) VALUES ${valuePlaceholders.join(', ')}`,
        values
      )
      inserted += batch.length
    } catch (err) {
      // If batch fails, try row-by-row to salvage what we can
      for (const row of batch) {
        try {
          const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
          await client.query(
            `INSERT INTO "${TARGET_SCHEMA}"."${tableName}" (${quotedColumns}) VALUES (${placeholders})`,
            columns.map(col => row[col])
          )
          inserted++
        } catch (rowErr) {
          errors++
          lastError = rowErr instanceof Error ? rowErr.message : String(rowErr)
        }
      }
    }
  }

  return { inserted, errors, lastError }
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
    const missingNotNull = Array.from(notNullColumns).filter(c => !sourceColumns.includes(c) && c !== 'id')

    // Build insert columns - common columns + missing NOT NULL columns
    const insertColumns = [...commonColumns, ...missingNotNull]

    // Load FK reference sets IN PARALLEL for better network performance
    const fkSets = await loadFkSetsParallel(targetClient, tableName, TARGET_SCHEMA, commonColumns)

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

      // Transform all rows first, then batch insert
      const transformedRows: Record<string, any>[] = []
      const now = new Date()

      for (const row of batch.rows) {
        const transformed = transformRow(tableName, row, fkSets)
        if (!transformed) continue

        // Replace placeholder with actual default User ID for DocumentPhoto
        if (tableName === 'DocumentPhoto' && transformed.uploadedBy === '__NEEDS_DEFAULT_USER__') {
          if (!defaultUserId) continue
          transformed.uploadedBy = defaultUserId
        }

        // Add default values for missing NOT NULL columns
        for (const col of missingNotNull) {
          if (col === 'createdAt' || col === 'updatedAt') {
            transformed[col] = transformed[col] || now
          } else if (col === 'name' || col === 'description' || col === 'notes') {
            transformed[col] = transformed[col] || ''
          }
        }

        transformedRows.push(transformed)
      }

      // Execute batch insert (executeBatchInsert handles errors internally with row-by-row fallback)
      const batchResult = await executeBatchInsert(targetClient, tableName, insertColumns, transformedRows)
      insertedCount += batchResult.inserted
      errorCount += batchResult.errors
      if (batchResult.lastError) lastError = batchResult.lastError

      // Log first few errors
      if (batchResult.errors > 0 && errorCount <= 3) {
        console.error(`\n   ⚠️  ${tableName} INSERT error: ${lastError}`)
      }

      offset += BATCH_SIZE
      process.stdout.write(`\r   ${tableName}... ${Math.min(offset, sourceCount)}/${sourceCount} (${insertedCount} insertados)`)
    }

    // Segundo paso para Loan: actualizar previousLoan ahora que todos los loans existen
    if (tableName === 'Loan') {
      process.stdout.write(`\r   ${tableName}... actualizando previousLoan...                    `)
      try {
        // Get all loans with previousLoan in source
        const loansWithPrevious = await sourceClient.query(`
          SELECT id, "previousLoan" FROM "${SOURCE_SCHEMA}"."Loan"
          WHERE "previousLoan" IS NOT NULL
        `)

        // Get existing loan IDs in target
        const targetLoanIds = await getExistingIds(targetClient, TARGET_SCHEMA, 'Loan')

        // Filter valid updates
        const updates: { id: string; previousLoan: string }[] = []
        for (const row of loansWithPrevious.rows) {
          if (targetLoanIds.has(row.id) && targetLoanIds.has(row.previousLoan)) {
            updates.push({ id: row.id, previousLoan: row.previousLoan })
          }
        }

        // Execute updates in batches using multi-row UPDATE with VALUES
        let updateCount = 0
        const UPDATE_BATCH_SIZE = 200 // Smaller batches for UPDATE (2 params per row)

        for (let i = 0; i < updates.length; i += UPDATE_BATCH_SIZE) {
          const batch = updates.slice(i, i + UPDATE_BATCH_SIZE)

          // Build VALUES clause: ($1, $2), ($3, $4), ...
          const valuesClause = batch.map((_, idx) => `($${idx * 2 + 1}, $${idx * 2 + 2})`).join(', ')
          const params = batch.flatMap(({ id, previousLoan }) => [id, previousLoan])

          try {
            await targetClient.query(`
              UPDATE "${TARGET_SCHEMA}"."Loan" l
              SET "previousLoan" = v.prev_loan
              FROM (VALUES ${valuesClause}) AS v(loan_id, prev_loan)
              WHERE l.id = v.loan_id
            `, params)
            updateCount += batch.length
          } catch {
            // Fallback to row-by-row if batch fails
            for (const { id, previousLoan } of batch) {
              try {
                await targetClient.query(
                  `UPDATE "${TARGET_SCHEMA}"."Loan" SET "previousLoan" = $1 WHERE id = $2`,
                  [previousLoan, id]
                )
                updateCount++
              } catch {
                // Ignore individual errors
              }
            }
          }
        }
        process.stdout.write(`\r   ${tableName}... ${insertedCount} insertados, ${updateCount} previousLoan actualizados`)
      } catch (err) {
        console.error(`\n   ⚠️  Error actualizando previousLoan: ${err instanceof Error ? err.message : String(err)}`)
      }
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
      const JUNCTION_BATCH_SIZE = 500 // 2 params per row = 1000 params max

      // Batch insert for junction tables
      for (let i = 0; i < records.rows.length; i += JUNCTION_BATCH_SIZE) {
        const batch = records.rows.slice(i, i + JUNCTION_BATCH_SIZE)
        const valuesClause = batch.map((_, idx) => `($${idx * 2 + 1}, $${idx * 2 + 2})`).join(', ')
        const params = batch.flatMap(row => [row.A, row.B])

        try {
          await targetClient.query(
            `INSERT INTO "${TARGET_SCHEMA}"."${targetTable}" ("A", "B") VALUES ${valuesClause}`,
            params
          )
        } catch (err) {
          // Fallback to row-by-row if batch fails
          for (const row of batch) {
            try {
              await targetClient.query(
                `INSERT INTO "${TARGET_SCHEMA}"."${targetTable}" ("A", "B") VALUES ($1, $2)`,
                [row.A, row.B]
              )
            } catch (rowErr) {
              errorCount++
              lastError = rowErr instanceof Error ? rowErr.message : String(rowErr)
              if (errorCount <= 2) console.error(`\n   ⚠️  ${targetTable} error: ${lastError}`)
            }
          }
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

      // Load FK sets in parallel
      const [targetEmployees, targetRoutes] = await Promise.all([
        getExistingIds(targetClient, TARGET_SCHEMA, 'Employee'),
        getExistingIds(targetClient, TARGET_SCHEMA, 'Route'),
      ])

      // Filter valid records
      const validRecords = result.rows.filter(
        row => targetEmployees.has(row.id) && targetRoutes.has(row.routes)
      )

      // Batch insert
      const JUNCTION_BATCH_SIZE = 500
      let errorCount = 0

      for (let i = 0; i < validRecords.length; i += JUNCTION_BATCH_SIZE) {
        const batch = validRecords.slice(i, i + JUNCTION_BATCH_SIZE)
        const valuesClause = batch.map((_, idx) => `($${idx * 2 + 1}, $${idx * 2 + 2})`).join(', ')
        const params = batch.flatMap(row => [row.id, row.routes])

        try {
          await targetClient.query(
            `INSERT INTO "${TARGET_SCHEMA}"."_RouteEmployees" ("A", "B") VALUES ${valuesClause}`,
            params
          )
        } catch {
          // Fallback to row-by-row
          for (const row of batch) {
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
// BALANCE RECONCILIATION
// ============================================================================

interface ReconciliationResult {
  accountId: string
  accountName: string
  storedBalance: number
  calculatedBalance: number
  difference: number
  adjustmentCreated: boolean
}

/**
 * Convierte Transaction → AccountEntry
 * Mapea los tipos de transacción a los nuevos SourceType
 *
 * IMPORTANTE: profitAmount y returnToCapital están en transacciones INCOME (sin sourceAccount)
 * vinculadas por loanPayment. Hacemos JOIN para traer esos datos.
 */
async function convertTransactionsToEntries(): Promise<number> {
  console.log('\n📊 Convirtiendo Transaction → AccountEntry...\n')
  const client = await targetPool.connect()

  try {
    // Mapping de incomeSource/expenseSource a SourceType
    // IMPORTANTE: Gastos negativos (devoluciones) se convierten a CREDIT con EXPENSE_REFUND
    const result = await client.query(`
      INSERT INTO "${TARGET_SCHEMA}"."AccountEntry" (
        id, "accountId", amount, "entryType", "sourceType",
        "profitAmount", "returnToCapital",
        "snapshotLeadId", "snapshotRouteId",
        "entryDate", description,
        "loanId", "loanPaymentId", "leadPaymentReceivedId", "destinationAccountId",
        "syncId", "createdAt"
      )
      SELECT
        gen_random_uuid()::text,
        t."sourceAccount",
        ABS(t.amount),
        CASE
          WHEN t.type = 'INCOME' THEN 'CREDIT'
          -- Gastos negativos son devoluciones = CREDIT
          WHEN t.type = 'EXPENSE' AND t.amount < 0 THEN 'CREDIT'
          WHEN t.type = 'EXPENSE' THEN 'DEBIT'
          WHEN t.type = 'TRANSFER' THEN 'DEBIT'
          ELSE 'DEBIT'
        END::"${TARGET_SCHEMA}"."AccountEntryType",
        CASE
          -- Income sources
          WHEN t."incomeSource" = 'CASH_LOAN_PAYMENT' THEN 'LOAN_PAYMENT_CASH'
          WHEN t."incomeSource" = 'BANK_LOAN_PAYMENT' THEN 'LOAN_PAYMENT_BANK'
          -- Gastos negativos = devoluciones
          WHEN t.type = 'EXPENSE' AND t.amount < 0 THEN 'EXPENSE_REFUND'
          -- Expense sources con mapping específico
          WHEN t."expenseSource" = 'LOAN_GRANTED' THEN 'LOAN_GRANT'
          WHEN t."expenseSource" = 'LOAN_GRANTED_COMISSION' THEN 'LOAN_GRANT_COMMISSION'
          WHEN t."expenseSource" = 'LOAN_PAYMENT_COMISSION' THEN 'PAYMENT_COMMISSION'
          WHEN t."expenseSource" = 'GASOLINE' THEN 'GASOLINE'
          WHEN t."expenseSource" = 'GASOLINE_TOKA' THEN 'GASOLINE_TOKA'
          WHEN t."expenseSource" = 'NOMINA_SALARY' THEN 'NOMINA_SALARY'
          WHEN t."expenseSource" = 'EXTERNAL_SALARY' THEN 'EXTERNAL_SALARY'
          WHEN t."expenseSource" = 'VIATIC' THEN 'VIATIC'
          WHEN t."expenseSource" = 'TRAVEL_EXPENSES' THEN 'TRAVEL_EXPENSES'
          WHEN t."expenseSource" = 'FALCO_LOSS' THEN 'FALCO_LOSS'
          -- Otros gastos operativos (antes iban a BALANCE_ADJUSTMENT)
          WHEN t."expenseSource" = 'EMPLOYEE_EXPENSE' THEN 'EMPLOYEE_EXPENSE'
          WHEN t."expenseSource" = 'GENERAL_EXPENSE' THEN 'GENERAL_EXPENSE'
          WHEN t."expenseSource" = 'CAR_PAYMENT' THEN 'CAR_PAYMENT'
          WHEN t."expenseSource" = 'BANK_EXPENSE' THEN 'BANK_EXPENSE'
          WHEN t."expenseSource" = 'OTRO' THEN 'OTHER_EXPENSE'
          WHEN t."expenseSource" = 'ASSET_ACQUISITION' THEN 'ASSET_ACQUISITION'
          -- Transfer
          WHEN t.type = 'TRANSFER' THEN 'TRANSFER_OUT'
          -- Default: SOLO si no hay mapping (no debería pasar)
          ELSE 'OTHER_EXPENSE'
        END::"${TARGET_SCHEMA}"."SourceType",
        COALESCE(t."profitAmount", 0),
        COALESCE(t."returnToCapital", 0),
        COALESCE(t."snapshotLeadId", ''),
        COALESCE(t."snapshotRouteId", ''),
        t.date,
        COALESCE(t.description, ''),
        t.loan,
        t."loanPayment",
        t."leadPaymentReceived",
        t."destinationAccount",
        gen_random_uuid()::text,
        t."createdAt"
      FROM "${TARGET_SCHEMA}"."Transaction" t
      WHERE t."sourceAccount" IS NOT NULL
    `)

    const debitCount = result.rowCount || 0
    console.log(`   ✅ ${debitCount} entries DEBIT/CREDIT creados desde Transaction`)

    // Crear AccountEntry desde transacciones INCOME sin sourceAccount
    // (estas transacciones no se migraron a Transaction porque sourceAccount es requerido)
    // Los datos de profitAmount y returnToCapital están en estas transacciones
    if (SAME_DATABASE) {
      // SAME_DATABASE mode: leer desde SOURCE_SCHEMA
      console.log('   📊 Creando entries desde transacciones INCOME del origen...')

      // Obtener cuenta BANK
      const bankResult = await client.query(`
        SELECT id FROM "${TARGET_SCHEMA}"."Account" WHERE type = 'BANK' LIMIT 1
      `)
      const bankAccountId = bankResult.rows[0]?.id

      // Insertar entries directamente con SQL (más rápido)
      const incomeResult = await client.query(`
        INSERT INTO "${TARGET_SCHEMA}"."AccountEntry" (
          id, "accountId", amount, "entryType", "sourceType",
          "profitAmount", "returnToCapital",
          "snapshotLeadId", "snapshotRouteId",
          "entryDate", description,
          "loanId", "loanPaymentId", "leadPaymentReceivedId",
          "syncId", "createdAt"
        )
        SELECT
          gen_random_uuid()::text,
          CASE
            WHEN lp."paymentMethod" = 'MONEY_TRANSFER' THEN $1
            ELSE ra.account_id
          END,
          ABS(t.amount),
          'CREDIT'::"${TARGET_SCHEMA}"."AccountEntryType",
          CASE
            WHEN t."incomeSource" = 'MONEY_INVESMENT' THEN 'MONEY_INVESTMENT'
            WHEN t."incomeSource" = 'MULTA' THEN 'MULTA'
            WHEN lp."paymentMethod" = 'MONEY_TRANSFER' THEN 'LOAN_PAYMENT_BANK'
            ELSE 'LOAN_PAYMENT_CASH'
          END::"${TARGET_SCHEMA}"."SourceType",
          CASE
            WHEN t."incomeSource" = 'MONEY_INVESMENT' THEN 0
            WHEN t."incomeSource" = 'MULTA' THEN ABS(t.amount)
            ELSE COALESCE(t."profitAmount", 0)
          END,
          CASE
            WHEN t."incomeSource" IN ('MONEY_INVESMENT', 'MULTA') THEN 0
            ELSE COALESCE(t."returnToCapital", 0)
          END,
          COALESCE(t."snapshotLeadId", ''),
          COALESCE(t."snapshotRouteId", ''),
          t.date,
          COALESCE(t.description, ''),
          CASE WHEN EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."Loan" WHERE id = t.loan) THEN t.loan ELSE NULL END,
          CASE WHEN EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."LoanPayment" WHERE id = t."loanPayment") THEN t."loanPayment" ELSE NULL END,
          CASE WHEN EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."LeadPaymentReceived" WHERE id = t."leadPaymentReceived") THEN t."leadPaymentReceived" ELSE NULL END,
          gen_random_uuid()::text,
          t."createdAt"
        FROM "${SOURCE_SCHEMA}"."Transaction" t
        LEFT JOIN "${SOURCE_SCHEMA}"."LoanPayment" lp ON lp.id = t."loanPayment"
        LEFT JOIN (
          SELECT r.id as route_id, a.id as account_id
          FROM "${TARGET_SCHEMA}"."Route" r
          JOIN "${TARGET_SCHEMA}"."_RouteAccounts" ra ON ra."B" = r.id
          JOIN "${TARGET_SCHEMA}"."Account" a ON a.id = ra."A"
          WHERE a.type = 'EMPLOYEE_CASH_FUND'
        ) ra ON ra.route_id = t."snapshotRouteId"
        WHERE t.type = 'INCOME'
          AND (t."sourceAccount" IS NULL OR t."sourceAccount" = '')
          AND (
            (lp."paymentMethod" = 'MONEY_TRANSFER' AND $1 IS NOT NULL)
            OR (COALESCE(lp."paymentMethod", 'CASH') != 'MONEY_TRANSFER' AND ra.account_id IS NOT NULL)
          )
      `, [bankAccountId])

      console.log(`   ✅ ${incomeResult.rowCount || 0} entries INCOME creados desde origen`)

      // Insertar entries EXPENSE sin sourceAccount (SAME_DATABASE mode)
      const expenseResult = await client.query(`
        INSERT INTO "${TARGET_SCHEMA}"."AccountEntry" (
          id, "accountId", amount, "entryType", "sourceType",
          "profitAmount", "returnToCapital",
          "snapshotLeadId", "snapshotRouteId",
          "entryDate", description,
          "loanId", "loanPaymentId", "leadPaymentReceivedId",
          "syncId", "createdAt"
        )
        SELECT
          gen_random_uuid()::text,
          ra.account_id,
          ABS(t.amount),
          CASE WHEN t.amount < 0 THEN 'CREDIT' ELSE 'DEBIT' END::"${TARGET_SCHEMA}"."AccountEntryType",
          CASE
            WHEN t.amount < 0 THEN 'EXPENSE_REFUND'
            WHEN t."expenseSource" = 'LOAN_GRANTED' THEN 'LOAN_GRANT'
            WHEN t."expenseSource" = 'LOAN_GRANTED_COMISSION' THEN 'LOAN_GRANT_COMMISSION'
            WHEN t."expenseSource" = 'LOAN_PAYMENT_COMISSION' THEN 'PAYMENT_COMMISSION'
            WHEN t."expenseSource" = 'GASOLINE' THEN 'GASOLINE'
            WHEN t."expenseSource" = 'GASOLINE_TOKA' THEN 'GASOLINE_TOKA'
            WHEN t."expenseSource" = 'NOMINA_SALARY' THEN 'NOMINA_SALARY'
            WHEN t."expenseSource" = 'EXTERNAL_SALARY' THEN 'EXTERNAL_SALARY'
            WHEN t."expenseSource" = 'VIATIC' THEN 'VIATIC'
            WHEN t."expenseSource" = 'TRAVEL_EXPENSES' THEN 'TRAVEL_EXPENSES'
            WHEN t."expenseSource" = 'FALCO_LOSS' THEN 'FALCO_LOSS'
            WHEN t."expenseSource" = 'EMPLOYEE_EXPENSE' THEN 'EMPLOYEE_EXPENSE'
            WHEN t."expenseSource" = 'GENERAL_EXPENSE' THEN 'GENERAL_EXPENSE'
            WHEN t."expenseSource" = 'CAR_PAYMENT' THEN 'CAR_PAYMENT'
            WHEN t."expenseSource" = 'BANK_EXPENSE' THEN 'BANK_EXPENSE'
            WHEN t."expenseSource" = 'OTRO' THEN 'OTHER_EXPENSE'
            WHEN t."expenseSource" = 'ASSET_ACQUISITION' THEN 'ASSET_ACQUISITION'
            ELSE 'OTHER_EXPENSE'
          END::"${TARGET_SCHEMA}"."SourceType",
          0,
          0,
          COALESCE(t."snapshotLeadId", ''),
          COALESCE(t."snapshotRouteId", ''),
          t.date,
          COALESCE(t.description, ''),
          CASE WHEN EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."Loan" WHERE id = t.loan) THEN t.loan ELSE NULL END,
          CASE WHEN EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."LoanPayment" WHERE id = t."loanPayment") THEN t."loanPayment" ELSE NULL END,
          CASE WHEN EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."LeadPaymentReceived" WHERE id = t."leadPaymentReceived") THEN t."leadPaymentReceived" ELSE NULL END,
          gen_random_uuid()::text,
          t."createdAt"
        FROM "${SOURCE_SCHEMA}"."Transaction" t
        LEFT JOIN (
          SELECT r.id as route_id, a.id as account_id
          FROM "${TARGET_SCHEMA}"."Route" r
          JOIN "${TARGET_SCHEMA}"."_RouteAccounts" ra ON ra."B" = r.id
          JOIN "${TARGET_SCHEMA}"."Account" a ON a.id = ra."A"
          WHERE a.type = 'EMPLOYEE_CASH_FUND'
        ) ra ON ra.route_id = t."snapshotRouteId"
        WHERE t.type = 'EXPENSE'
          AND (t."sourceAccount" IS NULL OR t."sourceAccount" = '')
          AND ra.account_id IS NOT NULL
      `)

      console.log(`   ✅ ${expenseResult.rowCount || 0} entries EXPENSE creados desde origen`)

    } else {
      const sourceClient = await sourcePool.connect()
      try {
        // Diagnóstico completo
        console.log('\n   📊 DIAGNÓSTICO DE TRANSACCIONES EN ORIGEN:')

        const totalResult = await sourceClient.query(`SELECT COUNT(*) as count FROM "Transaction"`)
        console.log(`      Total transacciones: ${totalResult.rows[0].count}`)

        const withSourceResult = await sourceClient.query(`
          SELECT COUNT(*) as count FROM "Transaction"
          WHERE "sourceAccount" IS NOT NULL AND "sourceAccount" != ''
        `)
        console.log(`      Con sourceAccount: ${withSourceResult.rows[0].count}`)

        const withoutSourceResult = await sourceClient.query(`
          SELECT COUNT(*) as count FROM "Transaction"
          WHERE "sourceAccount" IS NULL OR "sourceAccount" = ''
        `)
        console.log(`      Sin sourceAccount: ${withoutSourceResult.rows[0].count}`)

        const nullDateResult = await sourceClient.query(`
          SELECT COUNT(*) as count FROM "Transaction" WHERE date IS NULL
        `)
        console.log(`      Con date NULL: ${nullDateResult.rows[0].count}`)

        const byTypeResult = await sourceClient.query(`
          SELECT type,
            COUNT(*) as total,
            SUM(CASE WHEN "sourceAccount" IS NOT NULL AND "sourceAccount" != '' THEN 1 ELSE 0 END) as with_source,
            SUM(CASE WHEN "sourceAccount" IS NULL OR "sourceAccount" = '' THEN 1 ELSE 0 END) as without_source
          FROM "Transaction"
          GROUP BY type
          ORDER BY total DESC
        `)
        console.log('      Por tipo:')
        for (const row of byTypeResult.rows) {
          console.log(`         ${row.type}: ${row.total} (con cuenta: ${row.with_source}, sin cuenta: ${row.without_source})`)
        }
        console.log('')

        // Obtener mapeo de rutas a cuentas EMPLOYEE_CASH_FUND
        const routeAccountsResult = await client.query(`
          SELECT r.id as route_id, r.name as route_name, a.id as account_id
          FROM "${TARGET_SCHEMA}"."Route" r
          JOIN "${TARGET_SCHEMA}"."_RouteAccounts" ra ON ra."B" = r.id
          JOIN "${TARGET_SCHEMA}"."Account" a ON a.id = ra."A"
          WHERE a.type = 'EMPLOYEE_CASH_FUND'
        `)
        const routeToAccount = new Map(routeAccountsResult.rows.map(r => [r.route_id, r.account_id]))

        // Obtener cuenta BANK
        const bankResult = await client.query(`
          SELECT id FROM "${TARGET_SCHEMA}"."Account" WHERE type = 'BANK' LIMIT 1
        `)
        const bankAccountId = bankResult.rows[0]?.id

        console.log('   📊 Creando entries desde transacciones INCOME de producción...')
        // Obtener TODAS las transacciones INCOME de producción sin sourceAccount
        // Incluye pagos de préstamos y otros ingresos (MONEY_INVESMENT, MULTA, etc.)
        const incomeTransactions = await sourceClient.query(`
          SELECT
            t.id, t.amount, t."profitAmount", t."returnToCapital",
            t."snapshotLeadId", t."snapshotRouteId", t.date, t.description,
            t.loan, t."loanPayment", t."leadPaymentReceived", t."createdAt",
            t."incomeSource",
            lp."paymentMethod"
          FROM "Transaction" t
          LEFT JOIN "LoanPayment" lp ON lp.id = t."loanPayment"
          WHERE t.type = 'INCOME'
            AND (t."sourceAccount" IS NULL OR t."sourceAccount" = '')
        `)

        let insertedCount = 0
        let skippedCount = 0
        const fallbackByMonth = new Map<string, number>()

        // Preparar batch de valores para inserción masiva
        // Max ~5400 rows por batch (PostgreSQL limit: 65535 params / 12 params per row)
        const batchSize = 3000
        const valuesToInsert: any[][] = []

        for (const tx of incomeTransactions.rows) {
          // Determinar la cuenta: BANK para transferencias, EMPLOYEE_CASH_FUND para efectivo
          // Si no hay mapeo, usar BANK como fallback
          let accountId: string
          let usedFallback = false
          if (tx.paymentMethod === 'MONEY_TRANSFER') {
            accountId = bankAccountId
          } else {
            const mappedAccount = routeToAccount.get(tx.snapshotRouteId)
            if (mappedAccount) {
              accountId = mappedAccount
            } else {
              accountId = bankAccountId
              usedFallback = true
              // Trackear por mes/año
              const date = new Date(tx.date)
              const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
              fallbackByMonth.set(key, (fallbackByMonth.get(key) || 0) + 1)
            }
          }

          // Determinar sourceType basado en incomeSource y método de pago
          let sourceType: string
          let profitAmount: number
          let returnToCapital: number

          if (tx.incomeSource === 'MONEY_INVESMENT') {
            sourceType = 'MONEY_INVESTMENT'
            profitAmount = 0
            returnToCapital = 0
          } else if (tx.incomeSource === 'MULTA') {
            sourceType = 'MULTA'
            profitAmount = Math.abs(tx.amount)
            returnToCapital = 0
          } else if (tx.paymentMethod === 'MONEY_TRANSFER') {
            sourceType = 'LOAN_PAYMENT_BANK'
            profitAmount = tx.profitAmount || 0
            returnToCapital = tx.returnToCapital || 0
          } else {
            sourceType = 'LOAN_PAYMENT_CASH'
            profitAmount = tx.profitAmount || 0
            returnToCapital = tx.returnToCapital || 0
          }

          valuesToInsert.push([
            accountId,
            Math.abs(tx.amount),
            sourceType,
            profitAmount,
            returnToCapital,
            tx.snapshotLeadId || '',
            tx.snapshotRouteId || '',
            tx.date,
            tx.description || '',
            tx.loan,
            tx.loanPayment,
            tx.leadPaymentReceived,
            tx.createdAt
          ])
        }

        // Insertar en batches
        for (let i = 0; i < valuesToInsert.length; i += batchSize) {
          const batch = valuesToInsert.slice(i, i + batchSize)
          const placeholders = batch.map((_, idx) => {
            const base = idx * 13
            return `(gen_random_uuid()::text, $${base+1}, $${base+2}, 'CREDIT'::"${TARGET_SCHEMA}"."AccountEntryType", $${base+3}::"${TARGET_SCHEMA}"."SourceType", $${base+4}, $${base+5}, $${base+6}, $${base+7}, $${base+8}, $${base+9}, $${base+10}, $${base+11}, $${base+12}, gen_random_uuid()::text, $${base+13})`
          }).join(',\n')

          const flatValues = batch.flat()

          try {
            await client.query(`
              INSERT INTO "${TARGET_SCHEMA}"."AccountEntry" (
                id, "accountId", amount, "entryType", "sourceType",
                "profitAmount", "returnToCapital",
                "snapshotLeadId", "snapshotRouteId",
                "entryDate", description,
                "loanId", "loanPaymentId", "leadPaymentReceivedId",
                "syncId", "createdAt"
              ) VALUES ${placeholders}
            `, flatValues)
            insertedCount += batch.length
          } catch (err) {
            // Si falla el batch, intentar uno por uno
            for (const values of batch) {
              try {
                await client.query(`
                  INSERT INTO "${TARGET_SCHEMA}"."AccountEntry" (
                    id, "accountId", amount, "entryType", "sourceType",
                    "profitAmount", "returnToCapital",
                    "snapshotLeadId", "snapshotRouteId",
                    "entryDate", description,
                    "loanId", "loanPaymentId", "leadPaymentReceivedId",
                    "syncId", "createdAt"
                  ) VALUES (
                    gen_random_uuid()::text, $1, $2, 'CREDIT'::"${TARGET_SCHEMA}"."AccountEntryType",
                    $3::"${TARGET_SCHEMA}"."SourceType", $4, $5, $6, $7, $8, $9, $10, $11, $12,
                    gen_random_uuid()::text, $13
                  )
                `, values)
                insertedCount++
              } catch {
                skippedCount++
              }
            }
          }

          // Progress indicator cada 10000 registros
          if (i > 0 && i % 10000 === 0) {
            console.log(`      ... ${i}/${valuesToInsert.length} procesados`)
          }
        }

        console.log(`   ✅ ${insertedCount} entries INCOME creados desde producción`)
        if (fallbackByMonth.size > 0) {
          const totalFallback = Array.from(fallbackByMonth.values()).reduce((a, b) => a + b, 0)
          console.log(`   📌 ${totalFallback} transacciones INCOME mapeadas a BANK (sin ruta→cuenta):`)
          const sortedMonths = Array.from(fallbackByMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]))
          for (const [month, count] of sortedMonths) {
            console.log(`      ${month}: ${count}`)
          }
        }

        // Procesar transacciones EXPENSE sin sourceAccount
        console.log('   📊 Creando entries desde transacciones EXPENSE de producción...')

        const expenseTransactions = await sourceClient.query(`
          SELECT
            t.id, t.amount, t."expenseSource",
            t."snapshotLeadId", t."snapshotRouteId", t.date, t.description,
            t.loan, t."loanPayment", t."leadPaymentReceived", t."createdAt"
          FROM "Transaction" t
          WHERE t.type = 'EXPENSE'
            AND (t."sourceAccount" IS NULL OR t."sourceAccount" = '')
        `)

        let expenseInserted = 0
        let expenseSkipped = 0
        const expenseFallbackByMonth = new Map<string, number>()

        // Mapear expenseSource a SourceType
        const sourceTypeMap: Record<string, string> = {
          'LOAN_GRANTED': 'LOAN_GRANT',
          'LOAN_GRANTED_COMISSION': 'LOAN_GRANT_COMMISSION',
          'LOAN_PAYMENT_COMISSION': 'PAYMENT_COMMISSION',
          'GASOLINE': 'GASOLINE',
          'GASOLINE_TOKA': 'GASOLINE_TOKA',
          'NOMINA_SALARY': 'NOMINA_SALARY',
          'EXTERNAL_SALARY': 'EXTERNAL_SALARY',
          'VIATIC': 'VIATIC',
          'TRAVEL_EXPENSES': 'TRAVEL_EXPENSES',
          'FALCO_LOSS': 'FALCO_LOSS',
          'EMPLOYEE_EXPENSE': 'EMPLOYEE_EXPENSE',
          'GENERAL_EXPENSE': 'GENERAL_EXPENSE',
          'CAR_PAYMENT': 'CAR_PAYMENT',
          'BANK_EXPENSE': 'BANK_EXPENSE',
          'OTRO': 'OTHER_EXPENSE',
          'ASSET_ACQUISITION': 'ASSET_ACQUISITION',
        }

        // Preparar batch de valores para inserción masiva
        const expenseValuesToInsert: any[][] = []

        for (const tx of expenseTransactions.rows) {
          // Usar BANK como fallback si no hay cuenta mapeada
          const mappedAccount = routeToAccount.get(tx.snapshotRouteId)
          let accountId: string
          if (mappedAccount) {
            accountId = mappedAccount
          } else {
            accountId = bankAccountId
            // Trackear por mes/año
            const date = new Date(tx.date)
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
            expenseFallbackByMonth.set(key, (expenseFallbackByMonth.get(key) || 0) + 1)
          }

          const sourceType = sourceTypeMap[tx.expenseSource] || 'OTHER_EXPENSE'
          const isRefund = tx.amount < 0
          const entryType = isRefund ? 'CREDIT' : 'DEBIT'
          const finalSourceType = isRefund ? 'EXPENSE_REFUND' : sourceType

          expenseValuesToInsert.push([
            accountId,
            Math.abs(tx.amount),
            entryType,
            finalSourceType,
            tx.snapshotLeadId || '',
            tx.snapshotRouteId || '',
            tx.date,
            tx.description || '',
            tx.loan,
            tx.loanPayment,
            tx.leadPaymentReceived,
            tx.createdAt
          ])
        }

        // Insertar en batches
        // Max ~5400 rows por batch (PostgreSQL limit: 65535 params / 12 params per row)
        const expenseBatchSize = 3000
        for (let i = 0; i < expenseValuesToInsert.length; i += expenseBatchSize) {
          const batch = expenseValuesToInsert.slice(i, i + expenseBatchSize)
          const placeholders = batch.map((_, idx) => {
            const base = idx * 12
            return `(gen_random_uuid()::text, $${base+1}, $${base+2}, $${base+3}::"${TARGET_SCHEMA}"."AccountEntryType", $${base+4}::"${TARGET_SCHEMA}"."SourceType", 0, 0, $${base+5}, $${base+6}, $${base+7}, $${base+8}, $${base+9}, $${base+10}, $${base+11}, gen_random_uuid()::text, $${base+12})`
          }).join(',\n')

          const flatValues = batch.flat()

          try {
            await client.query(`
              INSERT INTO "${TARGET_SCHEMA}"."AccountEntry" (
                id, "accountId", amount, "entryType", "sourceType",
                "profitAmount", "returnToCapital",
                "snapshotLeadId", "snapshotRouteId",
                "entryDate", description,
                "loanId", "loanPaymentId", "leadPaymentReceivedId",
                "syncId", "createdAt"
              ) VALUES ${placeholders}
            `, flatValues)
            expenseInserted += batch.length
          } catch (err) {
            // Si falla el batch, intentar uno por uno
            for (const values of batch) {
              try {
                await client.query(`
                  INSERT INTO "${TARGET_SCHEMA}"."AccountEntry" (
                    id, "accountId", amount, "entryType", "sourceType",
                    "profitAmount", "returnToCapital",
                    "snapshotLeadId", "snapshotRouteId",
                    "entryDate", description,
                    "loanId", "loanPaymentId", "leadPaymentReceivedId",
                    "syncId", "createdAt"
                  ) VALUES (
                    gen_random_uuid()::text, $1, $2, $3::"${TARGET_SCHEMA}"."AccountEntryType",
                    $4::"${TARGET_SCHEMA}"."SourceType", 0, 0, $5, $6, $7, $8, $9, $10, $11,
                    gen_random_uuid()::text, $12
                  )
                `, values)
                expenseInserted++
              } catch {
                expenseSkipped++
              }
            }
          }

          if (i > 0 && i % 10000 === 0) {
            console.log(`      ... ${i}/${expenseValuesToInsert.length} procesados`)
          }
        }

        console.log(`   ✅ ${expenseInserted} entries EXPENSE creados desde producción`)
        if (expenseFallbackByMonth.size > 0) {
          const totalFallback = Array.from(expenseFallbackByMonth.values()).reduce((a, b) => a + b, 0)
          console.log(`   📌 ${totalFallback} transacciones EXPENSE mapeadas a BANK (sin ruta→cuenta):`)
          const sortedMonths = Array.from(expenseFallbackByMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]))
          for (const [month, count] of sortedMonths) {
            console.log(`      ${month}: ${count}`)
          }
        }

        // Procesar transacciones TRANSFER sin sourceAccount
        console.log('   📊 Creando entries desde transacciones TRANSFER de producción...')

        const transferTransactions = await sourceClient.query(`
          SELECT
            t.id, t.amount,
            t."snapshotLeadId", t."snapshotRouteId", t.date, t.description,
            t."destinationAccount", t."createdAt"
          FROM "Transaction" t
          WHERE t.type = 'TRANSFER'
            AND (t."sourceAccount" IS NULL OR t."sourceAccount" = '')
        `)

        let transferOutInserted = 0
        let transferInInserted = 0
        const transferFallbackByMonth = new Map<string, number>()

        for (const tx of transferTransactions.rows) {
          // TRANSFER_OUT: usar ruta→cuenta o BANK como fallback
          const mappedAccount = routeToAccount.get(tx.snapshotRouteId)
          let sourceAccountId: string
          if (mappedAccount) {
            sourceAccountId = mappedAccount
          } else {
            sourceAccountId = bankAccountId
            const date = new Date(tx.date)
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
            transferFallbackByMonth.set(key, (transferFallbackByMonth.get(key) || 0) + 1)
          }

          // Insertar TRANSFER_OUT (DEBIT)
          try {
            await client.query(`
              INSERT INTO "${TARGET_SCHEMA}"."AccountEntry" (
                id, "accountId", amount, "entryType", "sourceType",
                "profitAmount", "returnToCapital",
                "snapshotLeadId", "snapshotRouteId",
                "entryDate", description,
                "destinationAccountId",
                "syncId", "createdAt"
              ) VALUES (
                gen_random_uuid()::text, $1, $2, 'DEBIT'::"${TARGET_SCHEMA}"."AccountEntryType",
                'TRANSFER_OUT'::"${TARGET_SCHEMA}"."SourceType", 0, 0, $3, $4, $5, $6, $7,
                gen_random_uuid()::text, $8
              )
            `, [
              sourceAccountId,
              Math.abs(tx.amount),
              tx.snapshotLeadId || '',
              tx.snapshotRouteId || '',
              tx.date,
              tx.description || '',
              tx.destinationAccount,
              tx.createdAt
            ])
            transferOutInserted++
          } catch {
            // Skip on error
          }

          // Insertar TRANSFER_IN (CREDIT) si tiene destinationAccount
          if (tx.destinationAccount) {
            try {
              await client.query(`
                INSERT INTO "${TARGET_SCHEMA}"."AccountEntry" (
                  id, "accountId", amount, "entryType", "sourceType",
                  "profitAmount", "returnToCapital",
                  "snapshotLeadId", "snapshotRouteId",
                  "entryDate", description,
                  "syncId", "createdAt"
                ) VALUES (
                  gen_random_uuid()::text, $1, $2, 'CREDIT'::"${TARGET_SCHEMA}"."AccountEntryType",
                  'TRANSFER_IN'::"${TARGET_SCHEMA}"."SourceType", 0, 0, $3, $4, $5, $6,
                  gen_random_uuid()::text, $7
                )
              `, [
                tx.destinationAccount,
                Math.abs(tx.amount),
                tx.snapshotLeadId || '',
                tx.snapshotRouteId || '',
                tx.date,
                tx.description || '',
                tx.createdAt
              ])
              transferInInserted++
            } catch {
              // Skip on error
            }
          }
        }

        console.log(`   ✅ ${transferOutInserted} entries TRANSFER_OUT + ${transferInInserted} TRANSFER_IN creados desde producción`)
        if (transferFallbackByMonth.size > 0) {
          const totalFallback = Array.from(transferFallbackByMonth.values()).reduce((a, b) => a + b, 0)
          console.log(`   📌 ${totalFallback} transacciones TRANSFER mapeadas a BANK (sin ruta→cuenta):`)
          const sortedMonths = Array.from(transferFallbackByMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]))
          for (const [month, count] of sortedMonths) {
            console.log(`      ${month}: ${count}`)
          }
        }

      } finally {
        sourceClient.release()
      }
    }

    // Crear entries CREDIT para el destino de transfers
    const transferResult = await client.query(`
      INSERT INTO "${TARGET_SCHEMA}"."AccountEntry" (
        id, "accountId", amount, "entryType", "sourceType",
        "profitAmount", "returnToCapital",
        "snapshotLeadId", "snapshotRouteId",
        "entryDate", description,
        "loanId", "loanPaymentId", "leadPaymentReceivedId", "destinationAccountId",
        "syncId", "createdAt"
      )
      SELECT
        gen_random_uuid()::text,
        t."destinationAccount",
        ABS(t.amount),
        'CREDIT'::"${TARGET_SCHEMA}"."AccountEntryType",
        'TRANSFER_IN'::"${TARGET_SCHEMA}"."SourceType",
        0,
        0,
        COALESCE(t."snapshotLeadId", ''),
        COALESCE(t."snapshotRouteId", ''),
        t.date,
        COALESCE(t.description, ''),
        NULL,
        NULL,
        NULL,
        t."sourceAccount",
        gen_random_uuid()::text,
        t."createdAt"
      FROM "${TARGET_SCHEMA}"."Transaction" t
      WHERE t.type = 'TRANSFER'
        AND t."destinationAccount" IS NOT NULL
    `)

    const creditCount = transferResult.rowCount || 0
    console.log(`   ✅ ${creditCount} entries TRANSFER_IN creados para destinos de transferencias`)

    return debitCount + creditCount
  } finally {
    client.release()
  }
}

async function reconcileBalances(): Promise<ReconciliationResult[]> {
  console.log('\n💰 Reconciliando balances de cuentas...\n')
  const client = await targetPool.connect()
  const results: ReconciliationResult[] = []

  try {
    // Get all accounts with their stored balance
    const accounts = await client.query(`
      SELECT id, name, amount::numeric as amount
      FROM "${TARGET_SCHEMA}"."Account"
    `)

    for (const account of accounts.rows) {
      const storedBalance = parseFloat(account.amount) || 0

      // Calculate balance from AccountEntry
      const entrySum = await client.query(`
        SELECT COALESCE(SUM(
          CASE
            WHEN "entryType" = 'CREDIT' THEN amount
            WHEN "entryType" = 'DEBIT' THEN -amount
            ELSE 0
          END
        ), 0)::numeric as total
        FROM "${TARGET_SCHEMA}"."AccountEntry"
        WHERE "accountId" = $1
      `, [account.id])

      const calculatedBalance = parseFloat(entrySum.rows[0].total) || 0
      const difference = storedBalance - calculatedBalance

      const result: ReconciliationResult = {
        accountId: account.id,
        accountName: account.name,
        storedBalance,
        calculatedBalance,
        difference,
        adjustmentCreated: false,
      }

      // If there's a difference, create an adjustment entry
      if (Math.abs(difference) > 0.0001) {
        try {
          const entryType = difference > 0 ? 'CREDIT' : 'DEBIT'
          const amount = Math.abs(difference)

          await client.query(`
            INSERT INTO "${TARGET_SCHEMA}"."AccountEntry" (
              id, "accountId", amount, "entryType", "sourceType",
              "profitAmount", "returnToCapital",
              "snapshotLeadId", "snapshotRouteId",
              "entryDate", description,
              "syncId", "createdAt"
            ) VALUES (
              gen_random_uuid()::text,
              $1,
              $2,
              $3::"${TARGET_SCHEMA}"."AccountEntryType",
              'BALANCE_ADJUSTMENT'::"${TARGET_SCHEMA}"."SourceType",
              0, 0,
              '', '',
              NOW(),
              'Ajuste de migración - diferencia entre Account.amount y SUM(AccountEntry)',
              gen_random_uuid()::text,
              NOW()
            )
          `, [account.id, amount, entryType])

          result.adjustmentCreated = true
          console.log(`   ⚖️  ${account.name}: ${storedBalance.toFixed(2)} vs ${calculatedBalance.toFixed(2)} → Ajuste ${entryType} ${amount.toFixed(2)}`)
        } catch (err) {
          console.log(`   ❌ Error creando ajuste para ${account.name}: ${err instanceof Error ? err.message : String(err)}`)
        }
      } else {
        console.log(`   ✅ ${account.name}: Balance OK (${storedBalance.toFixed(2)})`)
      }

      results.push(result)
    }

    // Summary
    const adjustmentsCreated = results.filter(r => r.adjustmentCreated).length
    const totalAccounts = results.length

    console.log(`\n   📊 Resumen: ${totalAccounts} cuentas, ${adjustmentsCreated} ajustes creados`)

    // Verify final reconciliation
    console.log('\n   🔍 Verificando reconciliación final...')
    let allOk = true
    for (const result of results) {
      if (result.storedBalance === 0 && result.calculatedBalance === 0) continue

      const finalSum = await client.query(`
        SELECT COALESCE(SUM(
          CASE
            WHEN "entryType" = 'CREDIT' THEN amount
            WHEN "entryType" = 'DEBIT' THEN -amount
            ELSE 0
          END
        ), 0)::numeric as total
        FROM "${TARGET_SCHEMA}"."AccountEntry"
        WHERE "accountId" = $1
      `, [result.accountId])

      const finalCalculated = parseFloat(finalSum.rows[0].total) || 0
      const finalDiff = Math.abs(result.storedBalance - finalCalculated)

      if (finalDiff > 0.0001) {
        console.log(`   ❌ ${result.accountName}: Aún difiere! ${result.storedBalance.toFixed(2)} vs ${finalCalculated.toFixed(2)}`)
        allOk = false
      }
    }

    if (allOk) {
      console.log('   ✅ Todos los balances reconciliados correctamente')
    }

    return results
  } finally {
    client.release()
  }
}

// ============================================================================
// LOCATION ROUTE HISTORY
// ============================================================================

async function populateLocationRouteHistory(): Promise<void> {
  console.log('\n📍 Poblando LocationRouteHistory (desde Location.route)...\n')
  const client = await targetPool.connect()

  try {
    // Check current count
    const currentCount = await client.query(
      `SELECT COUNT(*) as count FROM "${TARGET_SCHEMA}"."LocationRouteHistory"`
    )
    const existing = parseInt(currentCount.rows[0].count)

    // Always clear and repopulate
    if (existing > 0) {
      console.log(`   🗑️  Limpiando ${existing} registros existentes...`)
      await client.query(`DELETE FROM "${TARGET_SCHEMA}"."LocationRouteHistory"`)
    }

    // ÚNICA FUENTE DE VERDAD: Location.route
    console.log(`   🔄 Poblando desde Location.route...`)
    const insertFromLocationRoute = await client.query(`
      INSERT INTO "${TARGET_SCHEMA}"."LocationRouteHistory" (
        "id",
        "locationId",
        "routeId",
        "startDate",
        "endDate",
        "createdAt",
        "updatedAt"
      )
      SELECT
        gen_random_uuid()::text,
        loc.id,
        loc.route,
        '2020-01-01'::timestamp,
        NULL::timestamp,
        NOW(),
        NOW()
      FROM "${TARGET_SCHEMA}"."Location" loc
      WHERE loc.route IS NOT NULL
    `)
    console.log(`   ✅ ${insertFromLocationRoute.rowCount} registros insertados`)

    // Show distribution by route
    console.log(`\n   📊 Distribución por ruta:`)
    const byRoute = await client.query(`
      SELECT r.name as route_name, COUNT(lrh.id) as location_count
      FROM "${TARGET_SCHEMA}"."LocationRouteHistory" lrh
      JOIN "${TARGET_SCHEMA}"."Route" r ON r.id = lrh."routeId"
      GROUP BY r.name
      ORDER BY r.name
    `)

    for (const row of byRoute.rows) {
      console.log(`      ${row.route_name}: ${row.location_count} locations`)
    }

    // Final count
    const finalCount = await client.query(
      `SELECT COUNT(*) as count FROM "${TARGET_SCHEMA}"."LocationRouteHistory"`
    )
    console.log(`\n   📊 Total registros en LocationRouteHistory: ${finalCount.rows[0].count}`)
  } finally {
    client.release()
  }
}

// ============================================================================
// BACKFILL SNAPSHOT LEAD ID
// ============================================================================

async function backfillSnapshotLeadId(): Promise<void> {
  console.log('\n👤 Backfill snapshotLeadId en AccountEntry...\n')
  const client = await targetPool.connect()

  try {
    // Stats before
    const statsBefore = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE "snapshotLeadId" = '' OR "snapshotLeadId" IS NULL) as empty_lead,
        COUNT(*) FILTER (WHERE "snapshotLeadId" != '' AND "snapshotLeadId" IS NOT NULL) as with_lead,
        COUNT(*) as total
      FROM "${TARGET_SCHEMA}"."AccountEntry"
    `)
    const emptyBefore = parseInt(statsBefore.rows[0].empty_lead)
    const withLeadBefore = parseInt(statsBefore.rows[0].with_lead)
    const total = parseInt(statsBefore.rows[0].total)

    console.log(`   📊 Antes: ${withLeadBefore}/${total} con snapshotLeadId (${emptyBefore} vacíos)`)

    if (emptyBefore === 0) {
      console.log(`   ⏭️  Todos los entries ya tienen snapshotLeadId`)
      return
    }

    // Step 1: Populate from Loan.lead directly
    const directResult = await client.query(`
      UPDATE "${TARGET_SCHEMA}"."AccountEntry" ae
      SET "snapshotLeadId" = l.lead
      FROM "${TARGET_SCHEMA}"."Loan" l
      WHERE l.id = ae."loanId"
        AND (ae."snapshotLeadId" = '' OR ae."snapshotLeadId" IS NULL)
        AND l.lead IS NOT NULL
    `)
    console.log(`   ✅ ${directResult.rowCount} actualizados desde Loan.lead`)

    // Step 2: Populate from LoanPayment → Loan
    const paymentResult = await client.query(`
      UPDATE "${TARGET_SCHEMA}"."AccountEntry" ae
      SET "snapshotLeadId" = l.lead
      FROM "${TARGET_SCHEMA}"."LoanPayment" lp
      JOIN "${TARGET_SCHEMA}"."Loan" l ON l.id = lp.loan
      WHERE lp.id = ae."loanPaymentId"
        AND (ae."snapshotLeadId" = '' OR ae."snapshotLeadId" IS NULL)
        AND ae."loanId" IS NULL
        AND l.lead IS NOT NULL
    `)
    console.log(`   ✅ ${paymentResult.rowCount} actualizados desde LoanPayment→Loan.lead`)

    // Step 3: Populate PAYMENT_COMMISSION from LoanPayment
    const commissionResult = await client.query(`
      UPDATE "${TARGET_SCHEMA}"."AccountEntry" ae
      SET "snapshotLeadId" = l.lead
      FROM "${TARGET_SCHEMA}"."LoanPayment" lp
      JOIN "${TARGET_SCHEMA}"."Loan" l ON l.id = lp.loan
      WHERE lp.id = ae."loanPaymentId"
        AND (ae."snapshotLeadId" = '' OR ae."snapshotLeadId" IS NULL)
        AND l.lead IS NOT NULL
    `)
    console.log(`   ✅ ${commissionResult.rowCount} PAYMENT_COMMISSION actualizados`)

    // Step 4: Use Loan.snapshotLeadId as fallback
    const snapshotResult = await client.query(`
      UPDATE "${TARGET_SCHEMA}"."AccountEntry" ae
      SET "snapshotLeadId" = l."snapshotLeadId"
      FROM "${TARGET_SCHEMA}"."Loan" l
      WHERE l.id = ae."loanId"
        AND (ae."snapshotLeadId" = '' OR ae."snapshotLeadId" IS NULL)
        AND l."snapshotLeadId" IS NOT NULL
        AND l."snapshotLeadId" != ''
    `)
    console.log(`   ✅ ${snapshotResult.rowCount} actualizados desde Loan.snapshotLeadId`)

    // Stats after
    const statsAfter = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE "snapshotLeadId" = '' OR "snapshotLeadId" IS NULL) as empty_lead,
        COUNT(*) FILTER (WHERE "snapshotLeadId" != '' AND "snapshotLeadId" IS NOT NULL) as with_lead
      FROM "${TARGET_SCHEMA}"."AccountEntry"
    `)
    const emptyAfter = parseInt(statsAfter.rows[0].empty_lead)
    const withLeadAfter = parseInt(statsAfter.rows[0].with_lead)

    const totalUpdated =
      (directResult.rowCount || 0) +
      (paymentResult.rowCount || 0) +
      (commissionResult.rowCount || 0) +
      (snapshotResult.rowCount || 0)

    console.log(`\n   📊 Después: ${withLeadAfter}/${total} con snapshotLeadId (${emptyAfter} vacíos)`)
    console.log(`   📈 Total actualizados: ${totalUpdated}`)

    if (emptyAfter > 0) {
      // Show breakdown of remaining empty entries
      const remaining = await client.query(`
        SELECT "sourceType", COUNT(*) as count
        FROM "${TARGET_SCHEMA}"."AccountEntry"
        WHERE "snapshotLeadId" = '' OR "snapshotLeadId" IS NULL
        GROUP BY "sourceType"
        ORDER BY count DESC
        LIMIT 5
      `)
      console.log(`\n   ⚠️  ${emptyAfter} entries sin snapshotLeadId (gastos generales, normal):`)
      for (const row of remaining.rows) {
        console.log(`      ${row.sourceType}: ${row.count}`)
      }
    }
  } finally {
    client.release()
  }
}

// ============================================================================
// DIAGNOSTICS
// ============================================================================

async function runDiagnostics(): Promise<void> {
  if (!SAME_DATABASE) {
    console.log('⚠️  Diagnósticos solo disponibles en modo Same-DB\n')
    return
  }

  console.log('🔍 Analizando integridad de datos en origen...\n')
  const client = await sourcePool.connect()
  const src = SOURCE_SCHEMA

  try {
    // Después de migrar PersonalData, verificar cuántos Borrowers se saltarán
    const borrowerOrphans = await client.query(`
      SELECT COUNT(*) as count FROM "${src}"."Borrower" b
      WHERE b."personalData" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "${src}"."PersonalData" WHERE id = b."personalData")
    `)
    if (borrowerOrphans.rows[0].count > 0) {
      console.log(`   ⚠️  Borrowers con personalData huérfano: ${borrowerOrphans.rows[0].count}`)
    }

    // Loans con borrower huérfano
    const loanOrphanBorrower = await client.query(`
      SELECT COUNT(*) as count FROM "${src}"."Loan" l
      WHERE l.borrower IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "${src}"."Borrower" WHERE id = l.borrower)
    `)
    if (loanOrphanBorrower.rows[0].count > 0) {
      console.log(`   ⚠️  Loans con borrower huérfano: ${loanOrphanBorrower.rows[0].count}`)
    }

    // Loans con loantype huérfano
    const loanOrphanType = await client.query(`
      SELECT COUNT(*) as count FROM "${src}"."Loan" l
      WHERE l.loantype IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "${src}"."Loantype" WHERE id = l.loantype)
    `)
    if (loanOrphanType.rows[0].count > 0) {
      console.log(`   ⚠️  Loans con loantype huérfano: ${loanOrphanType.rows[0].count}`)
    }

    // Loans con borrower→personalData huérfano (cascada)
    const loanCascadeOrphan = await client.query(`
      SELECT COUNT(*) as count FROM "${src}"."Loan" l
      JOIN "${src}"."Borrower" b ON l.borrower = b.id
      WHERE b."personalData" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "${src}"."PersonalData" WHERE id = b."personalData")
    `)
    if (loanCascadeOrphan.rows[0].count > 0) {
      console.log(`   ⚠️  Loans afectados por cascada (borrower→personalData huérfano): ${loanCascadeOrphan.rows[0].count}`)
    }

    // Total de loans que se saltarán
    const totalSkipped = await client.query(`
      SELECT COUNT(*) as count FROM "${src}"."Loan" l
      WHERE l.borrower IS NULL
         OR l.loantype IS NULL
         OR NOT EXISTS (SELECT 1 FROM "${src}"."Borrower" WHERE id = l.borrower)
         OR NOT EXISTS (SELECT 1 FROM "${src}"."Loantype" WHERE id = l.loantype)
         OR EXISTS (
           SELECT 1 FROM "${src}"."Borrower" b
           WHERE b.id = l.borrower
             AND b."personalData" IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM "${src}"."PersonalData" WHERE id = b."personalData")
         )
    `)
    console.log(`\n   📊 Total de Loans que se omitirán: ${totalSkipped.rows[0].count}`)

    const totalLoans = await client.query(`SELECT COUNT(*) as count FROM "${src}"."Loan"`)
    console.log(`   📊 Total de Loans en origen: ${totalLoans.rows[0].count}`)
    console.log(`   📊 Loans que se migrarán: ${totalLoans.rows[0].count - totalSkipped.rows[0].count}\n`)

  } catch (error) {
    console.log(`   ❌ Error en diagnóstico: ${error instanceof Error ? error.message : String(error)}\n`)
  } finally {
    client.release()
  }
}

// ============================================================================
// FIX NULL SNAPSHOT ROUTE IDS - DEPRECATED
// snapshotRouteId was removed from schema, this function is no longer needed
// ============================================================================

// async function fixNullSnapshotRouteIds(): Promise<void> {
//   // DEPRECATED: snapshotRouteId column was removed from Loan table
//   // Route information is now obtained via LocationRouteHistory
// }

// ============================================================================
// EXPORT / DUMP FUNCTIONS
// ============================================================================

/**
 * Export database to SQL dump file using pg_dump.
 * This creates a data-only dump that can be quickly restored to another DB.
 */
async function exportDatabaseDump(dbUrl: string, schema: string, outputFile: string): Promise<void> {
  console.log('\n📦 Exportando dump SQL...\n')

  const dumpPath = path.resolve(outputFile)

  // pg_dump command with data-only, no owner, no privileges
  const cmd = `pg_dump "${dbUrl}" --data-only --no-owner --no-privileges --schema="${schema}" --disable-triggers -f "${dumpPath}"`

  console.log(`   📄 Archivo: ${dumpPath}`)
  console.log(`   🗄️  Schema: ${schema}`)
  console.log(`   ⏳ Ejecutando pg_dump...`)

  try {
    const startTime = Date.now()
    execSync(cmd, { stdio: 'pipe' })
    const duration = ((Date.now() - startTime) / 1000).toFixed(1)

    // Get file size
    const stats = fs.statSync(dumpPath)
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2)

    console.log(`   ✅ Dump completado en ${duration}s`)
    console.log(`   📊 Tamaño: ${sizeMB} MB`)
    console.log(`\n   Para restaurar en otra DB:`)
    console.log(`   psql "postgresql://user:pass@host/db" < ${dumpPath}`)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`   ❌ Error en pg_dump: ${msg}`)
    throw error
  }
}

/**
 * Restore SQL dump to a remote database using psql.
 */
async function restoreDumpToRemote(dbUrl: string, dumpFile: string): Promise<void> {
  console.log('\n📤 Restaurando dump en DB remota...\n')

  const dumpPath = path.resolve(dumpFile)

  if (!fs.existsSync(dumpPath)) {
    throw new Error(`Archivo no encontrado: ${dumpPath}`)
  }

  const stats = fs.statSync(dumpPath)
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2)

  console.log(`   📄 Archivo: ${dumpPath} (${sizeMB} MB)`)
  console.log(`   🎯 Destino: ${maskUrl(dbUrl)}`)
  console.log(`   ⏳ Ejecutando psql...`)

  const cmd = `psql "${dbUrl}" < "${dumpPath}"`

  try {
    const startTime = Date.now()
    execSync(cmd, { stdio: 'pipe' })
    const duration = ((Date.now() - startTime) / 1000).toFixed(1)

    console.log(`   ✅ Restauración completada en ${duration}s`)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`   ❌ Error en psql: ${msg}`)
    throw error
  }
}

// ============================================================================
// DATA FIX FUNCTIONS
// ============================================================================

/**
 * Fix loan status data after migration
 * - Converts RENOVATED status to FINISHED (RENOVATED was removed from enum)
 * - Sets finishedDate based on last payment for renovated/finished loans
 * - Sets renewedDate for loans that have a next loan (previousLoan reference)
 * - Fixes status to FINISHED for loans with finishedDate or renewedDate
 */
async function fixLoanStatusData(): Promise<void> {
  console.log('\n📋 Corrigiendo datos de préstamos...\n')
  const client = await targetPool.connect()

  try {
    // Query 1: Convert RENOVATED to FINISHED
    const q1 = await client.query(`
      UPDATE "${TARGET_SCHEMA}"."Loan"
      SET status = 'FINISHED'
      WHERE status = 'RENOVATED'
    `)
    console.log(`   ✅ RENOVATED → FINISHED: ${q1.rowCount} préstamos actualizados`)

    // Query 2: Set finishedDate based on last payment for renovated/finished loans
    const q2 = await client.query(`
      UPDATE "${TARGET_SCHEMA}"."Loan" l
      SET "finishedDate" = (
        SELECT MAX(p."receivedAt")
        FROM "${TARGET_SCHEMA}"."LoanPayment" p
        WHERE p.loan = l.id
      )
      WHERE l."finishedDate" IS NULL
        AND (
          EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."Loan" r WHERE r."previousLoan" = l.id)
          OR l."pendingAmountStored" <= 0
        )
        AND EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."LoanPayment" p WHERE p.loan = l.id)
    `)
    console.log(`   ✅ finishedDate establecido: ${q2.rowCount} préstamos`)

    // Query 3: Set renewedDate for loans that have a next loan
    const q3 = await client.query(`
      UPDATE "${TARGET_SCHEMA}"."Loan" l
      SET "renewedDate" = (
        SELECT r."signDate"
        FROM "${TARGET_SCHEMA}"."Loan" r
        WHERE r."previousLoan" = l.id
        LIMIT 1
      )
      WHERE l."renewedDate" IS NULL
        AND EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."Loan" r WHERE r."previousLoan" = l.id)
    `)
    console.log(`   ✅ renewedDate establecido: ${q3.rowCount} préstamos`)

    // Query 4: Fix status to FINISHED for loans with finishedDate or renewedDate
    const q4 = await client.query(`
      UPDATE "${TARGET_SCHEMA}"."Loan"
      SET status = 'FINISHED'
      WHERE status = 'ACTIVE'
        AND ("finishedDate" IS NOT NULL OR "renewedDate" IS NOT NULL)
    `)
    console.log(`   ✅ ACTIVE → FINISHED (con fechas): ${q4.rowCount} préstamos`)

    // Query 5: Ensure finishedDate is the last payment date (not renewal date)
    const q5 = await client.query(`
      UPDATE "${TARGET_SCHEMA}"."Loan" l
      SET "finishedDate" = (
        SELECT MAX(p."receivedAt")
        FROM "${TARGET_SCHEMA}"."LoanPayment" p
        WHERE p.loan = l.id
      )
      WHERE l."finishedDate" IS NOT NULL
        AND l."renewedDate" IS NOT NULL
        AND EXISTS (SELECT 1 FROM "${TARGET_SCHEMA}"."LoanPayment" p WHERE p.loan = l.id)
    `)
    console.log(`   ✅ finishedDate corregido a último pago: ${q5.rowCount} préstamos`)

  } finally {
    client.release()
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
  if (EXPORT_AFTER || EXPORT_ONLY) {
    console.log(`   Export: ${DUMP_FILE}`)
  }
  console.log('')

  // Handle --export-only: just export the target DB (no migration)
  if (EXPORT_ONLY) {
    const exportDbUrl = TARGET_DB_URL || SOURCE_DB_URL
    if (!exportDbUrl) {
      console.error('   ❌ No hay DATABASE_URL configurada para exportar')
      process.exit(1)
    }
    await exportDatabaseDump(exportDbUrl, TARGET_SCHEMA, DUMP_FILE)
    console.log('\n✅ Export completado!\n')
    return
  }

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
    await runDiagnostics()
    console.log('\n⚠️  Modo DRY-RUN: No se ejecutaron cambios.\n')
    await sourcePool.end()
    if (!SAME_DATABASE) await targetPool.end()
    return
  }

  await runDiagnostics()
  await cleanTargetSchema()

  // Deshabilitar FK constraints en Transaction para permitir inserción sin validación
  console.log('🔓 Deshabilitando FK constraints en Transaction...\n')
  const targetClient = await targetPool.connect()
  try {
    await targetClient.query('ALTER TABLE "Transaction" DISABLE TRIGGER ALL')
    console.log('   ✅ FK constraints deshabilitados\n')
  } finally {
    targetClient.release()
  }

  const results: MigrationResult[] = []
  const migrateTable = SAME_DATABASE ? migrateTableSameDb : migrateTableCrossDb

  console.log('📋 Migrando tablas principales...\n')
  for (const tableName of MIGRATION_ORDER) {
    try {
      // Wrap with retry logic for connection errors
      const result = await withRetry(() => migrateTable(tableName), tableName, 3)
      results.push(result)
      console.log(result.success
        ? (result.error ? `\r   ${tableName}... ⚠️  ${result.error}` : `\r   ${tableName}... ✅ ${result.sourceCount} → ${result.targetCount}`)
        : `\r   ${tableName}... ❌ ${result.error}`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      results.push({ table: tableName, sourceCount: 0, targetCount: 0, success: false, error: errorMsg })
      console.log(`\r   ${tableName}... ❌ ${errorMsg}`)
    }
  }

  console.log('\n📋 Migrando relaciones M:M...\n')

  try {
    const empRoutes = await withRetry(() => migrateEmployeeRoutes(), 'EmployeeRoutes', 3)
    results.push(empRoutes)
    console.log(`   Employee Routes: ${empRoutes.success ? '✅' : '❌'} → ${empRoutes.targetCount}`)
  } catch (err) {
    console.log(`   Employee Routes: ❌ ${err instanceof Error ? err.message : String(err)}`)
  }

  const junctionTables = [
    ['_Loan_collaterals', '_LoanCollaterals'],
    ['_Account_routes', '_RouteAccounts'],
    ['_ReportConfig_routes', '_ReportConfigRoutes'],
    ['_ReportConfig_telegramUsers', '_ReportConfigRecipients'],
  ]

  for (const [src, tgt] of junctionTables) {
    try {
      const result = await withRetry(() => migrateJunctionTable(src, tgt), src, 3)
      results.push(result)
      console.log(`   ${src}: ${result.success ? '✅' : '❌'} ${result.sourceCount} → ${result.targetCount}`)
    } catch (err) {
      console.log(`   ${src}: ❌ ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Step 1: Convert Transaction → AccountEntry
  await withRetry(() => convertTransactionsToEntries(), 'TransactionsToEntries', 3)

  // Step 2: Balance reconciliation - create BALANCE_ADJUSTMENT entries to match Account.amount
  await withRetry(() => reconcileBalances(), 'ReconcileBalances', 3)

  // Step 3: Populate LocationRouteHistory for historical route lookups
  await withRetry(() => populateLocationRouteHistory(), 'PopulateLocationRouteHistory', 3)

  // Step 4: Backfill snapshotLeadId in AccountEntry for lead-based filtering
  await withRetry(() => backfillSnapshotLeadId(), 'BackfillSnapshotLeadId', 3)

  // Step 5: Fix loan status data (RENOVATED → FINISHED, set dates)
  // await withRetry(() => fixLoanStatusData(), 'FixLoanStatusData', 3)

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

  // Re-habilitar FK constraints en Transaction
  console.log('\n🔒 Re-habilitando FK constraints en Transaction...')
  const finalClient = await targetPool.connect()
  try {
    await finalClient.query('ALTER TABLE "Transaction" ENABLE TRIGGER ALL')
    console.log('   ✅ FK constraints re-habilitados')
  } finally {
    finalClient.release()
  }

  await sourcePool.end()
  if (!SAME_DATABASE) await targetPool.end()
  console.log('\n✅ Migración completada!\n')

  // Export dump after migration if --export flag is set
  if (EXPORT_AFTER || UPLOAD_TO_REMOTE) {
    const exportDbUrl = TARGET_DB_URL || SOURCE_DB_URL
    if (exportDbUrl) {
      await exportDatabaseDump(exportDbUrl, TARGET_SCHEMA, DUMP_FILE)
    }
  }

  // Upload dump to remote if --upload flag is set
  if (UPLOAD_TO_REMOTE) {
    if (!REMOTE_DB_URL) {
      console.error('\n❌ REMOTE_DATABASE_URL no está configurada en .env')
      process.exit(1)
    }
    await restoreDumpToRemote(REMOTE_DB_URL, DUMP_FILE)
    console.log('\n✅ Sincronización completa: prod → local → remote\n')
  }
}

main().catch(console.error)
