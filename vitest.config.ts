import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Two projects (see .claude/skills/vitest-testing): `node` for logic tests and
// daemon integration tests, `renderer` for React components in jsdom against
// the fake window.que bridge. Globals are off in both.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@daemon': resolve(__dirname, 'src/daemon'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    globals: false,
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'src/{daemon,cli,shared}/**/*.test.ts',
            'src/testing/**/*.test.ts',
            'tests/integration/**/*.test.ts',
            'tests/contract/**/*.test.ts'
          ],
          testTimeout: 20_000,
          hookTimeout: 20_000
        }
      },
      {
        extends: true,
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.tsx'],
          setupFiles: ['src/renderer/src/testing/setup.ts']
        }
      }
    ]
  }
})
