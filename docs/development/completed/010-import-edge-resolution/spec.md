# 010 — Import edge resolution (TypeScript, JavaScript, Kotlin, Java)

## Status: done

Implemented, tested (67 core unit tests including 10 new resolver tests + 17 new per-parser
import tests + 4 new graph-gen import-edge scenarios, all passing), and verified end-to-end
against real files on disk:
- `benchmarks/projects/sample-next-app`: full sync produced 4 real `imports` edges connecting
  distinct files (`middleware.ts→auth.ts`, `routes.ts→middleware.ts`, `routes.ts→auth.ts`,
  `routes.ts→models.ts`); bare specifiers (`express`, etc.) correctly produced no edges.
- Same project, incremental sync after editing only `middleware.ts`: all 4 import edges
  (including the untouched-importer `routes.ts→middleware.ts` edge) survived, confirming the
  4-phase eviction fix works against real disk state, not just mocks.
- Scratch Kotlin fixture (`util/StringUtils.kt`, `util/MathUtils.kt`,
  `service/UserService.kt` with `import com.example.util.*`): wildcard import correctly
  resolved to edges targeting both files in the package.
- A regex bug was caught and fixed during test-writing (not anticipated in the original
  design): in both `kotlin.ts` and `java.ts`, `[\w.]+(?:\.\*)?` greedily consumed the
  wildcard's leading dot before the non-capturing group could match, silently truncating
  `com.foo.*` to `com.foo.`. Fixed to `[\w.]+\*?` in both parsers.

## Goal

Make `imports` a real edge relation instead of a declared-but-never-emitted `RelationType`. Today every parser extracts import/require statements and then **throws them away** — confirmed by reading all five parsers: TypeScript's is real AST-based extraction that computes the module specifier and discards it in a dead-code branch; JavaScript's/Kotlin's/Java's regexes capture the specifier into a loop variable that's never read; Python's regex doesn't even have a capture group. The result: **zero edges in the graph ever cross a file boundary**, for any project, in any language, today.

## Why now

This is the prerequisite for the "Advanced Graph Analysis" roadmap section — dependency cycle detection, dead-code detection, and `trace_impact` are all meaningless without real cross-file edges. It's also explicitly named and anticipated in the existing codebase: `graph-gen.ts`'s incremental-generation function has a doc comment that says *"Correct today because edges never cross file boundaries (import resolution doesn't exist yet — see spec 010)"* — this spec is what that comment is warning about, and implementing it requires fixing the thing it warns will break.

## Scope (per your direction)

**Languages: TypeScript, JavaScript, Kotlin, Java.** Python is deferred — its import semantics (dotted module → file tree, with `__init__.py` package resolution) are a third distinct algorithm and not needed for this pass.

Two resolution algorithms, dispatched by the importing file's extension:
1. **TS/JS (relative-path resolution)** — `./foo`, `../lib/bar` resolved via Node-style relative path + extension probing + `index.*` barrel fallback. Bare specifiers (`react`, `lodash`) are always external — no edge, matching today's silent (non-)behavior for them.
2. **Kotlin/Java (dotted-FQN resolution)** — `import com.foo.Bar` resolved by suffix-matching against known file paths (`.../com/foo/Bar.kt` or `.../com/foo/Bar.java`), since the codebase has no build-system knowledge of source roots (no `pom.xml`/`build.gradle` parsing — out of scope). One resolver serves both languages: Kotlin and Java coexist in real Android/JVM projects, and an import needs to be resolvable to either extension regardless of which file is doing the importing.

## Out of scope

- **Python import resolution** — different algorithm, not needed right now; `python.ts`'s import handling is untouched by this spec.
- **tsconfig `paths`/`baseUrl` alias resolution** (`@/lib/foo`) — confirmed nothing in the codebase parses `tsconfig.json` today; these remain unresolved (silently, same as today).
- **Dynamic `import('x')` and CommonJS `require('x')` calls in TypeScript** — TS's parser only walks `ImportDeclaration`/`ImportEqualsDeclaration` AST nodes; call-expression forms aren't visited. Flagging as a known gap, not fixing the TS AST walk in this pass (JavaScript's regex-based parser is separately fixed to catch `require(...)` — see Design).
- **Re-exports** (`export * from 'x'`, `export { a } from 'x'`) — not visited by the current TS AST walk either; same gap, not fixed here.
- **`extends`/`implements` edges** — also declared-but-unemitted `RelationType` values, also currently unused by any parser. Confirmed while researching this spec. Not this spec's job; the eviction-logic fix below is written generically enough (relation-agnostic) that adding them later won't require revisiting it.
- **Gradle/Maven source-root detection** — the Kotlin/Java resolver's suffix-matching heuristic works without knowing `src/main/kotlin` vs `src/main/java` vs any custom layout, by design, rather than trying to parse build files.

## Design

### 1. `ParseResult` gains raw, unresolved import specifiers

**`packages/core/src/types.ts`**:
```ts
export interface ParseResult {
  nodes: Node[];
  edges: Edge[];
  imports?: string[]; // raw specifiers extracted from this file, unresolved
}
```
Optional and additive — Python/unspecified parsers simply omit it, no behavior change for them.

### 2. Per-parser extraction (collect, don't resolve — resolution needs the whole project's file list, which no single-file `parse()` call has)

- **`typescript.ts`** — the existing dead-code branch (`if (moduleName && !moduleName.startsWith('.')) { /* skip */ } else if (moduleName) { /* would resolve */ }`) becomes: push every non-null `moduleName` (relative or bare — the resolver decides what's resolvable, keeping the parser simple) onto an `imports` array, returned in `ParseResult`.
- **`javascript.ts`** — the current regex `^(?:import|require)\s+(?:[\w{},\s*]+\s+from\s+)?['"]([^'"]+)['"]` has two real bugs, both fixed here: (a) it's line-anchored (`^`/`/m`), missing indented/mid-expression imports; (b) it does **not** actually match real CommonJS `require('x')` calls — `require` followed directly by `(` never matches `require\s+...['"]`. New regex, not line-anchored, with two alternatives:
  ```ts
  const importRegex = /import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;
  ```
  taking whichever capture group matched (1 or 2) per match.
- **`kotlin.ts`** — current regex `^import\s+([\w.]+)` silently truncates wildcard imports (the `*` in `import com.foo.*` isn't in the character class, so it captures `com.foo.` and stops). Fixed regex captures the wildcard explicitly: `/^import\s+([\w.]+(?:\.\*)?)/gm`, so specifiers like `"com.foo.*"` are collected intact for the resolver to detect.
- **`java.ts`** — current regex `^import\s+([\w.]+)(?:\.\*)?;` mis-parses `import static com.example.Foo.bar;` (captures `static` as if it were the start of the FQN, since `static` matches `[\w.]+`). Fixed to optionally skip a leading `static\s+`: `/^import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;/gm`.

### 3. `packages/core/src/parser/import-resolver.ts` (new) — two pure resolution functions, no file-system access, operate only on already-known file paths

```ts
const TS_JS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/** Relative-path resolution for TS/JS. Returns the resolved file's node ID, or null if unresolvable/bare. */
export function resolveRelativeImport(
  importingFilePath: string,
  specifier: string,
  knownFileIds: Set<string>, // normalizeNodeId(path, path, 'file') for every known file
): string | null {
  if (!specifier.startsWith('.')) return null; // bare/package import — always external
  const base = posixNormalize(posixJoin(posixDirname(importingFilePath), specifier));
  const candidates = TS_JS_EXTENSIONS.some(ext => base.endsWith(ext))
    ? [base]
    : [...TS_JS_EXTENSIONS.map(ext => `${base}${ext}`), ...TS_JS_EXTENSIONS.map(ext => `${base}/index${ext}`)];
  for (const candidate of candidates) {
    const id = normalizeNodeId(candidate, candidate, 'file');
    if (knownFileIds.has(id)) return id;
  }
  return null;
}

/**
 * Dotted-FQN resolution for Kotlin/Java, shared since both coexist in real
 * projects. Suffix-matches against known file paths — no source-root
 * knowledge required. A wildcard import (`com.foo.*`) can resolve to
 * multiple files (the whole package); a normal import resolves to at most
 * one, trying progressively shorter prefixes to handle member imports
 * (`import com.foo.Bar.CONSTANT` — drop the last segment, resolve `Bar`).
 */
export function resolveJvmImport(
  specifier: string,
  knownFilesByPath: Map<string, string>, // file path -> node ID, for every known .kt/.java file
): string[] {
  const isWildcard = specifier.endsWith('.*');
  const parts = (isWildcard ? specifier.slice(0, -2) : specifier).split('.');

  if (isWildcard) {
    const pkgSuffix = `${parts.join('/')}/`.toLowerCase();
    return [...knownFilesByPath.entries()]
      .filter(([path]) => path.slice(0, path.lastIndexOf('/') + 1).toLowerCase().endsWith(pkgSuffix))
      .map(([, id]) => id);
  }

  for (let drop = 0; drop < parts.length; drop++) {
    const candidateParts = parts.slice(0, parts.length - drop);
    if (candidateParts.length === 0) break;
    const suffixKt = `${candidateParts.join('/')}.kt`.toLowerCase();
    const suffixJava = `${candidateParts.join('/')}.java`.toLowerCase();
    for (const [path, id] of knownFilesByPath) {
      const lower = path.toLowerCase();
      if (lower === suffixKt || lower.endsWith(`/${suffixKt}`) || lower === suffixJava || lower.endsWith(`/${suffixJava}`)) {
        return [id];
      }
    }
  }
  return [];
}
```

### 4. `graph-gen.ts` — resolution pass, and the incremental-eviction fix

**Full scan (`generateGraphFull`)**: unchanged parse loop, but `parseFilesInto` now also collects `{ filePath, ext, imports }` for every file that returned them. After the loop (once `nodeMap` has every file from the whole project), run one resolution pass: build `knownFileIds` (`Set<string>`) and `knownFilesByPath` (`Map<string,string>`) from `nodeMap`'s file-type nodes, then for each collected `(filePath, imports[])`, dispatch by extension to `resolveRelativeImport` (TS/JS) or `resolveJvmImport` (Kotlin/Java), and add a `{ source: fileId(filePath), target: resolvedId, relation: 'imports' }` edge per resolved target into `edgesSet`.

**Incremental scan (`generateGraphIncremental`) — this is the part the existing code comment warns about, and needs real restructuring, not just bolting resolution on:**

The current logic evicts *both* nodes *and* edges for changed/deleted files in one step, using node-survivorship computed *before* changed files are re-parsed. Since file-node IDs are stable across re-parses (derived from path, not content — spec 003's `normalizeNodeId` doesn't change when a file's content changes), an edge `A → B` where **only B changes** should survive (A's import statement didn't change, and B's file node ID is identical before and after), but the current filter drops it anyway, because it checks "does B's node survive *before* B is re-parsed" — and at that point B's node has already been evicted pending re-parse.

Fix: split eviction into two phases, and use each edge's **source's owning file** (not both endpoints) to decide whether it needs re-resolution:

```ts
async function generateGraphIncremental(projectPath, previousGraph, previousFiles, onProgress) {
  const diff = await discoverChangedFiles(projectPath, previousFiles);
  const changedPaths = new Set(diff.changed.map(f => f.path));
  const deletedPaths = new Set(diff.deletedPaths);
  const touchedPaths = new Set([...changedPaths, ...deletedPaths]);

  // Phase 1: keep only nodes belonging to genuinely untouched files.
  const previousNodesById = new Map(previousGraph.nodes.map(n => [n.id, n]));
  const nodeMap = new Map(
    previousGraph.nodes.filter(n => !touchedPaths.has(n.file)).map(n => [n.id, n]),
  );

  // Phase 2: re-parse changed files — fresh nodes, their own 'defines'-style
  // edges, and their raw (unresolved) import specifiers.
  const edgesSet = new Set<string>();
  const rawImports: Array<{ filePath: string; ext: string; imports: string[] }> = [];
  for (const file of diff.changed) {
    const parser = selectParser(file.ext);
    if (!parser) continue;
    const result = parser.parse(file);
    for (const node of result.nodes) if (!nodeMap.has(node.id)) nodeMap.set(node.id, node);
    for (const edge of result.edges) edgesSet.add(edgeKey(edge));
    if (result.imports?.length) rawImports.push({ filePath: file.path, ext: file.ext, imports: result.imports });
  }

  // Phase 3: carry over edges whose SOURCE belonged to an untouched file,
  // as long as their target still exists in the current (post-reparse) node
  // set. This is what makes an A→B import edge survive when only B changed.
  for (const edge of previousGraph.edges) {
    const sourceFile = previousNodesById.get(edge.source)?.file;
    if (sourceFile === undefined || touchedPaths.has(sourceFile)) continue; // will be freshly re-resolved, or gone
    if (!nodeMap.has(edge.target)) continue; // target deleted
    edgesSet.add(edgeKey(edge));
  }

  // Phase 4: resolve imports for changed files against the FINAL node set
  // (untouched survivors + freshly re-added), so a changed file's imports
  // can correctly target both old and newly-added files.
  const { knownFileIds, knownFilesByPath } = buildImportLookup(nodeMap);
  for (const { filePath, ext, imports } of rawImports) {
    for (const edge of resolveImportsForFile(filePath, ext, imports, knownFileIds, knownFilesByPath)) {
      edgesSet.add(edgeKey(edge));
    }
  }

  // ...unchanged from here: edgesFromSet, stats, return
}
```

`buildImportLookup`/`resolveImportsForFile`/`edgeKey` are small shared helpers factored out so the full-scan path and this one don't duplicate the dispatch-by-extension logic.

## Acceptance criteria

- [x] A TS file importing another TS file via a relative specifier produces a real `imports` edge between their file nodes, in a full sync.
- [x] The same holds for `.js`/`.jsx` files, including a real `require('./x')` call (not just `import`).
- [x] A relative import resolves correctly through extension probing (`./foo` matching `foo.ts` when no `.js` sibling exists) and through an `index.*` barrel file (`./components` matching `components/index.tsx`).
- [x] A bare/package import (`react`, `lodash`) produces no edge and does not throw.
- [x] A Kotlin file importing a class via full FQN (`import com.foo.Bar`) produces an edge to the file whose path ends in `com/foo/Bar.kt`.
- [x] A Kotlin wildcard import (`import com.foo.*`) produces one edge per file in that package.
- [x] A Java `import static` produces no false edge to a class literally named "static" (regression guard for the fixed regex).
- [x] A Kotlin import of a Java class (mixed-language project) resolves correctly, and vice versa.
- [x] **Incremental sync**: given files A (unchanged) and B (changed), where A imports B, a subsequent `--incremental` sync preserves the A→B edge.
- [x] **Incremental sync**: given the same setup but B is deleted instead of changed, the A→B edge is correctly dropped.
- [x] **Incremental sync**: given A changes and previously imported B, and A's import statement is removed in the edit, the stale A→B edge does not survive (only freshly-resolved edges for changed files are kept, old ones for changed sources are dropped).
- [x] Non-incremental (full) sync output is unaffected in every case where no cross-file import edges are expected (regression guard against the resolver producing false positives on the existing benchmark fixture).

## Test plan

`packages/core/src/parser/import-resolver.test.ts` (new) — pure functions, no I/O:
- `resolveRelativeImport`: same-directory, parent-directory (`../`), extension probing priority, `index.*` barrel fallback, bare specifier → `null`, unresolvable relative path → `null`.
- `resolveJvmImport`: exact class match, member-import prefix-dropping (`Bar.CONSTANT` → resolves to `Bar`), wildcard → multiple matches, mixed `.kt`/`.java` targets, unresolvable (external SDK class) → `[]`.

Per-parser tests (new — first direct parser-level tests in the codebase, per the research; `TypeScriptParser`/`JavaScriptParser`/`KotlinParser`/`JavaParser` each get a `.test.ts` calling `.parse()` directly on a constructed `FileInfo`):
- Each asserts `result.imports` contains the expected raw specifiers for representative real syntax (including the specific bugs being fixed: JS `require(...)` calls, Kotlin wildcards, Java `static` imports).

`packages/core/src/graph-gen.test.ts` (extend, following its existing mock-parser-stand-in convention):
- Full scan: two mock files where file A's stub parser returns `imports: ['./b']`, file B exists — asserts a resolved `imports` edge A→B appears in the final graph.
- Incremental: the three scenarios from the acceptance criteria above (unchanged-importer + changed-target survives; deleted-target drops the edge; changed-importer with a removed import statement doesn't leave a stale edge) — each as an explicit test driving `generateGraph` with `previousGraph`/`previousFiles` populated.

## Success Metrics

- Real check: sync `benchmarks/projects/sample-next-app` (has real relative imports between `src/api/routes.ts`, `src/api/middleware.ts`, `src/db/models.ts`, `src/lib/auth.ts`) — `graph.json`'s `stats.edges` increases, and at least one `relation: "imports"` edge appears connecting two different `file` values.
- Real check against a Kotlin fixture (small scratch project with 2-3 files, one importing another via FQN, one via wildcard) — correct edges appear.
- Real check: the three incremental-sync scenarios above, run against a scratch project (not just unit-tested) — confirms the eviction-logic fix works end-to-end, not just in mocked tests.

## Related

Depends on: nothing new — builds on the existing parser/graph-gen architecture.
Blocks: `011-dependency-cycle-detection`, `013-architecture-violation-detection` (roadmap's cycle/dead-code/architecture analysis all need real cross-file edges), several MCP tools (`trace_impact`, `explain_architecture`).
