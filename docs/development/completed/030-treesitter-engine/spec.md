# 030 — Tree-sitter engine + parser-registry plumbing

## Status: done

Implemented and tested (11 new tests: `treesitter/engine.test.ts` (5), `treesitter/base.test.ts`
(2), plus 4 extending `scan-config.test.ts`/`file-discovery.test.ts`; full workspace suite — 207
core, 95 cli, 58 mcp, 8 benchmarks, 368 total — green). Two empirical checks required by this
spec's own Design ran **before** any parser code was written, not after: a scratch `tsc --noEmit`
proving `web-tree-sitter`'s shipped types resolve under this repo's `moduleResolution: "node"`
(zero errors), and a real (non-mocked) load-and-query smoke test against all four grammars this
repo will use (Python, Java, JavaScript, Kotlin — Kotlin loads fine too, though it isn't migrated
this release). Real check for the zero-behavior-change claim: synced a small hand-built
Kotlin fixture project with the pre-030 code (`git stash`) and again with this spec's code —
**byte-identical `graph.json`** for both runs.

## Goal

Add a tree-sitter runtime to `packages/core` and change `Parser.parse()`'s signature to
`Promise<ParseResult>`, with zero behavior change to any existing language and zero language
migration yet — this spec is pure foundation for 031–033. Close the three abstraction leaks the
v2.3.0 roadmap named, so a new language's import resolution and ignored-directory conventions
live in its own parser file instead of a hardcoded branch in `core`.

## Why now

Every subsequent spec in this batch (031 Python, 032 Java, 033 JavaScript) needs this plumbing to
exist first: the async `parse()` signature, the shared grammar/query cache, and the
`resolveImport()`/`ignoredDirs` extension points on `Parser`. Doing it as its own spec, with no
language migration mixed in, means a regression in 031–033 can be isolated to that language's own
change — this spec's diff is the one place "did the plumbing itself work" gets verified in
isolation.

## Scope

- **Dependencies** (`packages/core/package.json`): `web-tree-sitter@^0.25.10` (pinned — 0.26.x
  cannot load `.wasm` grammars built by older tree-sitter-cli, tree-sitter#5171, and
  `tree-sitter-wasms`' bundled grammars are older-CLI-built) and `tree-sitter-wasms@^0.1.13`
  (prebuilt grammars for Python/Java/JavaScript/Kotlin, no `exports` map).
- `packages/core/src/parser/treesitter/engine.ts` (new): the shared runtime. `Parser.init()`
  memoized once per process; `loadGrammar(grammarFile)` resolves a `tree-sitter-wasms/out/*.wasm`
  path via `createRequire(import.meta.url).resolve(...)` (works under any `moduleResolution` —
  it's a plain filesystem path, not a TS-resolved import specifier) and memoizes the loaded
  `Language`; `getQuery(language, cacheKey, source)` compiles and memoizes a `Query` — never
  recompiled per file.
- `packages/core/src/parser/treesitter/base.ts` (new): `TreeSitterParser extends Parser` — each
  instance lazily awaits its own grammar-load promise inside `parse()` via `ensureReady()`,
  memoized after the first call. This is what keeps the registry (`parser/index.ts`) a
  synchronous array of eagerly-constructed instances despite the underlying grammar load being
  async — `new PythonParser()` is instant; only the first `parse()` call on it pays the WASM cost.
  No concrete language uses this yet (031 is the first consumer) — this spec proves the pattern
  works via a dummy subclass in its own test.
- **`Parser.parse()` → `Promise<ParseResult>`** (`parser/base.ts`). All five existing parsers
  updated to match: TypeScript/JavaScript/Python/Kotlin/Java all just gained `async` on their
  existing synchronous bodies — no internal `await`, which is valid and was the plan's explicit
  recommendation over restructuring their logic. `graph-gen.ts`'s `parseFilesInto` (already inside
  an `async` function) now `await`s `parser.parse(file)`.
- **`registerParser()`** (`parser/index.ts`, exported from `core/src/index.ts`): `unshift`s onto
  the registry array, so a runtime-registered parser can override an extension the built-in
  registry already claims — the same priority `TypeScriptParser` already has by being first in the
  array. Also fixed `Parser` itself being exported as a type-only re-export from `core/src/index.ts`
  (`export type { Parser }`) — a real bug for this feature specifically, since `registerParser()`
  is useless if nothing outside `core` can `extends Parser` as a real class.
- **Leak 1 — `graph-gen.ts:183-217`'s hardcoded `TS_JS_EXTENSIONS`/`JVM_EXTENSIONS` dispatch**:
  replaced with an optional `resolveImport(specifier, importingFilePath, knownFileIds,
  knownFilesByPath): string[]` method on `Parser`. `resolveImportsInto` now looks up
  `selectParser(ext)` per raw-import batch and delegates to `.resolveImport` if present, skipping
  silently if not (same behavior as before for a parser with nothing to resolve).
  `TypeScriptParser`/`JavaScriptParser` delegate to `resolveRelativeImport`;
  `KotlinParser`/`JavaParser` delegate to `resolveJvmImport` — **both call the same shared helper
  function**, verified explicitly (see Design), so Java migrating to tree-sitter in 032 doesn't
  disturb Kotlin's import resolution at all.
- **Leak 2 — `import-resolver.ts:4`'s duplicate `TS_JS_EXTENSIONS` array**: resolved as a
  side-effect of Leak 1's fix, not a separate deletion — once `graph-gen.ts`'s copy is gone,
  `import-resolver.ts`'s is the only one left, which is correctly its home (the module that owns
  relative-import resolution needs to know candidate extensions to try).
- **Leak 3 — `file-discovery.ts:8-28`'s flat hardcoded `IGNORED_DIRS`**: split into a private
  `CROSS_CUTTING_IGNORED_DIRS` (dirs no language ecosystem owns — `node_modules`, `.git`, `dist`,
  etc.) and an optional `ignoredDirs?: string[]` property on `Parser`
  (`PythonParser.ignoredDirs = ['__pycache__', '.venv', 'venv']`;
  `KotlinParser`/`JavaParser.ignoredDirs = ['.gradle', 'target']`). The public `IGNORED_DIRS`
  export stays a plain `Set<string>` constant, computed once at module load by merging the two —
  **not** turned into a function, since `packages/cli/src/commands/watch.ts:7,42` already consumes
  it directly as a synchronous `Set` (and mocks it as one in `watch.test.ts:34`); changing that
  public shape would have been unrelated churn to a different package. Per-project
  `.nodumrc.json` `ignoredDirs` (new `ScanConfig` field, additive like `exclude`) is applied
  separately in `discoverFiles`/`discoverChangedFiles`, which already have per-project config in
  scope that the module-level constant doesn't.

## Out of scope

- Any actual language migration — 031/032/033's job. This spec's `TreeSitterParser` base class has
  no concrete subclass yet outside its own test.
- Making the parser registry itself async — considered and rejected (see Design); the lazy
  per-instance pattern was the approved approach specifically to avoid this.
- `calls` edges, `Graph` type consolidation — specs 034/035.
- Fixing the pre-existing `packages/core/tsconfig.json` gap where its own `exclude` (`["node_modules",
  "dist"]`) doesn't re-exclude `*.test.ts` the way the root tsconfig's does — noticed while reading
  both tsconfigs for the `moduleResolution` check, but unrelated to this spec's actual work.

## Design

### 1. `packages/core/src/parser/treesitter/engine.ts`

```ts
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { Parser as TSParser, Language, Query } from 'web-tree-sitter';

const require = createRequire(import.meta.url);
let initPromise: Promise<void> | null = null;
function ensureInitialized(): Promise<void> {
  if (!initPromise) initPromise = TSParser.init();
  return initPromise;
}

const languageCache = new Map<string, Promise<Language>>();
function loadLanguage(grammarFile: string): Promise<Language> {
  let cached = languageCache.get(grammarFile);
  if (!cached) {
    cached = ensureInitialized().then(async () => {
      const wasmPath = require.resolve(`tree-sitter-wasms/out/${grammarFile}`);
      return Language.load(await readFile(wasmPath));
    });
    languageCache.set(grammarFile, cached);
  }
  return cached;
}

const queryCache = new Map<string, Query>();
function getQuery(language: Language, cacheKey: string, source: string): Query {
  let cached = queryCache.get(cacheKey);
  if (!cached) { cached = new Query(language, source); queryCache.set(cacheKey, cached); }
  return cached;
}

export async function loadGrammar(grammarFile: string): Promise<{ language: Language; parser: TSParser }> {
  const language = await loadLanguage(grammarFile);
  const parser = new TSParser();
  parser.setLanguage(language);
  return { language, parser };
}
export { Query, getQuery };
export type { Language, QueryCapture, QueryMatch, Node as TSNode, Tree as TSTree } from 'web-tree-sitter';
```

### 2. `packages/core/src/parser/treesitter/base.ts`

```ts
import { Parser } from '../base.js';
import { loadGrammar, type LoadedGrammar } from './engine.js';

export abstract class TreeSitterParser extends Parser {
  protected abstract grammarFile: string;
  private ready: Promise<LoadedGrammar> | null = null;
  protected ensureReady(): Promise<LoadedGrammar> {
    if (!this.ready) this.ready = loadGrammar(this.grammarFile);
    return this.ready;
  }
}
```

### 3. `packages/core/src/parser/base.ts` — the interface change

```diff
   abstract language: string;
   abstract extensions: string[];
-  abstract parse(file: FileInfo): ParseResult;
+  abstract parse(file: FileInfo): Promise<ParseResult>;
   supports(ext: string): boolean { ... }
+  resolveImport?(specifier: string, importingFilePath: string, knownFileIds: Set<string>, knownFilesByPath: Map<string, string>): string[];
+  ignoredDirs?: string[];
```

### 4. `graph-gen.ts` — dispatch through the parser, not a hardcoded extension set

```diff
-const TS_JS_EXTENSIONS = new Set([...]);
-const JVM_EXTENSIONS = new Set([...]);
-function resolveImportsInto(...) {
-  ...
-  if (TS_JS_EXTENSIONS.has(ext.toLowerCase())) { ... resolveRelativeImport ... }
-  else if (JVM_EXTENSIONS.has(ext.toLowerCase())) { ... resolveJvmImport ... }
+function resolveImportsInto(...) {
+  ...
+  const parser = selectParser(ext);
+  if (!parser?.resolveImport) continue;
+  for (const specifier of imports) {
+    for (const targetId of parser.resolveImport(specifier, filePath, knownFileIds, knownFilesByPath)) {
+      edgesSet.add(edgeKey({ source: sourceId, target: targetId, relation: 'imports' }));
+    }
+  }
```

### 5. `KotlinParser`/`JavaParser` — shared `resolveImport`, verified not duplicated

```ts
// Identical in both kotlin.ts and java.ts:
resolveImport(specifier: string, _importingFilePath: string, _knownFileIds: Set<string>, knownFilesByPath: Map<string, string>): string[] {
  return resolveJvmImport(specifier, knownFilesByPath); // the one shared helper, from import-resolver.ts
}
```

## Acceptance criteria

- [x] `tsc --noEmit` against a scratch file importing `web-tree-sitter` (bare specifier) passes
      with zero errors under this repo's `moduleResolution: "node"`.
- [x] A real (non-mocked) load-and-query smoke test against all four grammars
      (`tree-sitter-{python,java,javascript,kotlin}.wasm`) succeeds.
- [x] `Parser.parse()` returns `Promise<ParseResult>`; all five existing parsers compile and their
      existing tests pass unmodified in behavior (only `await`/`async` added to call sites).
- [x] `registerParser()` is exported from `@caiquebrito/nodum-core` and `Parser` is a real class
      export (not type-only) — a consumer can `class MyParser extends Parser {}`.
- [x] `resolveImportsInto` no longer references any hardcoded extension set; Kotlin and Java share
      one `resolveImport` implementation delegating to one `resolveJvmImport` function.
- [x] `IGNORED_DIRS` includes `__pycache__` (Python-contributed) and `.gradle`/`target`
      (Kotlin/Java-contributed) via the parser-merge, verified by a real test reading the actual
      exported `Set`.
- [x] `.nodumrc.json`'s new `ignoredDirs` key is additive and actually skips a directory during a
      real `discoverFiles` run, verified end-to-end (not just at the config-parsing layer).
- [x] **Byte-identical `graph.json`** for an unchanged Kotlin fixture project, synced with the
      pre-030 code and this spec's code (via `git stash`, not estimated).
- [x] `npm run build && npm test --workspaces` green.

## Test plan

`packages/core/src/parser/treesitter/engine.test.ts` (new) — real (non-mocked) grammar load and
parse against `tree-sitter-python.wasm`; `Language` memoization (two loads of the same grammar
file return the same instance); independent loading of a second grammar; `Query` compilation
memoization and a real capture against real parsed source.

`packages/core/src/parser/treesitter/base.test.ts` (new) — a dummy `TreeSitterParser` subclass
proving `parse()` works end-to-end, and that constructing an instance does zero work (grammar
load only happens once `parse()` is actually called).

`packages/core/src/scan-config.test.ts` (extended) — `ignoredDirs` round-trips through
`loadScanConfig`/`saveScanConfig` without clobbering other fields.

`packages/core/src/file-discovery.test.ts` (extended) — a real `.nodumrc.json` `ignoredDirs` entry
actually excludes a directory during `discoverFiles`; `IGNORED_DIRS` contains both cross-cutting
and parser-contributed entries.

`packages/core/src/graph-gen.test.ts` — one existing test's mock parser needed a `resolveImport`
method added (mirroring `TypeScriptParser`'s real one) now that dispatch goes through the parser
instance instead of a hardcoded extension check; this is a test-mock update, not a production bug.

## Success Metrics

- Real check: hand-built a 2-file Kotlin fixture (`Main.kt` importing `util.Helper`), synced it
  with `git stash`-reverted pre-030 code, then again with this spec's code. `graph.json` output —
  identical, confirmed with `diff`, not just matching stats.
- Real check: `web-tree-sitter@0.25.10` + `tree-sitter-wasms@0.1.13`'s Python/Java/JavaScript/
  Kotlin grammars all load and produce correct query captures (`foo`, `bar`, `foo`, `foo`
  respectively, on trivial fixtures) in one script, run directly with `node`, not just type-checked.

## Related

Blocks: 031 (Python), 032 (Java), 033 (JavaScript) — all three build on `TreeSitterParser` and the
`resolveImport()`/`ignoredDirs` extension points this spec adds. Does not block 034/035, which
don't depend on the tree-sitter engine itself.
