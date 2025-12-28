import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/services/__tests__/setup.ts'],
    testTimeout: 30000, // 30 seconds for integration tests
    hookTimeout: 30000,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', 'src/**/__tests__/'],
    },
  },
  resolve: {
    alias: {
      '@solufacil/database': resolve(__dirname, 'packages/database/src'),
      '@solufacil/shared': resolve(__dirname, 'packages/shared/src'),
      '@solufacil/business-logic': resolve(__dirname, 'packages/business-logic/src'),
    },
  },
})
