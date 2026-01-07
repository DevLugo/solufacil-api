import { prisma } from '@solufacil/database'

/**
 * Script para corregir préstamos que:
 * 1. Tienen pendingAmountStored <= 0 (ya pagaron todo)
 * 2. Pero no tienen finishedDate establecido
 *
 * Les ponemos finishedDate = fecha del último pago
 */
async function main() {
  console.log('=== Buscando préstamos sin finishedDate pero con deuda en 0 ===\n')

  // Buscar préstamos que deberían tener finishedDate
  const loansToFix = await prisma.loan.findMany({
    where: {
      pendingAmountStored: { lte: 0 },
      finishedDate: null,
      status: { not: 'CANCELLED' }
    },
    include: {
      payments: {
        orderBy: { receivedAt: 'desc' },
        take: 1
      },
      borrowerRelation: {
        include: { personalDataRelation: true }
      }
    }
  })

  console.log(`Encontrados: ${loansToFix.length} préstamos\n`)

  if (loansToFix.length === 0) {
    console.log('No hay préstamos que corregir.')
    await prisma.$disconnect()
    return
  }

  // Mostrar los préstamos a corregir
  for (const loan of loansToFix) {
    const lastPayment = loan.payments[0]
    const clientName = loan.borrowerRelation?.personalDataRelation?.fullName || 'N/A'

    console.log(`- ${clientName}`)
    console.log(`  Loan ID: ${loan.id}`)
    console.log(`  Status: ${loan.status}`)
    console.log(`  Pending: ${loan.pendingAmountStored}`)
    console.log(`  Last payment: ${lastPayment?.receivedAt?.toISOString() || 'NO PAYMENTS'}`)
    console.log()
  }

  // Preguntar confirmación
  console.log('¿Deseas corregir estos préstamos? Ejecuta con --fix para aplicar cambios.\n')

  if (process.argv.includes('--fix')) {
    console.log('=== APLICANDO CORRECCIONES ===\n')

    let fixed = 0
    let skipped = 0

    for (const loan of loansToFix) {
      const lastPayment = loan.payments[0]

      if (!lastPayment) {
        console.log(`SKIP: ${loan.id} - No tiene pagos`)
        skipped++
        continue
      }

      // Usar la fecha del último pago como finishedDate
      await prisma.loan.update({
        where: { id: loan.id },
        data: {
          finishedDate: lastPayment.receivedAt,
          status: 'FINISHED'
        }
      })

      console.log(`FIXED: ${loan.id} -> finishedDate = ${lastPayment.receivedAt.toISOString()}`)
      fixed++
    }

    console.log(`\n=== RESUMEN ===`)
    console.log(`Corregidos: ${fixed}`)
    console.log(`Saltados: ${skipped}`)
  }

  await prisma.$disconnect()
}

main().catch(console.error)
