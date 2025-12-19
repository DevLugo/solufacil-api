/**
 * Script de diagnóstico para el bug de CV
 *
 * Este script verifica por qué algunos clientes con badDebtDate o excludedByCleanup
 * están apareciendo en los detalles de localidad.
 *
 * Uso: npx tsx scripts/diagnose-cv-bug.ts
 */

import 'dotenv/config'
import { prisma } from '../src'

async function diagnoseClient(clientCode: string) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Diagnóstico para cliente: ${clientCode}`)
  console.log('='.repeat(60))

  // 1. Buscar el cliente por código
  const personalData = await prisma.personalData.findFirst({
    where: { clientCode },
    include: {
      addresses: {
        include: {
          locationRelation: {
            include: {
              routeRelation: true,
            },
          },
        },
      },
    },
  })

  if (!personalData) {
    console.log(`❌ Cliente con código ${clientCode} no encontrado`)
    return
  }

  console.log(`\n📋 Datos del cliente:`)
  console.log(`   - ID: ${personalData.id}`)
  console.log(`   - Nombre: ${personalData.fullName}`)
  console.log(`   - Direcciones:`)
  for (const addr of personalData.addresses) {
    console.log(`     - ${addr.locationRelation?.name || 'Sin localidad'} (${addr.locationRelation?.routeRelation?.name || 'Sin ruta'})`)
  }

  // 2. Buscar todos los préstamos donde este personal es borrower
  const loansAsBorrower = await prisma.loan.findMany({
    where: {
      borrowerRelation: {
        personalDataRelation: {
          clientCode,
        },
      },
    },
    include: {
      borrowerRelation: {
        include: {
          personalDataRelation: true,
        },
      },
    },
    orderBy: { signDate: 'desc' },
  })

  console.log(`\n💰 Préstamos como PRESTATARIO: ${loansAsBorrower.length}`)
  for (const loan of loansAsBorrower) {
    console.log(`\n   Préstamo: ${loan.id}`)
    console.log(`   - signDate: ${loan.signDate?.toISOString() || 'null'}`)
    console.log(`   - pendingAmountStored: ${loan.pendingAmountStored}`)
    console.log(`   - badDebtDate: ${loan.badDebtDate?.toISOString() || 'NULL'}`)
    console.log(`   - excludedByCleanup: ${loan.excludedByCleanup || 'NULL'}`)
    console.log(`   - renewedDate: ${loan.renewedDate?.toISOString() || 'NULL'}`)
    console.log(`   - finishedDate: ${loan.finishedDate?.toISOString() || 'NULL'}`)

    // Verificar si debería aparecer en el reporte
    const shouldAppear =
      Number(loan.pendingAmountStored) > 0 &&
      loan.badDebtDate === null &&
      loan.excludedByCleanup === null &&
      loan.renewedDate === null &&
      loan.finishedDate === null

    console.log(`   - ¿Debería aparecer en reporte?: ${shouldAppear ? '✅ SÍ' : '❌ NO'}`)
    if (!shouldAppear) {
      const reasons = []
      if (Number(loan.pendingAmountStored) <= 0) reasons.push('pendingAmount <= 0')
      if (loan.badDebtDate !== null) reasons.push('tiene badDebtDate')
      if (loan.excludedByCleanup !== null) reasons.push('tiene excludedByCleanup')
      if (loan.renewedDate !== null) reasons.push('tiene renewedDate')
      if (loan.finishedDate !== null) reasons.push('tiene finishedDate')
      console.log(`   - Razones de exclusión: ${reasons.join(', ')}`)
    }
  }

  // 3. Buscar préstamos donde es lead (promotor)
  const loansAsLead = await prisma.loan.findMany({
    where: {
      leadRelation: {
        personalDataRelation: {
          clientCode,
        },
      },
    },
    include: {
      leadRelation: {
        include: {
          personalDataRelation: true,
        },
      },
      borrowerRelation: {
        include: {
          personalDataRelation: true,
        },
      },
    },
    orderBy: { signDate: 'desc' },
  })

  console.log(`\n👤 Préstamos como LEAD/PROMOTOR: ${loansAsLead.length}`)
  for (const loan of loansAsLead) {
    console.log(`\n   Préstamo: ${loan.id}`)
    console.log(`   - Prestatario: ${loan.borrowerRelation?.personalDataRelation?.fullName || 'N/A'}`)
    console.log(`   - badDebtDate: ${loan.badDebtDate?.toISOString() || 'NULL'}`)
    console.log(`   - excludedByCleanup: ${loan.excludedByCleanup || 'NULL'}`)
  }
}

async function checkLocalityQuery(localityId: string, year: number, month: number) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Verificando query de localidad: ${localityId}`)
  console.log('='.repeat(60))

  // Simular la query de getLocalityClients
  const whereClause = {
    pendingAmountStored: { gt: 0 },
    badDebtDate: null,
    excludedByCleanup: null,
    renewedDate: null,
    finishedDate: null,
    leadRelation: {
      personalDataRelation: {
        addresses: {
          some: {
            location: localityId,
          },
        },
      },
    },
  }

  console.log('\n📝 WHERE clause aplicado:')
  console.log(JSON.stringify(whereClause, null, 2))

  const loans = await prisma.loan.findMany({
    where: whereClause,
    include: {
      borrowerRelation: {
        include: {
          personalDataRelation: true,
        },
      },
    },
    take: 50,
  })

  console.log(`\n📊 Préstamos encontrados: ${loans.length}`)

  // Verificar si algún préstamo tiene badDebtDate o excludedByCleanup (no debería)
  const loansWithBadDebt = loans.filter(l => l.badDebtDate !== null)
  const loansWithCleanup = loans.filter(l => l.excludedByCleanup !== null)

  if (loansWithBadDebt.length > 0) {
    console.log(`\n⚠️  PROBLEMA: ${loansWithBadDebt.length} préstamos con badDebtDate encontrados:`)
    for (const loan of loansWithBadDebt) {
      console.log(`   - ${loan.id}: badDebtDate = ${loan.badDebtDate}`)
    }
  }

  if (loansWithCleanup.length > 0) {
    console.log(`\n⚠️  PROBLEMA: ${loansWithCleanup.length} préstamos con excludedByCleanup encontrados:`)
    for (const loan of loansWithCleanup) {
      console.log(`   - ${loan.id}: excludedByCleanup = ${loan.excludedByCleanup}`)
    }
  }

  if (loansWithBadDebt.length === 0 && loansWithCleanup.length === 0) {
    console.log('\n✅ Todos los préstamos están correctamente filtrados')
  }

  // Mostrar algunos ejemplos
  console.log('\n📋 Primeros 5 préstamos:')
  for (const loan of loans.slice(0, 5)) {
    console.log(`   - ${loan.borrowerRelation?.personalDataRelation?.fullName || 'N/A'} (${loan.borrowerRelation?.personalDataRelation?.clientCode || 'N/A'})`)
  }
}

async function findLocalityIdByName(localityName: string) {
  const location = await prisma.location.findFirst({
    where: {
      name: {
        contains: localityName,
        mode: 'insensitive'
      }
    },
  })

  if (location) {
    console.log(`\n📍 Localidad encontrada: ${location.name} (ID: ${location.id})`)
    return location.id
  } else {
    console.log(`\n❌ Localidad "${localityName}" no encontrada`)
    return null
  }
}

async function main() {
  try {
    // 1. Diagnosticar el cliente específico mencionado por el usuario
    await diagnoseClient('BHC8CJ')

    // 2. Buscar la localidad "San Francisco"
    const localityId = await findLocalityIdByName('san francisco')

    // 3. Si encontramos la localidad, verificar la query
    if (localityId) {
      await checkLocalityQuery(localityId, 2025, 12)
    }

    // 4. También verificar si hay préstamos con valores "falsy" en vez de null
    console.log(`\n${'='.repeat(60)}`)
    console.log('Verificando datos inconsistentes en la BD')
    console.log('='.repeat(60))

    // Préstamos con badDebtDate como string vacío
    const emptyBadDebt = await prisma.$queryRaw`
      SELECT id, "badDebtDate" FROM "Loan"
      WHERE "badDebtDate" IS NOT NULL
      AND "pendingAmountStored" > 0
      LIMIT 5
    `
    console.log('\n📊 Préstamos activos con badDebtDate (no null):')
    console.log(emptyBadDebt)

    // Préstamos con excludedByCleanup como string vacío
    const emptyCleanup = await prisma.$queryRaw`
      SELECT id, "excludedByCleanup" FROM "Loan"
      WHERE "excludedByCleanup" IS NOT NULL
      AND "excludedByCleanup" != ''
      AND "pendingAmountStored" > 0
      LIMIT 5
    `
    console.log('\n📊 Préstamos activos con excludedByCleanup (no null, no vacío):')
    console.log(emptyCleanup)

  } catch (error) {
    console.error('Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

main()
