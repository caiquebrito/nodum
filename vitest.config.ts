import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Some packages (e.g. server) have no tests yet — don't hard-fail CI for
    // that; a package with tests that all fail still fails normally.
    passWithNoTests: true,
    // Vitest's default `threads` pool runs test files as worker_threads
    // sharing one V8 instance. Once enough tree-sitter grammars (spec 037
    // added Swift, the 4th, alongside Python/Java/JavaScript from specs
    // 031-033) get JIT-compiled across that shared instance, V8's wasm
    // compiler reliably OOMs with a "Fatal process out of memory: Zone"
    // crash — reproduced with `--max-old-space-size` raised to 8GB, so it's
    // not a JS heap limit; it's specific to worker_threads sharing wasm
    // compilation state. `forks` runs each test file in its own OS process
    // (separate V8 instance), which sidesteps this entirely — verified: 32
    // files / 306 tests green under `forks`, reproducible crash under the
    // default `threads` pool even with a raised heap.
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['packages/**/src/**/*.ts'],
      exclude: ['node_modules', 'dist']
    }
  }
});
