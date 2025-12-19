import { prisma, UserRole } from '@solufacil/database'
import type { GraphQLContext } from '@solufacil/graphql-schema'

// Re-export GraphQLContext for convenience
export type { GraphQLContext } from '@solufacil/graphql-schema'

export interface AuthUser {
  id: string
  email: string
  role: UserRole
}

export async function createContext({ req, res }: any): Promise<GraphQLContext> {
  return {
    prisma,
    req,
    res,
    user: undefined, // Will be set by auth middleware
  }
}
