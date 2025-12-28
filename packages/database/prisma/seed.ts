import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'
import { Decimal } from 'decimal.js'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

const adapter = new PrismaPg(pool)

const prisma = new PrismaClient({
  adapter,
})

async function main() {
  console.log('Seeding database...')

  // Clean existing data
  console.log('Cleaning existing data...')
  await prisma.loanPayment.deleteMany()
  await prisma.loan.deleteMany()
  await prisma.borrower.deleteMany()
  await prisma.employee.deleteMany()
  await prisma.account.deleteMany()
  await prisma.address.deleteMany()
  await prisma.location.deleteMany()
  await prisma.route.deleteMany()
  await prisma.loantype.deleteMany()
  await prisma.municipality.deleteMany()
  await prisma.state.deleteMany()
  await prisma.personalData.deleteMany()
  await prisma.user.deleteMany()

  // ========================================
  // USERS
  // ========================================
  console.log('Creating users...')
  const adminPassword = await bcrypt.hash('admin123', 10)
  const testPassword = await bcrypt.hash('test123', 10)

  const adminUser = await prisma.user.create({
    data: {
      name: 'Admin',
      email: 'admin@solufacil.com',
      password: adminPassword,
      role: 'ADMIN',
    },
  })

  const testUser = await prisma.user.create({
    data: {
      name: 'Test User',
      email: 'test@solufacil.com',
      password: testPassword,
      role: 'NORMAL',
    },
  })

  console.log('  - admin@solufacil.com / admin123')
  console.log('  - test@solufacil.com / test123')

  // ========================================
  // STATE & MUNICIPALITIES
  // ========================================
  console.log('Creating states and municipalities...')
  const state = await prisma.state.create({
    data: { name: 'Jalisco' },
  })

  const municipalities = await Promise.all([
    prisma.municipality.create({ data: { name: 'Guadalajara', state: state.id } }),
    prisma.municipality.create({ data: { name: 'Zapopan', state: state.id } }),
    prisma.municipality.create({ data: { name: 'Tlaquepaque', state: state.id } }),
    prisma.municipality.create({ data: { name: 'Tonala', state: state.id } }),
  ])

  // ========================================
  // ROUTES (2 routes)
  // ========================================
  console.log('Creating routes...')
  const route1 = await prisma.route.create({ data: { name: 'Ruta Centro' } })
  const route2 = await prisma.route.create({ data: { name: 'Ruta Norte' } })

  // ========================================
  // LOCATIONS (Localities for each route)
  // ========================================
  console.log('Creating locations...')

  // Locations for Route 1 (Centro)
  const location1 = await prisma.location.create({
    data: { name: 'Centro Historico', municipality: municipalities[0].id, route: route1.id },
  })
  const location2 = await prisma.location.create({
    data: { name: 'Analco', municipality: municipalities[0].id, route: route1.id },
  })
  const location3 = await prisma.location.create({
    data: { name: 'Santa Tere', municipality: municipalities[0].id, route: route1.id },
  })

  // Locations for Route 2 (Norte)
  const location4 = await prisma.location.create({
    data: { name: 'Atemajac', municipality: municipalities[1].id, route: route2.id },
  })
  const location5 = await prisma.location.create({
    data: { name: 'Tabachines', municipality: municipalities[1].id, route: route2.id },
  })
  const location6 = await prisma.location.create({
    data: { name: 'Santa Margarita', municipality: municipalities[1].id, route: route2.id },
  })

  // ========================================
  // ACCOUNTS
  // ========================================
  console.log('Creating accounts...')
  const account1 = await prisma.account.create({
    data: {
      name: 'Caja Ruta Centro',
      type: 'EMPLOYEE_CASH_FUND',
      amount: new Decimal(50000),
      routes: { connect: { id: route1.id } },
    },
  })

  const account2 = await prisma.account.create({
    data: {
      name: 'Caja Ruta Norte',
      type: 'EMPLOYEE_CASH_FUND',
      amount: new Decimal(50000),
      routes: { connect: { id: route2.id } },
    },
  })

  const bankAccount = await prisma.account.create({
    data: {
      name: 'Banco Principal',
      type: 'BANK',
      amount: new Decimal(100000),
      routes: { connect: [{ id: route1.id }, { id: route2.id }] },
    },
  })

  // ========================================
  // EMPLOYEES (Leads & Grantors)
  // ========================================
  console.log('Creating employees...')

  // Route 1 employees
  const lead1Personal = await prisma.personalData.create({
    data: { fullName: 'Juan Perez', clientCode: 'EMP-001' },
  })
  const lead1 = await prisma.employee.create({
    data: {
      type: 'LEAD',
      personalData: lead1Personal.id,
      routes: { connect: { id: route1.id } },
    },
  })

  const grantor1Personal = await prisma.personalData.create({
    data: { fullName: 'Maria Garcia', clientCode: 'EMP-002' },
  })
  const grantor1 = await prisma.employee.create({
    data: {
      type: 'ROUTE_LEAD',
      personalData: grantor1Personal.id,
      routes: { connect: { id: route1.id } },
    },
  })

  // Route 2 employees
  const lead2Personal = await prisma.personalData.create({
    data: { fullName: 'Carlos Lopez', clientCode: 'EMP-003' },
  })
  const lead2 = await prisma.employee.create({
    data: {
      type: 'LEAD',
      personalData: lead2Personal.id,
      routes: { connect: { id: route2.id } },
    },
  })

  const grantor2Personal = await prisma.personalData.create({
    data: { fullName: 'Ana Martinez', clientCode: 'EMP-004' },
  })
  const grantor2 = await prisma.employee.create({
    data: {
      type: 'ROUTE_LEAD',
      personalData: grantor2Personal.id,
      routes: { connect: { id: route2.id } },
    },
  })

  // ========================================
  // LOANTYPE
  // ========================================
  console.log('Creating loan types...')
  const loantype = await prisma.loantype.create({
    data: {
      name: 'Credito 10 Semanas',
      weekDuration: 10,
      rate: new Decimal(0.20),
      loanPaymentComission: new Decimal(8),
      loanGrantedComission: new Decimal(50),
    },
  })

  // ========================================
  // BORROWERS & LOANS
  // ========================================
  console.log('Creating borrowers and loans...')

  const borrowersData = [
    // Route 1 borrowers (Centro)
    { name: 'Roberto Sanchez', code: 'CLI-001', location: location1, route: route1, lead: lead1, grantor: grantor1 },
    { name: 'Elena Torres', code: 'CLI-002', location: location1, route: route1, lead: lead1, grantor: grantor1 },
    { name: 'Miguel Hernandez', code: 'CLI-003', location: location2, route: route1, lead: lead1, grantor: grantor1 },
    { name: 'Patricia Flores', code: 'CLI-004', location: location2, route: route1, lead: lead1, grantor: grantor1 },
    { name: 'Fernando Ramirez', code: 'CLI-005', location: location3, route: route1, lead: lead1, grantor: grantor1 },
    // Route 2 borrowers (Norte)
    { name: 'Sofia Morales', code: 'CLI-006', location: location4, route: route2, lead: lead2, grantor: grantor2 },
    { name: 'Diego Cruz', code: 'CLI-007', location: location4, route: route2, lead: lead2, grantor: grantor2 },
    { name: 'Carmen Ortiz', code: 'CLI-008', location: location5, route: route2, lead: lead2, grantor: grantor2 },
    { name: 'Ricardo Vargas', code: 'CLI-009', location: location5, route: route2, lead: lead2, grantor: grantor2 },
    { name: 'Lucia Mendoza', code: 'CLI-010', location: location6, route: route2, lead: lead2, grantor: grantor2 },
  ]

  const loanAmounts = [1000, 1500, 2000, 2500, 3000]

  for (let i = 0; i < borrowersData.length; i++) {
    const b = borrowersData[i]
    const amount = loanAmounts[i % loanAmounts.length]
    const profit = amount * 0.20
    const totalDebt = amount + profit
    const weeklyPayment = totalDebt / 10

    // Create personal data with address
    const personalData = await prisma.personalData.create({
      data: {
        fullName: b.name,
        clientCode: b.code,
        addresses: {
          create: {
            street: `Calle ${i + 1}`,
            exteriorNumber: `${100 + i}`,
            location: b.location.id,
          },
        },
      },
    })

    // Create borrower
    const borrower = await prisma.borrower.create({
      data: { personalData: personalData.id },
    })

    // Create active loan
    await prisma.loan.create({
      data: {
        requestedAmount: new Decimal(amount),
        amountGived: new Decimal(amount),
        profitAmount: new Decimal(profit),
        totalDebtAcquired: new Decimal(totalDebt),
        expectedWeeklyPayment: new Decimal(weeklyPayment),
        totalPaid: new Decimal(0),
        pendingAmountStored: new Decimal(totalDebt),
        comissionAmount: new Decimal(50),
        status: 'ACTIVE',
        borrower: borrower.id,
        loantype: loantype.id,
        lead: b.lead.id,
        grantor: b.grantor.id,
        signDate: new Date(),
        snapshotLeadId: b.lead.id,
        snapshotRouteName: b.route.name,
        snapshotRouteId: b.route.id,
      },
    })
  }

  console.log('\n========================================')
  console.log('SEED COMPLETED!')
  console.log('========================================')
  console.log('Routes created: 2')
  console.log('  - Ruta Centro (3 localities, 5 active loans)')
  console.log('  - Ruta Norte (3 localities, 5 active loans)')
  console.log('Total active loans: 10')
  console.log('========================================\n')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
