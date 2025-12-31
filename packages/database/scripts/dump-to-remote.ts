/**
 * Script para hacer dump de la DB local y subirlo a remoto (Neon)
 *
 * Uso:
 *   pnpm --filter @solufacil/database db:dump-to-remote
 *
 * Variables de entorno:
 *   LOCAL_DATABASE_URL  - URL de la DB local (default: postgresql://postgres:test1234@localhost:5432/solufacil-api)
 *   REMOTE_DATABASE_URL - URL de la DB remota (Neon)
 */

import 'dotenv/config'
import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync, unlinkSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const execAsync = promisify(exec)

const LOCAL_URL = process.env.LOCAL_DATABASE_URL || 'postgresql://postgres:test1234@localhost:5432/solufacil-api'
const REMOTE_URL = process.env.REMOTE_DATABASE_URL || process.env.NEON_DATABASE_URL
const SKIP_CONFIRM = process.argv.includes('--yes') || process.argv.includes('-y')

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
    // Step 1: Dump local database
    console.log('📥 Paso 1: Creando dump de base de datos local...')
    const startDump = Date.now()

    await execAsync(
      `PGPASSWORD='${local.password}' pg_dump ` +
      `-h ${local.host} -p ${local.port} -U ${local.user} -d ${local.database} ` +
      `--no-owner --no-privileges --no-comments --clean --if-exists ` +
      `-f "${dumpFile}"`,
      { maxBuffer: 1024 * 1024 * 500 }
    )

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

    console.log('')
    console.log('   Subiendo...')
    const startPush = Date.now()

    const sslOption = remote.sslmode ? `?sslmode=${remote.sslmode}` : ''
    await execAsync(
      `PGPASSWORD='${remote.password}' psql ` +
      `"postgresql://${remote.user}@${remote.host}:${remote.port}/${remote.database}${sslOption}" ` +
      `-f "${dumpFile}" --quiet`,
      { maxBuffer: 1024 * 1024 * 100 }
    )

    const pushTime = ((Date.now() - startPush) / 1000).toFixed(1)
    console.log(`   ✅ Push completado en ${pushTime}s`)

    console.log('')
    console.log('════════════════════════════════════════════════════════════')
    console.log('✅ ¡Migración a remoto completada!')
    console.log('════════════════════════════════════════════════════════════')

  } catch (error) {
    console.error('')
    console.error('❌ Error:', error instanceof Error ? error.message : error)
    process.exit(1)
  } finally {
    // Cleanup
    if (existsSync(dumpFile)) {
      try { unlinkSync(dumpFile) } catch {}
    }
  }
}

main()
