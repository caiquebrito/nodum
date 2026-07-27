import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Some packages (e.g. server) have no tests yet — don't hard-fail CI for
    // that; a package with tests that all fail still fails normally.
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['packages/**/src/**/*.ts'],
      exclude: ['node_modules', 'dist']
    }
  }
});
