# 020 — MCP `suggest_refactoring` (capstone: unified refactoring suggestions)

## Status: done

Implemented, tested (178 core tests total including new `analyzer/suggest-refactoring.test.ts`;
95 CLI tests total including new `commands/suggest-refactoring.test.ts`; 15 MCP tests total
including extended `handlers.test.ts` coverage for `handleSuggestRefactoring`), and verified
end-to-end against real files on disk:
- A scratch fixture deliberately engineered to trip all five categories at once (a real import
  cycle, an unreachable file, a `.nodumrc.json` rule its own imports violate, a function with
  complexity 12, and a duplicate function pair): `nodum suggest-refactoring` reported all five,
  in the correct fixed category order, and every suggestion's content matched its corresponding
  already-verified standalone command (`nodum cycles`/`architecture`/`complexity`/`duplicates`/
  `dead-code`) exactly.
- `benchmarks/projects/sample-next-app`: reported only the single dead-code candidate
  (`src/api/routes.ts`), matching every prior spec's already-verified output for this fixture —
  no cycles (011), no violations since no rules are configured (013/018), nothing above the
  complexity threshold of 10 (014's highest score here is 3), and no duplicates (015/019).

This closes out the v2.1.0 task list (011–020).

## Goal

Synthesize every analysis capability shipped so far (011–015, plus 017's bottleneck scoring)
into one unified, actionable suggestion feed: circular imports, dead files, architecture-rule
violations, overly complex functions, and duplicated code, each surfaced as a plain-language
suggestion with the files involved. Ships as a pure `packages/core` function, a new
`suggest_refactoring` MCP tool, and a companion `nodum suggest-refactoring [projectPath]
[--json] [--complexity-threshold N]` CLI command. Last of the twenty v2.1.0 tasks.

## Why now

The roadmap names this "ML-based refactoring recommendations." **That framing doesn't match
anything buildable from this session's work, and I'm flagging that honestly rather than quietly
reinterpreting it**: every analyzer shipped in this SDD process (011–019) is deterministic and
rule-based — there is no trained model, no ML inference infrastructure, and nothing in
`packages/mcp/src/embeddings.ts` (the one ML-adjacent piece in this codebase, a local
sentence-embedding model) does recommendation generation; it does semantic search ranking for
`search_graph`, a different task entirely. Building an actual ML recommender is a different kind
of project — data collection, training, evaluation — not a spec-sized unit of work, and nothing
this series has built points toward it.

What **is** buildable, and matches the roadmap's own task-breakdown note that this spec is "the
most composite" and depends on 014+015: a synthesis layer over the analyzers that already exist.
Every one of them already answers a piece of "what should I refactor" — cycles (011), dead code
(012), architecture violations (013), complex functions (014), duplicated code (015). This spec
composes all five into one feed, matching the compositional posture specs 017/018/019 already
established, rather than adding a sixth new detection mechanism.

## Scope

- `packages/core/src/analyzer/suggest-refactoring.ts`: `suggestRefactoring(graph, options?)` —
  pure, zero new detection logic, calling five existing analyzers and mapping each result to a
  `RefactoringSuggestion`:
  1. **`cycle`** — one suggestion per `detectCycles` (011) result.
  2. **`architecture-violation`** — one per `detectArchitectureViolations` (013) result, only
     when `options.architectureRules` is supplied (same "never invent rules" posture as 013/018
     — omitted entirely, not defaulted to `[]`, when no rules are configured).
  3. **`high-complexity`** — one per `rankByComplexity` (014) result at or above
     `options.complexityThreshold` (default **10** — a common industry rule-of-thumb threshold
     multiple linters use as a default "this function is too complex" line; documented as a
     default, not a claimed universal standard, and overridable).
  4. **`duplication`** — one per `detectDuplicates` (015) group.
  5. **`dead-code`** — one per `detectUnreachableFiles` (012) result.
- **Fixed category ordering** (cycle → architecture-violation → high-complexity → duplication →
  dead-code), each category's internal order inherited from its source analyzer's own
  (already-deterministic) order. **Not a scored/prioritized ranking** — assigning a single
  "most important first" score across five structurally different problem types would be an
  unsubstantiated value judgment this spec doesn't try to make. Every suggestion carries its
  `kind` so a caller (human or model) can filter/re-prioritize using their own judgment about
  what matters for their project.
- `suggest_refactoring` MCP tool (new `handleSuggestRefactoring` in `handlers.ts`, registered in
  `index.ts`) — `project_name`, optional `complexity_threshold`; auto-loads
  `.nodumrc.json` architecture rules the same way `handleExplainArchitecture` (018) already does
  (via the `projects.json` index's tracked `path`).
- `nodum suggest-refactoring [projectPath] [--json] [--complexity-threshold N]` CLI command —
  same shape as every prior analysis command, real end-to-end verification vehicle.

## Out of scope

- **Actual ML-based recommendations.** Addressed above — not attempted, and flagged rather than
  silently downgraded without explanation.
- **A cross-category priority score.** Explained above — deliberately not attempted.
- **Auto-applying any suggested refactor.** Every prior analysis spec (011–019) has been
  detection/suggestion only; this one is no different, and it's the last spec in the series, not
  a new "apply fixes" capability.
- **New suggestion categories beyond the five listed** (e.g. "extract interface," "reduce
  parameter count") — those would need new detection logic this spec isn't adding; the scope is
  strictly composing what already exists.

## Design

### 1. `packages/core/src/analyzer/suggest-refactoring.ts` (new)

```ts
import type { Graph } from '../types.js';
import { detectCycles } from './cycles.js';
import { detectUnreachableFiles } from './dead-code.js';
import { detectArchitectureViolations } from './architecture.js';
import type { ArchitectureRule } from './architecture-config.js';
import { rankByComplexity } from './complexity.js';
import { detectDuplicates } from './duplication.js';

export type RefactoringSuggestionKind =
  | 'cycle' | 'architecture-violation' | 'high-complexity' | 'duplication' | 'dead-code';

export interface RefactoringSuggestion {
  kind: RefactoringSuggestionKind;
  description: string;
  files: string[];
}

export interface SuggestRefactoringOptions {
  architectureRules?: ArchitectureRule[];
  /** Default 10 — see spec 020's Scope for why. */
  complexityThreshold?: number;
}

export function suggestRefactoring(graph: Graph, options: SuggestRefactoringOptions = {}): RefactoringSuggestion[] {
  const suggestions: RefactoringSuggestion[] = [];

  for (const cycle of detectCycles(graph)) {
    suggestions.push({
      kind: 'cycle',
      description: `Circular import: ${[...cycle.files, cycle.files[0]].join(' → ')}`,
      files: cycle.files,
    });
  }

  if (options.architectureRules) {
    for (const v of detectArchitectureViolations(graph, options.architectureRules)) {
      suggestions.push({
        kind: 'architecture-violation',
        description: `${v.sourceFile} imports ${v.targetFile}, violating the declared [${v.rule.from} → ${v.rule.to}] rule`,
        files: [v.sourceFile, v.targetFile],
      });
    }
  }

  const threshold = options.complexityThreshold ?? 10;
  for (const ranked of rankByComplexity(graph, { threshold })) {
    suggestions.push({
      kind: 'high-complexity',
      description: `${ranked.label} has cyclomatic complexity ${ranked.complexity} — consider breaking it up`,
      files: [ranked.file],
    });
  }

  for (const group of detectDuplicates(graph)) {
    suggestions.push({
      kind: 'duplication',
      description: `${group.nodes.length} structurally identical functions — consider extracting a shared implementation`,
      files: group.nodes.map(n => n.file),
    });
  }

  for (const unreachable of detectUnreachableFiles(graph)) {
    suggestions.push({
      kind: 'dead-code',
      description: `${unreachable.file} is not imported by any other tracked file — candidate for removal`,
      files: [unreachable.file],
    });
  }

  return suggestions;
}
```

### 2. `packages/core/src/index.ts` export

```ts
export { suggestRefactoring } from './analyzer/suggest-refactoring.js';
export type { RefactoringSuggestion, RefactoringSuggestionKind, SuggestRefactoringOptions } from './analyzer/suggest-refactoring.js';
```

### 3. `packages/mcp/src/handlers.ts` — `handleSuggestRefactoring`

Same shape as `handleExplainArchitecture`: load the graph, look up the project's path via
`loadProjectIndex()`, load its `.nodumrc.json` rules if any, call `suggestRefactoring`, format a
text list grouped by `kind` with a per-category header — same "not raw JSON" convention as every
handler.

### 4. `packages/mcp/src/index.ts` — new tool registration

```ts
{
  name: "suggest_refactoring",
  description:
    "Unified refactoring suggestions synthesized from every analysis capability: circular imports, dead files, architecture-rule violations, overly complex functions, and duplicated code.",
  inputSchema: {
    type: "object" as const,
    properties: {
      project_name: { type: "string", description: "Project name" },
      complexity_threshold: { type: "number", description: "Optional: override the default complexity threshold (10)" },
    },
    required: ["project_name"],
  },
},
```

### 5. `packages/cli/src/commands/suggest-refactoring.ts` (new) + `bin/nodum.ts` registration

```
🛠️  Refactoring suggestions (4)

CYCLE (1):
  - Circular import: a.ts → b.ts → a.ts

HIGH-COMPLEXITY (2):
  - parseTransaction has cyclomatic complexity 14 — consider breaking it up (src/lib/parser.ts)
  ...

DUPLICATION (1):
  - 2 structurally identical functions — consider extracting a shared implementation (src/api/users.ts, src/api/orders.ts)

(or, if none:)
✅ No refactoring suggestions
```

## Acceptance criteria

- [x] A real circular import produces a `cycle` suggestion matching `detectCycles`'s own output.
- [x] Architecture violations are entirely absent (not an empty category) when no rules are
      configured; present and correct when rules are configured, matching
      `detectArchitectureViolations`'s own output for those rules.
- [x] A function at or above the complexity threshold produces a `high-complexity` suggestion; a
      function below it does not.
- [x] `options.complexityThreshold` overrides the default of 10.
- [x] A duplicate group produces exactly one `duplication` suggestion listing every member file.
- [x] An unreachable file produces exactly one `dead-code` suggestion.
- [x] Suggestions are grouped in the fixed category order (cycle → architecture-violation →
      high-complexity → duplication → dead-code), not re-sorted by any other criterion.
- [x] A project with no issues in any category returns `[]`.
- [x] `suggest_refactoring` MCP tool auto-includes architecture violations when the project has
      configured rules, without the caller passing anything extra (same as 018).
- [x] `nodum suggest-refactoring` prints a formatted, category-grouped list and exits 0.
- [x] `nodum suggest-refactoring --json` prints the raw `RefactoringSuggestion[]` array.
- [x] `nodum suggest-refactoring` on an unsynced project fails with the established
      "Run `nodum sync` first" message.

## Test plan

`packages/core/src/analyzer/suggest-refactoring.test.ts` (new) — constructed `Graph` fixtures
covering every acceptance-criteria case, plus direct cross-checks that each category's output
matches its underlying analyzer's own output exactly (not a re-derived or drifted version).

`packages/mcp/src/handlers.test.ts` (extend) — `handleSuggestRefactoring`: formatted grouped
output, rules-configured vs. not.

`packages/cli/src/commands/suggest-refactoring.test.ts` (new) — following the established
mocking convention: formatted output, `--json`, `--complexity-threshold`, missing synced
project.

## Success Metrics

- Real check: a scratch fixture engineered to trip all five categories at once (a circular
  import, an unreachable file, a `.nodumrc.json` rule its own imports violate, a function above
  the complexity threshold, and a duplicate function pair) — sync it, confirm
  `nodum suggest-refactoring` reports all five, each matching what the corresponding
  already-verified standalone command (`nodum cycles`/`dead-code`/`architecture`/
  `complexity`/`duplicates`) reports for the same fixture.
- Real check: `nodum suggest-refactoring` against `benchmarks/projects/sample-next-app` — cross-
  check the reported suggestions against every prior spec's already-verified output for this
  same fixture (010 through 019 have all been run against it).

## Related

Depends on: `011-dependency-cycle-detection`, `012-dead-code-detection`,
`013-architecture-violation-detection`, `014-complexity-scoring`,
`015-code-duplication-detection` — composes all five directly, no new detection logic.
Closes out the v2.1.0 task list (the last of 011–020).
