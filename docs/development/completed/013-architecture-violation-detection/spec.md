# 013 — Architecture violation detection (enforce patterns)

## Status: done

Implemented, tested (10 new core tests across `architecture.test.ts` + `architecture-config.test.ts`,
7 new CLI tests across `architecture.test.ts` + 2 new `config.test.ts` cases, all passing
alongside the full existing suite — 92 core / 56 CLI total), and verified end-to-end against
real files on disk:
- Scratch fixture (`src/ui/UserList.tsx` importing `src/db/userRepo.ts`): `nodum sync` then
  `nodum architecture --rule ui:repo` correctly reported the real violation; with no rules,
  correctly reported none.
- `nodum config --set-architecture-rules "ui:repo"` persisted the rule to `.nodumrc.json`, and
  a subsequent `nodum config --set-include "src/**"` correctly left it untouched — the
  clobber-fix regression guard confirmed against real disk state, not just a mocked test.
- `benchmarks/projects/sample-next-app` with `--rule model:service` (no `model`-grouped files
  in that fixture): correctly reported a clean "no violations" result.

## Goal

Let a project declare "layer X must not import layer Y" rules and flag real `imports` edges
that break them. Ships as a pure `packages/core` analysis function, a config file extension for
declaring rules persistently, and a new `nodum architecture [projectPath] [--json] [--rule
<from>:<to>]` CLI command.

## Why now

Directly unblocked by spec 010 (`imports` edges) — same foundation specs 011/012 already build
on. Unlike 012's dead-code scope question, this one needs no new graph data: every node already
carries a `group` (`ui`/`service`/`model`/`repo`/`util`/`config`/`test`/`hook`/`other`, from the
existing `getNodeGroup()` directory-name heuristic in `types.ts`), and layer-violation detection
is exactly "does an `imports` edge exist from a file in group A to a file in group B, where that
pairing is declared disallowed." No new edge-resolution work required — confirmed by reading
`types.ts`'s `NODE_GROUPS`/`getNodeGroup`, already computed and stored on every node today.

## Scope

- **Deny-list rules only**: `{ from: string, to: string }`, meaning "a file in group `from`
  importing a file in group `to` is a violation." No default rules — every project's layering
  differs, so this is opt-in, same posture as 012's `entryPatterns` being additive rather than
  the tool guessing a project's architecture.
- **Wildcard support**: `to: '*'` means "group `from` must not import anything" (e.g. models
  should have zero outgoing dependencies — a common real rule). `from: '*'` is supported
  symmetrically for completeness, though less commonly useful.
- **Persistent config**: rules declared in `.nodumrc.json` (the same file `scan-config.ts`
  already reads/writes for include/exclude), under a new top-level `architecture.rules` key —
  loaded/saved via new `packages/core/src/analyzer/architecture-config.ts` functions,
  `nodum config --set-architecture-rules <from>:<to>,<from>:<to>` to persist them, and shown in
  `nodum config`'s existing summary output.
- **Ad-hoc rules**: `nodum architecture --rule <from>:<to>` for one-off checks without touching
  the config file, merged with (not replacing) the persisted rules — same additive posture as
  012's `--entry`.
- A pure, synchronous core function `detectArchitectureViolations(graph, rules)` — same category
  as `detectCycles`/`detectUnreachableFiles`.

## Out of scope

- **Rule inference / auto-detection of a project's intended architecture.** Rules are always
  explicit and user-authored; nothing here guesses what layering a codebase *should* have.
- **Custom/user-defined groups.** `node.group` comes from the existing fixed `NODE_GROUPS`
  heuristic (`ui`/`service`/`model`/`repo`/`util`/`config`/`test`/`hook`/`other`); adding a way
  to define custom groups is a separate, unscoped feature or a future spec on `NODE_GROUPS`
  itself, not this one.
- **Allow-list ("only these pairs are permitted") semantics.** Deny-list only, since an
  allow-list default-denies every unlisted pairing including ones that are almost certainly fine
  (e.g. `util → util`), which would make the tool noisy out of the box and require every project
  to enumerate its entire dependency matrix just to get started. A deny-list only needs the
  handful of pairings a team actually cares about forbidding.
- **Auto-fix.** Detection only, same as 011/012.
- **MCP tool exposure.** Same posture as 011/012 — analysis + CLI now, MCP wiring is specs
  016–020.

## Design

### 1. Incidental fix needed first: `saveScanConfig` currently clobbers unrelated keys

Read while designing this spec: `scan-config.ts`'s `saveScanConfig` round-trips through the
typed `ScanConfig` object (`{ include, exclude }`) and writes *only* those two fields back to
`.nodumrc.json` — any other top-level key in the file (like the `architecture` key this spec is
about to add) would be silently deleted the next time a user runs
`nodum config --set-include`/`--set-exclude`. This is a real, previously-latent bug that this
spec's design would otherwise turn into an active data-loss bug the moment both features are
used on the same project. Fixed as part of this spec: `saveScanConfig` reads the *raw* JSON
object (not just the typed subset) and merges only the `include`/`exclude` keys into it, leaving
any other top-level key (including `architecture`) untouched. `saveArchitectureConfig` (below)
follows the same raw-merge pattern from the start.

### 2. `packages/core/src/analyzer/architecture-config.ts` (new)

```ts
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

export interface ArchitectureRule {
  /** Node group, or '*' for "any group". */
  from: string;
  to: string;
}

export interface ArchitectureConfig {
  rules?: ArchitectureRule[];
}

const CONFIG_FILENAME = '.nodumrc.json';

export async function loadArchitectureConfig(rootPath: string): Promise<ArchitectureConfig> {
  try {
    const content = await readFile(join(rootPath, CONFIG_FILENAME), 'utf-8');
    const parsed = JSON.parse(content);
    return { rules: Array.isArray(parsed.architecture?.rules) ? parsed.architecture.rules : undefined };
  } catch {
    return {};
  }
}

export async function saveArchitectureConfig(rootPath: string, update: ArchitectureConfig): Promise<void> {
  const path = join(rootPath, CONFIG_FILENAME);
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(await readFile(path, 'utf-8'));
  } catch {
    // No existing file — start fresh.
  }
  raw.architecture = { ...(raw.architecture as object), rules: update.rules ?? (raw.architecture as any)?.rules };
  await writeFile(path, JSON.stringify(raw, null, 2), 'utf-8');
}
```

### 3. `packages/core/src/analyzer/architecture.ts` (new)

```ts
import type { Graph } from '../types.js';
import type { ArchitectureRule } from './architecture-config.js';

export interface ArchitectureViolation {
  rule: ArchitectureRule;
  sourceNodeId: string;
  sourceFile: string;
  targetNodeId: string;
  targetFile: string;
}

/**
 * Flags `imports` edges whose (source group, target group) pair matches a
 * declared deny rule. '*' in a rule matches any group. No rules -> no
 * violations; this is opt-in, not an inferred or default architecture.
 */
export function detectArchitectureViolations(graph: Graph, rules: ArchitectureRule[]): ArchitectureViolation[] {
  if (rules.length === 0) return [];

  const nodesById = new Map(graph.nodes.map(n => [n.id, n]));
  const violations: ArchitectureViolation[] = [];

  for (const edge of graph.edges) {
    if (edge.relation !== 'imports') continue;
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source || !target) continue;

    const matchedRule = rules.find(
      r => (r.from === '*' || r.from === source.group) && (r.to === '*' || r.to === target.group),
    );
    if (matchedRule) {
      violations.push({
        rule: matchedRule,
        sourceNodeId: source.id,
        sourceFile: source.file,
        targetNodeId: target.id,
        targetFile: target.file,
      });
    }
  }

  return violations;
}
```

### 4. Export from `packages/core/src/index.ts`

```ts
export { detectArchitectureViolations } from './analyzer/architecture.js';
export type { ArchitectureViolation } from './analyzer/architecture.js';
export { loadArchitectureConfig, saveArchitectureConfig } from './analyzer/architecture-config.js';
export type { ArchitectureRule, ArchitectureConfig } from './analyzer/architecture-config.js';
```

### 5. `packages/cli/src/commands/architecture.ts` (new)

Same shape as `commands/cycles.ts`/`commands/dead-code.ts`: resolve `graph.json`, same
"Run `nodum sync` first" error. Also loads `loadArchitectureConfig(projectPath)` and merges its
`rules` with any `--rule from:to,from:to` CLI-supplied ones (parsed the same
comma-splitting way as `config.ts`'s `parsePatterns`, with `from:to` further split on `:`).

```
🏛️  Architecture violations: 1 found

  1. [ui → repo] src/components/UserList.tsx → src/db/userRepo.ts

(or, if none:)
✅ No architecture violations found
```

### 6. `packages/cli/src/commands/config.ts` extended

New `--set-architecture-rules <from>:<to>,<from>:<to>` option, parsed and persisted via
`saveArchitectureConfig`; existing summary output gains an "Architecture rules:" line.

### 7. `packages/cli/src/bin/nodum.ts`

New `nodum architecture [projectPath]` command; `config` command gains the new option, both
following the existing registration pattern.

## Acceptance criteria

- [x] An `imports` edge whose source/target groups exactly match a declared rule is reported as
      a violation.
- [x] An `imports` edge whose groups don't match any rule is never reported.
- [x] A rule with `to: '*'` flags every outgoing `imports` edge from that group, regardless of
      target group.
- [x] A rule with `from: '*'` flags every incoming `imports` edge into that group, regardless of
      source group.
- [x] No rules configured (`[]`) → `[]` violations, even on a graph with many `imports` edges.
- [x] Non-`imports` edges never participate in violation detection.
- [x] `nodum config --set-architecture-rules` persists rules to `.nodumrc.json` under
      `architecture.rules`, and a subsequent `nodum config --set-include` does **not** delete
      them (regression guard for the `saveScanConfig` fix).
- [x] `nodum architecture --rule <from>:<to>` merges with, rather than replaces, the persisted
      config rules.
- [x] `nodum architecture` on a project with violations prints a human-readable list (rule +
      source file + target file) and exits 0.
- [x] `nodum architecture` with no violations prints a clear "none found" message, not an error.
- [x] `nodum architecture --json` prints the raw `ArchitectureViolation[]` array.
- [x] `nodum architecture` on an unsynced project fails with the established
      "Run `nodum sync` first" message.

## Test plan

`packages/core/src/analyzer/architecture-config.test.ts` (new) — `loadArchitectureConfig`/
`saveArchitectureConfig` round-trip, and specifically a test that saves architecture rules, then
calls `saveScanConfig` with an include pattern, then reloads architecture config and confirms
the rules survived (the regression guard for the clobbering bug).

`packages/core/src/analyzer/architecture.test.ts` (new) — pure function, constructed `Graph` +
rule fixtures covering every acceptance-criteria case: exact match, no match, `to: '*'`,
`from: '*'`, empty rules, non-`imports` edges ignored.

`packages/cli/src/commands/architecture.test.ts` (new) — following `cycles.test.ts`'s mocking
convention: formatted output, "none found," `--json`, `--rule` merging with config-file rules,
missing synced project.

`packages/cli/src/commands/config.test.ts` (extend) — `--set-architecture-rules` persists and
displays correctly.

## Success Metrics

- Real check: build a scratch fixture with a file in a `ui/` directory importing a file in a
  `db/` directory (a real `imports` edge between `ui` and `repo` groups), sync it, declare a
  `ui:repo` deny rule via `--rule`, and confirm `nodum architecture` reports the real violation.
- Real check: run `nodum architecture --rule model:service` against
  `benchmarks/projects/sample-next-app` (no `model`-grouped files in that fixture) and confirm a
  clean "no violations" result — a real acyclic-style negative check, not just a synthetic one.

## Related

Depends on: `010-import-edge-resolution` (needs real `imports` edges), same foundation as
`011-dependency-cycle-detection`/`012-dead-code-detection`.
Blocks: the `explain_architecture` MCP tool (`018-mcp-explain-architecture`), layered on later.
