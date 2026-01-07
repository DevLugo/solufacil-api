import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

// Singleton pattern para Prisma Client
// Evita múltiples instancias en desarrollo (hot reload)
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  pool: Pool | undefined
}

// Prisma 7: Crear pool de conexiones y adapter
const pool = globalForPrisma.pool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
})

// Extract schema from DATABASE_URL or default to 'public'
export const getSchemaFromUrl = (url?: string): string => {
  if (!url) return 'public'
  try {
    const parsed = new URL(url)
    return parsed.searchParams.get('schema') || 'public'
  } catch {
    return 'public'
  }
}

// Export the current schema for use in raw queries
export const currentSchema = getSchemaFromUrl(process.env.DATABASE_URL)

const adapter = new PrismaPg(pool, {
  schema: getSchemaFromUrl(process.env.DATABASE_URL),
})

// Prisma 7: Configuración del cliente con adapter
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: ['error', 'warn'],
    transactionOptions: {
      maxWait: 5000,
      timeout: 10000,
    },
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
  globalForPrisma.pool = pool
}

// Helper para transacciones - compatible con Prisma 7
export type PrismaTransaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

// Prisma 7: Export del tipo del cliente extendido
export type ExtendedPrismaClient = typeof prisma
