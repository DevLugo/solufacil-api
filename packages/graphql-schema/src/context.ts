import { PrismaClient, UserRole } from '@solufacil/database'

export interface GraphQLContext {
  prisma: PrismaClient
  user?: {
    id: string
    email: string
    role: UserRole
  }
  req: any
  res: any
}
