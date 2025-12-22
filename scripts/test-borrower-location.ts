import { PrismaClient } from '@solufacil/database'

const prisma = new PrismaClient()

async function testBorrowerLocation() {
  const searchTerm = 'KARLA GUADALUPE VALENCIA'
  const locationId = 'cmfk2cb36005epshfennywuo1' // SEYBAPLAYA

  console.log('=== Test: Buscar borrower con location fallback ===')
  console.log(`Buscando: "${searchTerm}"`)
  console.log(`LocationId (SEYBAPLAYA): ${locationId}`)
  console.log('')

  const results = await prisma.borrower.findMany({
    where: {
      personalDataRelation: {
        fullName: {
          contains: searchTerm,
          mode: 'insensitive',
        },
      },
    },
    take: 5,
    include: {
      personalDataRelation: {
        include: {
          addresses: {
            include: {
              locationRelation: true,
            },
          },
        },
      },
      loans: {
        select: {
          id: true,
          status: true,
          lead: true,
          leadRelation: {
            select: {
              id: true,
              personalDataRelation: {
                select: {
                  fullName: true,
                  addresses: {
                    select: {
                      location: true,
                      locationRelation: {
                        select: {
                          id: true,
                          name: true,
                        },
                      },
                    },
                    take: 1,
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
    },
  })

  for (const borrower of results) {
    console.log(`\n--- Borrower: ${borrower.personalDataRelation?.fullName} ---`)

    // 1. Check borrower's own address
    const borrowerAddresses = borrower.personalDataRelation?.addresses || []
    const primaryBorrowerAddress = borrowerAddresses.find((addr) => addr.locationRelation?.name)

    let finalLocationId: string | undefined = primaryBorrowerAddress?.location
    let finalLocationName: string | undefined = primaryBorrowerAddress?.locationRelation?.name

    console.log(`Borrower tiene address propia: ${borrowerAddresses.length > 0 ? 'SÍ' : 'NO'}`)
    if (primaryBorrowerAddress) {
      console.log(`  - Location propia: ${finalLocationName} (${finalLocationId})`)
    }

    // 2. Fallback to lead's location
    if (!finalLocationId && borrower.loans.length > 0) {
      console.log(`\nBuscando location del lead (fallback)...`)
      console.log(`  - Préstamos encontrados: ${borrower.loans.length}`)

      for (const loan of borrower.loans) {
        console.log(`  - Loan ${loan.id}: lead=${loan.lead}`)

        const leadRelation = loan.leadRelation
        console.log(`    leadRelation exists: ${!!leadRelation}`)

        if (leadRelation) {
          console.log(`    leadRelation.personalDataRelation: ${!!leadRelation.personalDataRelation}`)
          console.log(`    Lead name: ${leadRelation.personalDataRelation?.fullName}`)

          const leadAddress = leadRelation.personalDataRelation?.addresses?.[0]
          console.log(`    leadAddress exists: ${!!leadAddress}`)

          if (leadAddress) {
            console.log(`    leadAddress.location: ${leadAddress.location}`)
            console.log(`    leadAddress.locationRelation: ${JSON.stringify(leadAddress.locationRelation)}`)

            if (leadAddress.location) {
              finalLocationId = leadAddress.location
              finalLocationName = leadAddress.locationRelation?.name
              console.log(`    ✅ Usando location del lead: ${finalLocationName} (${finalLocationId})`)
              break
            }
          }
        }
      }
    }

    // 3. Determine isFromCurrentLocation
    const isFromCurrentLocation = !locationId || !finalLocationId || finalLocationId === locationId

    console.log(`\n=== RESULTADO ===`)
    console.log(`finalLocationId: ${finalLocationId}`)
    console.log(`finalLocationName: ${finalLocationName}`)
    console.log(`locationId buscado: ${locationId}`)
    console.log(`isFromCurrentLocation: ${isFromCurrentLocation}`)
    console.log(`¿Debería mostrar warning? ${!isFromCurrentLocation ? 'SÍ' : 'NO'}`)
  }

  await prisma.$disconnect()
}

testBorrowerLocation().catch(console.error)
