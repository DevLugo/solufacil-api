// Export schema SDL
import { readFileSync } from 'fs'
import { join } from 'path'

export const typeDefs = readFileSync(join(__dirname, 'schema.graphql'), 'utf-8')

// Export scalars
export { scalars, DecimalScalar } from './scalars'

// Export context type
export type { GraphQLContext } from './context'

// Export generated types (will be available after running codegen)
export * from '../generated/types'
