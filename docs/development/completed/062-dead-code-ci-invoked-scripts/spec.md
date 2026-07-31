# 062 — Dead-code detection: CI/shell-invoked scripts

## Status: done

Implemented and tested (9 new core `ci-invoked-scripts.test.ts` tests; full workspace suite green
— 602 core, 102 cli, 91 mcp). Verified end-to-end against a scratch fixture: a `bitrise.yml`
containing `python3 tools/ci/run_quality_checks.py --base "origin/$BASE_BRANCH"` and a matching
untracked graph file correctly resolves the script as a known entry point instead of a dead-code
candidate — the exact false positive the external PokemonApp verification report caught.

Landed as `packages/core/src/analyzer/ci-invoked-scripts.ts` (`findCiInvokedFiles`,
`parseCiInvokedPaths`), not `parser/ci-invoked-scripts.ts` as originally sketched — kept it next
to `android-manifest.ts` since both are graph-resolution helpers for `detectUnreachableFiles`,
not new parsers. The open questions below were resolved during implementation.

## Goal

Stop `detectUnreachableFiles` (and everything downstream of it — CLI `nodum dead-code`, MCP
`suggest_refactoring`) from flagging scripts that are only ever invoked as a subprocess from CI
config or a shell script (never `import`ed by any tracked source file) as dead code.

## Why now

Independent verification of nodum's output against an external repo (PokemonApp, 2026-07-30)
found one concrete false positive: `tools/ci/run_quality_checks.py` was reported as dead
(0 dependents), but it's the actual entrypoint for the PR-check pipeline, invoked from
`bitrise.yml:57` as `python3 tools/ci/run_quality_checks.py --base "origin/$BASE_BRANCH"`.

This is a known category of gap — spec 012's Scope section and `detectUnreachableFiles`'s own
doc comment already call out that "a real entry point wired up outside the parsed import graph
looks identical to an orphaned file from here," and spec 061 (#2) shipped exactly this fix for
one such source: `android-manifest.ts` resolves `AndroidManifest.xml` entry points
(`application`/`activity`/`service`/`receiver`/`provider`) into `detectUnreachableFiles`'s
`entryPatterns` option. CI YAML/shell invocation is the same shape of gap, different source
format, and no longer hypothetical — it produced a real false positive an external user caught.

The existing filename-based entry-pattern heuristic (`**/main.*`, `**/cli.*`, `**/bin.*`, ...)
doesn't help here: `run_quality_checks.py` has no name signal suggesting it's an entry point.
The only way to know it's load-bearing is that some other file — outside the parsed-language
graph entirely — mentions its path.

## Scope

- A new scanner, `packages/core/src/parser/ci-invoked-scripts.ts`, following the same posture as
  spec 061's `android-manifest.ts`: regex/line-based, not a full YAML or shell parser (mirrors
  this codebase's existing build-file-free import resolution — no dependency on a YAML library).
- Input: the same file list `nodum sync` already walks. Target file types: `*.yml`, `*.yaml`
  (GitHub Actions, GitLab CI, Bitrise, CircleCI, etc.) and `*.sh` (any shell script, since CI
  YAML often just calls out to a wrapper `.sh` that itself invokes the real script).
- For each target file, extract path-shaped tokens referencing a file the graph knows about —
  e.g. any whitespace/quote-delimited token containing a `/` and ending in a known source
  extension (`.py`, `.ts`, `.js`, `.sh`, `.kt`, ...), resolved relative to the repo root and
  against `knownFileIds` the same way `resolveRelativeImport` does. No attempt to parse shell
  syntax (pipes, variable expansion, `$()`) beyond a literal path match — false negatives here
  degrade gracefully back to today's behavior (candidate still shows up, just not newly
  excluded), which is safe; false positives (excluding something that isn't really an entry
  point) are the risk to guard against, so matches require an extension whitelist, not a bare
  path guess.
- Wire the result into `detectUnreachableFiles` the same way `android-manifest.ts` does: resolved
  file paths get merged into the existing `entryPatterns`-style exclusion (exact-path match, not
  a glob — these are concrete resolved files, unlike the default glob patterns), not a new
  parallel code path.
- Wire into the CLI `dead-code` command and MCP `suggest_refactoring` the same way the manifest
  scanner is wired in (`SuggestRefactoringOptions` already has `deadCodeEntryPatterns`; extend or
  reuse it, or add a sibling option if exact-path and glob semantics turn out to need to stay
  separate — decide during implementation once the resolver shape is settled).

## Non-goals

- No general YAML or shell parser. No handling of dynamically-constructed paths
  (`"$SCRIPT_DIR/$NAME.py"`), templated CI config (matrix builds, reusable workflow includes),
  or scripts invoked only via a build-tool task graph (Gradle, Make, npm `scripts`) — those are
  each their own future spec if they turn out to matter in practice, same way this spec itself
  is scoped to YAML/shell only and not "every non-source-language invocation mechanism."
- Not attempting symbol-level resolution — this stays file-level, consistent with spec 012's
  original scope decision.

## Resolved decisions

- **Entry-file merging:** reused `entryPatterns` as-is, same as the manifest scanner — resolved
  paths with no glob metacharacters match themselves exactly through the `ignore` package, so no
  separate exact-path option was needed.
- **`SuggestRefactoringOptions` wiring:** reused the existing `deadCodeEntryPatterns` field
  (concatenated with `findManifestEntryFiles`'s output in `packages/mcp/src/handlers.ts`) rather
  than adding a sibling option — both are just resolved file paths headed for the same
  `entryPatterns` array, so there was no semantic reason to keep them separate.
- **`package.json` `scripts`:** left out, per the original non-goals — a real gap, but a
  different file format and worth its own follow-up spec if it comes up in practice.
