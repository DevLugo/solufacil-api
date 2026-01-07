// Export Prisma client - Prisma 7
export { prisma, currentSchema, type PrismaTransaction, type ExtendedPrismaClient } from './client'

// Re-export Prisma types from @prisma/client
export * from '@prisma/client'

// Export Decimal from decimal.js for calculations
// In Prisma 7, Decimal should be imported from decimal.js directly
export { Decimal } from 'decimal.js'
