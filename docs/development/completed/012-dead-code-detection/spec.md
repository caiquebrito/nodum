# 012 — Dead code detection (unreachable files)

## Status: done

Implemented, tested (6 new core `dead-code.test.ts` tests + 6 new CLI `dead-code.test.ts`
tests, all passing alongside the full existing suite — 82 core / 48 CLI total), and verified
end-to-end against real files on disk:
- Scratch fixture (`index.ts` importing `used.ts`, plus an unimported `orphan.ts`):
  `nodum sync` then `nodum dead-code` correctly reported only `src/orphan.ts`; `index.ts` was
  correctly excluded by the default entry-pattern heuristic.
- `benchmarks/projects/sample-next-app`: `nodum dead-code` reported `src/api/routes.ts` — an
  honest result given this fixture has no bootstrap/server file importing it, exactly the
  "candidate for review, not a verdict" case the spec's framing anticipated.

## Goal

Surface files that no other file in the project imports — candidates for dead code, worth a
human's review. Ships as a pure `packages/core` analysis function plus a new
`nodum dead-code [projectPath] [--json] [--entry <patterns>]` CLI command, following the same
shape as `detectCycles`/`nodum cycles` from spec 011.

**Scoped explicitly to file-level reachability, not unused functions/classes** — see Why now.

## Why now

The roadmap describes this item as "Dead code detection (unreachable nodes)," which could
reasonably be read as "find functions/classes nobody calls." Before drafting this spec I
checked what edges the graph actually has: every parser only ever emits `defines` (file→member
ownership, not usage) and, since spec 010, `imports` (file→file). **There is no `calls` or
`references` edge anywhere in the codebase** — confirmed via `grep -n "relation:"` across all
five parsers. So "is this function ever called" has no signal to compute from today; building
one would mean resolving identifier references inside function bodies to their declarations,
project-wide — a distinct, substantially larger undertaking (effectively its own prerequisite
spec, comparable in scope to spec 010's import resolution but for arbitrary expressions, not
just import statements).

Asked directly which scope to ship now — the answer: **file-level unreachable-file detection**,
using only the `imports` edges spec 010 already produces. Symbol-level dead code is deferred to
a future spec that first adds call/reference-edge resolution.

## Scope

- A pure, synchronous core function `detectUnreachableFiles(graph, options?)` operating on an
  already-loaded `Graph` — same category as `detectCycles`, `diffGraphs`.
- A file is a **candidate** if it is a `type: 'file'` node with **zero incoming `imports`
  edges**.
- Candidates are filtered down by two exclusions, since "nothing imports this file" is expected
  and correct for legitimate cases, not just dead code:
  1. **Test files** — any candidate whose `node.group === 'test'` (this is already computed by
     the existing `getNodeGroup()`/`NODE_GROUPS.test` heuristic every parser already applies;
     no new logic needed, just read the field). Test files are conventionally never imported by
     application code.
  2. **Entry-point name patterns** — a small default list of gitignore-syntax globs (reusing the
     already-a-dependency `ignore` package, same as `scan-config.ts`) matched against each
     candidate's file path: `**/index.*`, `**/main.*`, `**/app.*`, `**/server.*`, `**/cli.*`,
     `**/bin.*`, `**/bin/**`, `**/*.config.*`. Callers can pass additional
     `options.entryPatterns` globs, merged with (not replacing) the defaults — e.g. a Next.js
     project's `pages/**` or `app/**` file-based routing, which no generic heuristic can guess.
- Output is framed as **candidates for review, not definitive dead code** — both in the
  returned type's doc comment and the CLI's wording. "No other tracked file imports this" is a
  real but limited-precision signal: a file can be a legitimate root (wired up by a bootstrap
  file the sync didn't capture, invoked by a build tool, a dynamic `import()` the TS/JS parser
  doesn't visit — an existing, already-documented gap from spec 010) without being dead.

## Out of scope

- **Symbol-level dead code** (unused functions, classes, methods) — needs call/reference-edge
  resolution that doesn't exist yet; a future spec's job, not this one's.
- **Framework-specific entry-point detection** (Next.js `pages/`/`app/` routing, Express route
  auto-loading, etc.) — the `options.entryPatterns` escape hatch exists specifically so callers
  supply this themselves rather than the core function hardcoding assumptions about any one
  framework.
- **Auto-deletion or fix suggestions.** Detection only, like spec 011.
- **MCP tool exposure** — per the established task breakdown, analysis specs (011–015) ship
  detection + CLI; MCP wiring is specs 016–020, layered on later.

## Design

### 1. `packages/core/src/analyzer/dead-code.ts` (new)

```ts
import ignore from 'ignore';
import type { Graph } from '../types.js';

export interface UnreachableFile {
  nodeId: string;
  /** File path, e.g. "src/lib/legacy-helper.ts". */
  file: string;
}

const DEFAULT_ENTRY_PATTERNS = [
  '**/index.*',
  '**/main.*',
  '**/app.*',
  '**/server.*',
  '**/cli.*',
  '**/bin.*',
  '**/bin/**',
  '**/*.config.*',
];

export interface DetectUnreachableFilesOptions {
  /** Additional gitignore-syntax globs, merged with the built-in entry-point defaults. */
  entryPatterns?: string[];
}

/**
 * Files no other tracked file imports — candidates for dead code, not a
 * definitive verdict (see spec 012's Scope: a real entry point wired up
 * outside the parsed import graph looks identical to an orphaned file from
 * here). Test files and files matching an entry-point-name heuristic are
 * excluded from the result, since "nothing imports this" is expected and
 * correct for both.
 */
export function detectUnreachableFiles(
  graph: Graph,
  options: DetectUnreachableFilesOptions = {},
): UnreachableFile[] {
  const importedTargets = new Set(
    graph.edges.filter(e => e.relation === 'imports').map(e => e.target),
  );

  const entryMatcher = ignore().add([...DEFAULT_ENTRY_PATTERNS, ...(options.entryPatterns ?? [])]);

  return graph.nodes
    .filter(n => n.type === 'file')
    .filter(n => !importedTargets.has(n.id))
    .filter(n => n.group !== 'test')
    .filter(n => !entryMatcher.ignores(n.file))
    .map(n => ({ nodeId: n.id, file: n.file }));
}
```

### 2. Export from `packages/core/src/index.ts`

```ts
export { detectUnreachableFiles } from './analyzer/dead-code.js';
export type { UnreachableFile, DetectUnreachableFilesOptions } from './analyzer/dead-code.js';
```

### 3. `packages/cli/src/commands/dead-code.ts` (new)

Same shape as `commands/cycles.ts`: resolve `graph.json` for the synced project (identical
"Run `nodum sync` first" error), run `detectUnreachableFiles`, print raw JSON (`--json`) or a
formatted list. `--entry <patterns>` accepts comma-separated globs, split the same way
`config.ts`'s `--set-include`/`--set-exclude` already do.

```
🗑️  Unreachable files: 2 found (candidates for review, not definitive dead code)

  - src/lib/legacy-helper.ts
  - src/utils/unused-formatter.ts

(or, if none:)
✅ No unreachable files found
```

### 4. `packages/cli/src/bin/nodum.ts`

New `nodum dead-code [projectPath]` command registered alongside `cycles`/`diff`/`export`, same
`nodumDataDir` resolution and error-handling pattern as every other command.

## Acceptance criteria

- [x] A file with zero incoming `imports` edges, not matching any entry pattern and not a test
      file, is reported as a candidate.
- [x] A file with at least one incoming `imports` edge is never reported, regardless of name.
- [x] A file named `index.ts`/`main.js`/`app.tsx`/etc. with zero incoming imports is excluded by
      the default entry-pattern heuristic.
- [x] A file whose `group` is `'test'` (per the existing `getNodeGroup` heuristic) with zero
      incoming imports is excluded.
- [x] A custom `options.entryPatterns` glob (e.g. `pages/**`) excludes a matching file in
      addition to, not instead of, the built-in defaults.
- [x] A project where every file is reachable (a single connected import graph, or every file
      matches an exclusion) reports `[]`.
- [x] `nodum dead-code` on a synced project with unreachable files prints a human-readable list
      and exits 0.
- [x] `nodum dead-code` with none found prints a clear "none found" message, not treated as an
      error.
- [x] `nodum dead-code --json` prints the raw `UnreachableFile[]` array.
- [x] `nodum dead-code --entry "pages/**,app/**"` merges custom patterns with the built-in
      defaults.
- [x] `nodum dead-code` on an unsynced project fails with the same "Run `nodum sync` first"
      message `cycles`/`diff`/`export` already use.

## Test plan

`packages/core/src/analyzer/dead-code.test.ts` (new) — pure function, constructed `Graph`
fixtures covering every acceptance-criteria case: orphaned file, imported file, default-pattern
entry file, test-group file, custom-pattern file, fully-reachable project.

`packages/cli/src/commands/dead-code.test.ts` (new) — following `cycles.test.ts`'s mocking
convention (mock `fs/promises` read of `graph.json`): formatted output, "none found" message,
`--json`, `--entry` parsing, missing synced project.

## Success Metrics

- Real check: build a small scratch fixture — an `index.ts` importing two files, one of which
  (`orphan.ts`) nothing imports — sync it, run `nodum dead-code`, confirm only `orphan.ts` is
  reported and `index.ts` is correctly excluded by the entry-pattern default.
- Real check: run `nodum dead-code` against `benchmarks/projects/sample-next-app` and manually
  verify every reported result (if any) against the actual import graph — confirming the
  candidates-not-verdicts framing holds up against a real project, not just a synthetic one.

## Related

Depends on: `010-import-edge-resolution` (needs real `imports` edges), same foundation
`011-dependency-cycle-detection` builds on.
Blocks: nothing yet named in the roadmap chain — a future symbol-level dead-code spec would
build on this one's file-level result plus new call/reference-edge resolution, but isn't
scheduled in the current numbered list.
