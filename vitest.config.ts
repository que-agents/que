import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Two projects (see .claude/skills/vitest-testing): `node` for logic tests and
// daemon integration tests, `renderer` for React components in jsdom against
// the fake window.que bridge. Globals are off in both.
// Coverage (`npm run test:coverage`, and in CI) is reporting only; a floor is a
// follow-up to #85, so there is no `thresholds` block.
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
    // Root-level only: coverage is one report across both projects.
    coverage: {
      provider: 'v8',
      // `out/` is outside `src/`, so the built bundles never count.
      include: ['src/**'],
      // Vitest also drops files matching the root `test.include`; listed here so
      // the intent is readable.
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/testing/**',
        'src/renderer/src/testing/**',
        'src/**/*.d.ts'
      ],
      // A failing run still writes the report, so CI can always show the numbers.
      reportOnFailure: true,
      reporter: ['text-summary', 'json-summary', 'html', 'lcov']
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'src/{daemon,cli,shared,main}/**/*.test.ts',
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
          include: ['src/renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['src/renderer/src/testing/setup.ts']
        }
      }
    ]
  }
})
