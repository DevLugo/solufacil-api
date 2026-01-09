/**
 * Script para hacer dump de la DB local y subirlo a remoto (Neon)
 *
 * Uso:
 *   pnpm --filter @solufacil/database db:dump-to-remote
 *
 * Variables de entorno:
 *   DATABASE_URL        - URL de la DB local (tu base de datos de desarrollo)
 *   REMOTE_DATABASE_URL - URL de la DB remota (Neon/producción)
 */

import 'dotenv/config'
import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync, unlinkSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Client } from 'pg'

const execAsync = promisify(exec)

const LOCAL_URL = process.env.DATABASE_URL
const REMOTE_URL = process.env.REMOTE_DATABASE_URL || process.env.NEON_DATABASE_URL
const SKIP_CONFIRM = process.argv.includes('--yes') || process.argv.includes('-y')

if (!LOCAL_URL) {
  console.error('❌ Error: DATABASE_URL no está definida')
  process.exit(1)
}

if (!REMOTE_URL) {
  console.error('❌ Error: REMOTE_DATABASE_URL o NEON_DATABASE_URL no está definida')
  console.error('   Ejemplo: REMOTE_DATABASE_URL="postgresql://user:pass@neon.tech/db" pnpm db:dump-to-remote')
  process.exit(1)
}

function parseConnectionUrl(url: string) {
  const parsed = new URL(url)
  const params = new URLSearchParams(parsed.search)
  return {
    host: parsed.hostname,
    port: parsed.port || '5432',
    database: parsed.pathname.slice(1),
    user: parsed.username,
    password: decodeURIComponent(parsed.password),
    sslmode: params.get('sslmode') || undefined,
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// Tablas principales a validar (críticas primero)
const TABLES_TO_VALIDATE = [
  'Loan',
  'LoanPayment',
  'Borrower',
  'Employee',
  'Route',
  'Location',
  'PersonalData',
  'AccountEntry',
  'LeadPaymentReceived',
  'FalcoCompensatoryPayment',
  'AuditLog',
  'Account',
]

async function validateSync(localUrl: string, remoteUrl: string): Promise<string[]> {
  const errors: string[] = []

  const localClient = new Client({ connectionString: localUrl })
  const remoteClient = new Client({ connectionString: remoteUrl })

  try {
    await localClient.connect()
    await remoteClient.connect()

    for (const table of TABLES_TO_VALIDATE) {
      try {
        const localResult = await localClient.query(`SELECT COUNT(*) as count FROM public."${table}"`)
        const remoteResult = await remoteClient.query(`SELECT COUNT(*) as count FROM public."${table}"`)

        const localCount = parseInt(localResult.rows[0].count)
        const remoteCount = parseInt(remoteResult.rows[0].count)

        if (localCount !== remoteCount) {
          errors.push(`${table}: LOCAL=${localCount}, REMOTE=${remoteCount} (diff: ${localCount - remoteCount})`)
        }
      } catch (tableError: any) {
        errors.push(`${table}: Error al validar - ${tableError.message}`)
      }
    }

    // Validación específica: último Loan
    try {
      const localLastLoan = await localClient.query(`
        SELECT id, "signDate" FROM public."Loan" ORDER BY "signDate" DESC LIMIT 1
      `)
      const remoteLastLoan = await remoteClient.query(`
        SELECT id, "signDate" FROM public."Loan" ORDER BY "signDate" DESC LIMIT 1
      `)

      if (localLastLoan.rows[0]?.id !== remoteLastLoan.rows[0]?.id) {
        errors.push(`Último Loan: LOCAL=${localLastLoan.rows[0]?.id} (${localLastLoan.rows[0]?.signDate}), REMOTE=${remoteLastLoan.rows[0]?.id} (${remoteLastLoan.rows[0]?.signDate})`)
      }
    } catch {}

  } finally {
    await localClient.end()
    await remoteClient.end()
  }

  return errors
}

async function main() {
  const dumpFile = join(tmpdir(), `solufacil_dump_${Date.now()}.sql`)

  console.log('════════════════════════════════════════════════════════════')
  console.log('📤 Dump Local → Push to Remote')
  console.log('════════════════════════════════════════════════════════════')
  console.log('')

  const local = parseConnectionUrl(LOCAL_URL)
  const remote = parseConnectionUrl(REMOTE_URL)

  console.log(`📍 Local:  ${local.host}:${local.port}/${local.database}`)
  console.log(`📍 Remote: ${remote.host}:${remote.port}/${remote.database}`)
  console.log('')

  try {
    // Step 1: Dump local database (texto plano con --clean)
    console.log('📥 Paso 1: Exportando datos de LOCAL...')
    const startDump = Date.now()

    // Usar formato texto con --clean --if-exists para que funcione con psql
    // IMPORTANTE: --schema=public para exportar solo el schema correcto
    await execAsync(
      `PGPASSWORD='${local.password}' pg_dump ` +
      `-h ${local.host} -p ${local.port} -U ${local.user} -d ${local.database} ` +
      `--schema=public ` +
      `--no-owner --no-privileges --no-comments --clean --if-exists ` +
      `--exclude-table=_prisma_migrations ` +
      `-f "${dumpFile}"`,
      { maxBuffer: 1024 * 1024 * 500 }
    )

    // Eliminar \restrict que es de PostgreSQL 17 y no es compatible con Neon
    const { readFileSync, writeFileSync } = await import('fs')
    let dumpContent = readFileSync(dumpFile, 'utf-8')
    dumpContent = dumpContent.replace(/^\\restrict\s+\S+\n/gm, '')
    writeFileSync(dumpFile, dumpContent)

    const dumpSize = statSync(dumpFile).size
    const dumpTime = ((Date.now() - startDump) / 1000).toFixed(1)
    console.log(`   ✅ Dump completado: ${formatBytes(dumpSize)} en ${dumpTime}s`)

    // Step 2: Push to remote
    console.log('')
    console.log('📤 Paso 2: Subiendo dump a remoto...')
    console.log('   ⚠️  Esto borrará todos los datos existentes en remoto!')
    console.log('')

    // Ask for confirmation (skip if --yes flag)
    if (!SKIP_CONFIRM) {
      const readline = await import('readline')
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      })

      const answer = await new Promise<string>((resolve) => {
        rl.question('   ¿Continuar? (escribe "si" para confirmar): ', resolve)
      })
      rl.close()

      if (answer.toLowerCase() !== 'si') {
        console.log('')
        console.log('   ❌ Operación cancelada')
        return
      }
    } else {
      console.log('   (confirmación omitida con --yes)')
    }

    // Subir con psql (más lento pero compatible con Neon)
    console.log('')
    console.log('   📤 Subiendo con psql (puede tardar unos minutos)...')
    const startPush = Date.now()

    // Primero eliminamos TODAS las tablas del schema public
    console.log('   🗑️  Limpiando todas las tablas en remoto...')
    const remoteClient = new Client({ connectionString: REMOTE_URL })
    await remoteClient.connect()

    try {
      // Obtener todas las tablas del schema public
      const allTables = await remoteClient.query(`
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      `)

      // Eliminar en orden: primero las M2M (empiezan con _), luego el resto
      const m2mTables = allTables.rows.filter(r => r.tablename.startsWith('_'))
      const regularTables = allTables.rows.filter(r => !r.tablename.startsWith('_'))

      for (const row of [...m2mTables, ...regularTables]) {
        try {
          await remoteClient.query(`DROP TABLE IF EXISTS "${row.tablename}" CASCADE`)
        } catch (e) {
          // Ignorar errores
        }
      }

      // También eliminar tipos custom (enums de Prisma)
      const types = await remoteClient.query(`
        SELECT typname FROM pg_type t
        JOIN pg_namespace n ON t.typnamespace = n.oid
        WHERE n.nspname = 'public' AND t.typtype = 'e'
      `)

      for (const row of types.rows) {
        try {
          await remoteClient.query(`DROP TYPE IF EXISTS "${row.typname}" CASCADE`)
        } catch (e) {
          // Ignorar errores
        }
      }

      console.log(`   ✅ ${allTables.rows.length} tablas y ${types.rows.length} tipos eliminados`)
    } finally {
      await remoteClient.end()
    }

    // Ejecutamos psql y capturamos errores
    // NO usamos ON_ERROR_STOP para que continúe aunque haya errores de DROP
    // La validación al final nos dirá si faltaron datos
    console.log(`   📄 Ejecutando dump: ${dumpFile}`)

    // Ejecutar psql con más verbosidad para diagnóstico
    const psqlCmd = `PGPASSWORD='${remote.password}' psql ` +
      `-h ${remote.host} -p ${remote.port} -U ${remote.user} -d ${remote.database} ` +
      `-v ON_ERROR_STOP=1 ` +
      `-f "${dumpFile}"`

    let stdout = '', stderr = ''
    try {
      const result = await execAsync(psqlCmd, {
        maxBuffer: 1024 * 1024 * 500,
        timeout: 1200000
      })
      stdout = result.stdout
      stderr = result.stderr
    } catch (execError: any) {
      stdout = execError.stdout || ''
      stderr = execError.stderr || ''
      console.log('')
      console.log('   ❌ psql falló con error:')
      const errMsg = execError.message || 'Unknown error'
      // Mostrar las líneas relevantes del error
      const relevantLines = errMsg.split('\n').filter((l: string) =>
        l.includes('ERROR') || l.includes('error') || l.includes('psql')
      ).slice(0, 10)
      relevantLines.forEach((l: string) => console.log(`      ${l}`))

      // Si hay stderr, mostrarlo
      if (stderr) {
        const stderrLines = stderr.split('\n').filter((l: string) =>
          l.includes('ERROR') || l.includes('FATAL')
        ).slice(0, 10)
        stderrLines.forEach((l: string) => console.log(`      ${l}`))
      }
    }

    const pushTime = ((Date.now() - startPush) / 1000).toFixed(1)
    console.log(`   ✅ psql terminó en ${pushTime}s`)

    // Mostrar output combinado (stdout+stderr van juntos con 2>&1)
    const allOutput = stdout || stderr || ''
    if (allOutput.trim()) {
      const lines = allOutput.split('\n').filter(l => l.trim() && !l.includes('NOTICE:') && !l.startsWith('SET') && !l.startsWith('DROP') && !l.startsWith('CREATE') && !l.startsWith('ALTER') && !l.startsWith('COPY'))

      // Buscar errores específicos
      const errorLines = allOutput.split('\n').filter(l => l.includes('ERROR') || l.includes('FATAL'))

      if (errorLines.length > 0) {
        console.log('')
        console.log('   ❌ Errores encontrados:')
        errorLines.slice(0, 30).forEach(l => console.log(`      ${l}`))
        if (errorLines.length > 30) {
          console.log(`      ... y ${errorLines.length - 30} errores más`)
        }
      }
    } else {
      console.log('   ⚠️  psql no devolvió ningún output')
    }

    // Step 3: Validar que los datos se sincronizaron correctamente
    console.log('')
    console.log('🔍 Paso 3: Validando sincronización...')

    const validationErrors = await validateSync(LOCAL_URL, REMOTE_URL)

    if (validationErrors.length > 0) {
      console.log('')
      console.log('   ⚠️  Se encontraron diferencias:')
      validationErrors.forEach(err => console.log(`      - ${err}`))
      console.log('')
      console.log('════════════════════════════════════════════════════════════')
      console.log('⚠️  Migración completada con diferencias')
      console.log('════════════════════════════════════════════════════════════')
    } else {
      console.log('   ✅ Validación exitosa - todos los conteos coinciden')
      console.log('')
      console.log('════════════════════════════════════════════════════════════')
      console.log('✅ ¡Migración a remoto completada!')
      console.log('════════════════════════════════════════════════════════════')
    }

  } catch (error) {
    console.error('')
    console.error('❌ Error:', error instanceof Error ? error.message : error)
    process.exit(1)
  } finally {
    // Mantener dump file para debugging
    if (existsSync(dumpFile)) {
      console.log(`   📁 Dump guardado en: ${dumpFile}`)
      // try { unlinkSync(dumpFile) } catch {}
    }
  }
}

main()
