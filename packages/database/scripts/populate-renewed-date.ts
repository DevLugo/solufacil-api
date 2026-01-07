/**
 * Script para poblar el campo renewedDate en préstamos históricos
 *
 * PROBLEMA: Los datos migrados del sistema anterior (Keystone) no tenían
 * el campo renewedDate poblado, lo que causa que el cálculo de renovaciones
 * muestre valores incorrectos.
 *
 * SOLUCIÓN: Poblar renewedDate en préstamos que fueron renovados (tienen
 * un préstamo hijo con previousLoan apuntando a ellos) usando la fecha
 * de firma del préstamo hijo.
 *
 * USO:
 *   npx tsx packages/database/scripts/populate-renewed-date.ts [--dry-run]
 *
 *   --dry-run: Solo muestra los cambios sin aplicarlos
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const isDryRun = process.argv.includes('--dry-run')

  console.log('='.repeat(60))
  console.log('Populate renewedDate Migration Script')
  console.log('='.repeat(60))
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}`)
  console.log('')

  // 1. Diagnosticar el problema
  console.log('📊 Diagnostic:')

  const loansWithPreviousLoan = await prisma.$queryRaw<[{ count: string }]>`
    SELECT COUNT(*) as count
    FROM "Loan"
    WHERE "previousLoan" IS NOT NULL
  `
  console.log(`   - Loans with previousLoan (are renewals): ${loansWithPreviousLoan[0].count}`)

  const renewedWithoutDate = await prisma.$queryRaw<[{ count: string }]>`
    SELECT COUNT(*) as count
    FROM "Loan" l
    WHERE EXISTS (
      SELECT 1 FROM "Loan" l2
      WHERE l2."previousLoan" = l.id
    )
    AND l."renewedDate" IS NULL
  `
  console.log(`   - Loans that WERE renewed but missing renewedDate: ${renewedWithoutDate[0].count}`)

  const renewedWithDate = await prisma.$queryRaw<[{ count: string }]>`
    SELECT COUNT(*) as count
    FROM "Loan"
    WHERE "renewedDate" IS NOT NULL
  `
  console.log(`   - Loans with renewedDate populated: ${renewedWithDate[0].count}`)

  console.log('')

  if (parseInt(renewedWithoutDate[0].count) === 0) {
    console.log('✅ No missing renewedDate values. Nothing to do.')
    return
  }

  // 2. Mostrar ejemplos de lo que se va a actualizar
  console.log('📋 Sample of loans to update (first 10):')

  const samplesToUpdate = await prisma.$queryRaw<Array<{
    id: string
    signDate: Date
    finishedDate: Date | null
    childSignDate: Date
    childId: string
  }>>`
    SELECT
      l.id,
      l."signDate",
      l."finishedDate",
      l2."signDate" as "childSignDate",
      l2.id as "childId"
    FROM "Loan" l
    INNER JOIN "Loan" l2 ON l2."previousLoan" = l.id
    WHERE l."renewedDate" IS NULL
    ORDER BY l."signDate" DESC
    LIMIT 10
  `

  for (const loan of samplesToUpdate) {
    console.log(`   - Loan ${loan.id.slice(0, 8)}... signed ${loan.signDate.toISOString().slice(0, 10)}`)
    console.log(`     → Will set renewedDate = ${loan.childSignDate.toISOString().slice(0, 10)} (from child ${loan.childId.slice(0, 8)}...)`)
  }

  console.log('')

  // 3. Ejecutar la actualización (o simular)
  if (isDryRun) {
    console.log('🔍 DRY RUN - No changes will be made.')
    console.log(`   Would update ${renewedWithoutDate[0].count} loans`)
  } else {
    console.log('🚀 Updating loans...')

    const result = await prisma.$executeRaw`
      UPDATE "Loan" l
      SET
        "renewedDate" = (
          SELECT l2."signDate"
          FROM "Loan" l2
          WHERE l2."previousLoan" = l.id
          ORDER BY l2."signDate" DESC
          LIMIT 1
        ),
        "updatedAt" = NOW()
      WHERE EXISTS (
        SELECT 1 FROM "Loan" l2
        WHERE l2."previousLoan" = l.id
      )
      AND l."renewedDate" IS NULL
    `

    console.log(`✅ Updated ${result} loans`)
  }

  // 4. Verificación final
  console.log('')
  console.log('📊 Final state:')

  const finalMissing = await prisma.$queryRaw<[{ count: string }]>`
    SELECT COUNT(*) as count
    FROM "Loan" l
    WHERE EXISTS (
      SELECT 1 FROM "Loan" l2
      WHERE l2."previousLoan" = l.id
    )
    AND l."renewedDate" IS NULL
  `
  console.log(`   - Loans still missing renewedDate: ${finalMissing[0].count}`)

  const finalWithDate = await prisma.$queryRaw<[{ count: string }]>`
    SELECT COUNT(*) as count
    FROM "Loan"
    WHERE "renewedDate" IS NOT NULL
  `
  console.log(`   - Loans with renewedDate populated: ${finalWithDate[0].count}`)

  console.log('')
  console.log('Done!')
}

main()
  .catch((e) => {
    console.error('Error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
