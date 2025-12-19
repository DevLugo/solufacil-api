import type { CodegenConfig } from '@graphql-codegen/cli'

const config: CodegenConfig = {
  schema: './src/schema.graphql',
  generates: {
    './generated/types.ts': {
      plugins: ['typescript', 'typescript-resolvers'],
      config: {
        useIndexSignature: true,
        contextType: '../src/context#GraphQLContext',
        scalars: {
          DateTime: 'Date',
          Decimal: 'string',
          JSON: 'Record<string, any>',
          Upload: 'Promise<{ createReadStream: () => NodeJS.ReadableStream; filename: string; mimetype: string; encoding: string }>',
        },
      },
    },
  },
}

export default config
