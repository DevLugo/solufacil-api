/**
 * Script para sincronizar AccountEntry entre bases de datos
 * Usa COPY para máxima eficiencia (10-50x más rápido que INSERTs)
 *
 * Uso:
 *   npx tsx scripts/sync-account-entries.ts
 *
 * Variables de entorno requeridas:
 *   - SOURCE_DATABASE_URL: BD de origen (local)
 *   - TARGET_DATABASE_URL: BD de destino (remote/prod)
 */

import 'dotenv/config'
import { Client } from 'pg'
import { pipeline } from 'stream/promises'
import { from as copyFrom } from 'pg-copy-streams'
import { to as copyTo } from 'pg-copy-streams'
import * as readline from 'readline'

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve)
  })
}

const COLUMNS = [
  'id', 'accountId', 'entryType', 'amount', 'sourceType', 'entryDate',
  'description', 'loanId', 'loanPaymentId', 'destinationAccountId',
  'profitAmount', 'returnToCapital', 'snapshotLeadId', 'snapshotRouteId',
  'leadPaymentReceivedId', 'createdAt', 'syncId'
]

async function main() {
  const sourceUrl = process.env.SOURCE_DATABASE_URL
  const destUrl = process.env.TARGET_DATABASE_URL

  if (!sourceUrl || !destUrl) {
    console.error('❌ Faltan variables de entorno:')
    console.error('   - SOURCE_DATABASE_URL (origen)')
    console.error('   - TARGET_DATABASE_URL (destino)')
    process.exit(1)
  }

  console.log('\n🔄 Sincronización de AccountEntry (COPY optimizado)\n')
  console.log('📤 Origen:', sourceUrl.replace(/:[^:@]+@/, ':****@'))
  console.log('📥 Destino:', destUrl.replace(/:[^:@]+@/, ':****@'))

  const sourceClient = new Client({ connectionString: sourceUrl })
  const destClient = new Client({ connectionString: destUrl })

  try {
    await sourceClient.connect()
    await destClient.connect()
    console.log('\n✅ Conectado a ambas bases de datos\n')

    // Contar registros en origen
    const sourceCount = await sourceClient.query('SELECT COUNT(*) as count FROM "AccountEntry"')
    console.log(`📊 Registros en ORIGEN: ${parseInt(sourceCount.rows[0].count).toLocaleString()}`)

    // Contar registros en destino
    const destCount = await destClient.query('SELECT COUNT(*) as count FROM "AccountEntry"')
    console.log(`📊 Registros en DESTINO: ${parseInt(destCount.rows[0].count).toLocaleString()}`)

    // Obtener fecha más reciente en destino
    const lastDateResult = await destClient.query('SELECT MAX("createdAt") as last_date FROM "AccountEntry"')
    const lastDate = lastDateResult.rows[0].last_date
    console.log(`📅 Último registro en DESTINO: ${lastDate || 'N/A'}`)

    // Preguntar fecha de corte
    console.log('\n')
    console.log('💡 Se BORRARÁN registros ANTES de la fecha de corte')
    console.log('💡 Se MANTENDRÁN registros DESDE la fecha de corte en adelante')
    const cutoffInput = await ask('🕐 Fecha/hora de corte (YYYY-MM-DD HH:MM o "enter" para usar última fecha): ')

    let cutoffDate: string
    if (!cutoffInput.trim()) {
      if (!lastDate) {
        console.error('❌ No hay registros en destino y no se especificó fecha')
        process.exit(1)
      }
      cutoffDate = lastDate.toISOString()
    } else {
      cutoffDate = new Date(cutoffInput).toISOString()
    }

    console.log(`\n📅 Fecha de corte: ${cutoffDate}`)

    // Contar cuántos se borrarán
    const toDeleteResult = await destClient.query(
      'SELECT COUNT(*) as count FROM "AccountEntry" WHERE "createdAt" < $1',
      [cutoffDate]
    )
    const toDeleteCount = parseInt(toDeleteResult.rows[0].count)
    console.log(`🗑️  Registros a BORRAR en destino: ${toDeleteCount.toLocaleString()}`)

    // Contar cuántos se insertarán
    const toInsertCount = parseInt(sourceCount.rows[0].count)
    console.log(`📥 Registros a INSERTAR desde origen: ${toInsertCount.toLocaleString()}`)

    // Confirmar
    const confirm = await ask('\n⚠️  ¿Continuar? (escribe "SI" para confirmar): ')
    if (confirm.toUpperCase() !== 'SI') {
      console.log('❌ Operación cancelada')
      process.exit(0)
    }

    console.log('\n🚀 Iniciando sincronización...\n')

    // 1. Borrar registros en destino
    console.log('1️⃣  Borrando registros en destino...')
    const deleteStart = Date.now()
    await destClient.query('DELETE FROM "AccountEntry" WHERE "createdAt" < $1', [cutoffDate])
    console.log(`   ✅ Borrados en ${((Date.now() - deleteStart) / 1000).toFixed(1)}s`)

    // 2. COPY directo entre bases de datos (streaming)
    console.log('2️⃣  Copiando datos con COPY (streaming)...')
    const copyStart = Date.now()

    const columnsQuoted = COLUMNS.map(c => `"${c}"`).join(', ')

    // Stream de origen (genera syncId fake con gen_random_uuid)
    const selectColumns = COLUMNS.map(c => c === 'syncId' ? `gen_random_uuid()::text as "syncId"` : `"${c}"`).join(', ')
    const copyToQuery = `COPY (SELECT ${selectColumns} FROM "AccountEntry" ORDER BY "createdAt") TO STDOUT WITH (FORMAT binary)`
    const sourceStream = sourceClient.query(copyTo(copyToQuery))

    // Stream a destino
    const copyFromQuery = `COPY "AccountEntry" (${columnsQuoted}) FROM STDIN WITH (FORMAT binary)`
    const destStream = destClient.query(copyFrom(copyFromQuery))

    // Pipe directo
    await pipeline(sourceStream, destStream)

    console.log(`   ✅ Copiados en ${((Date.now() - copyStart) / 1000).toFixed(1)}s`)

    // 3. Verificar conteo final
    console.log('3️⃣  Verificando...')
    const finalCount = await destClient.query('SELECT COUNT(*) as count FROM "AccountEntry"')
    console.log(`   📊 Registros finales en DESTINO: ${parseInt(finalCount.rows[0].count).toLocaleString()}`)

    const totalTime = ((Date.now() - deleteStart) / 1000).toFixed(1)
    console.log(`\n✅ ¡Sincronización completada en ${totalTime}s!\n`)

  } catch (error) {
    console.error('\n❌ Error:', error)
    process.exit(1)
  } finally {
    await sourceClient.end()
    await destClient.end()
    rl.close()
  }
}

main()
