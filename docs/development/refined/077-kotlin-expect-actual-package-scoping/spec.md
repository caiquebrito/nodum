# 077 — Kotlin expect/actual: verify package-path-aware matching against a second real project

## Status: refined — not started

## Goal

Resolve the third and last documented gap in `docs/development/ROADMAP.md`'s "Kotlin
`expect`/`actual`" entry: `applyExpectActual` matches by `module + declaration-kind + label` only,
with no package-path awareness (this parser has never extracted Kotlin `package` declarations at
all). Spec 055's real-world verification found this sufficient against the one real KMP project
available at the time — a same-name collision across two different modules was already
disambiguated by module-scoping alone — but flagged that as "verified-sufficient-once," not proof
against every real project's naming. This spec is a **research/verification question first,
implementation second**: find out whether it's still true, then act on the finding.

## Why now

Specs 075 and 076 closed the other two gaps in the same roadmap entry (class-body members,
top-level properties) — both were concrete implementation tasks with no open question. This one
isn't: doing real implementation work (extracting `package` declarations, adding a
package-path-aware matching mode) before confirming there's a real collision to prevent risks
solving a problem that doesn't exist in practice, the same posture this codebase already applies
elsewhere (e.g. `packages/server` real auth, declined twice for the same "not yet urgent" reason —
see spec 078). Picking this up now, immediately after 075/076, keeps the whole three-gap KMP arc
together instead of letting the last piece drift indefinitely.

## Scope

1. **Find a second real KMP project** with `expect`/`actual` declarations, distinct from the one
   spec 055 used (that project's identity isn't recorded in the roadmap by name — check
   `~/.nodum/kmp-real-fixture` and spec 055/075/076's own verification notes for what's already
   known; if genuinely unavailable on this machine, that itself is a finding to document, not a
   reason to fabricate one, matching how 076 handled "no real KMP project with property usage
   exists").
2. **Sync it with the real CLI and inspect the real `graph.json`** for same-module, same-kind,
   same-label `expect`/`actual` pairs that live in different Kotlin `package`s — the specific
   collision class module-scoping alone can't distinguish. Two sub-questions:
   - Does a real collision exist in this second project? (If not, this closes the gap by
     documenting two-for-two verified-sufficient, not by writing new matching logic nobody needs.)
   - Separately: does the real project's actual directory-per-package convention already make
     `Node.file`'s directory path a usable proxy for package identity, the same
     "same-directory-as-package-proxy" heuristic `resolveJvmImport`/`usedBySamePackageSibling`
     already lean on elsewhere in this codebase — or does it diverge (e.g. multiple packages
     sharing one directory, a package split across directories)?
3. **Only if a real collision is found**: scope and implement real Kotlin `package` declaration
   extraction (a new `Node.package` or similar field, populated from the grammar's
   `package_header` node — verify the real shipped grammar's node shape empirically first, per
   this codebase's own standing practice, not assumed from generic Kotlin docs) plus a
   package-aware disambiguation step in `applyExpectActual`, mirroring the `method`-only
   enclosing-type-label scoping spec 075 already added for the analogous class-collision case.

## Out of scope

- Extracting Kotlin `package` declarations as a general-purpose graph feature independent of this
  spec's own finding — only build it if step 2 above finds a real, current need for it.
- Any change to `resolveJvmImport`'s directory-suffix matching — a different mechanism (import
  resolution, not expect/actual pairing), unrelated to this spec's scope even if step 2 finds the
  directory-as-package-proxy heuristic has limits.

## Design

Deliberately not fully designed ahead of the research step — the point of this spec is that the
implementation shape (if any) depends on what the second real project's actual collision looks
like, the same posture spec 074 (Xcode) used when a real decision couldn't be made without
information this environment doesn't yet have. If step 2 finds a real collision, follow spec 075's
own precedent as the template: a `Map`-based scoping lookup built once per `applyExpectActual`
call (not per-pair inside the existing O(actuals × expects) loop — see that function's own
`buildMethodEnclosingTypeLabels` comment for why), gated so it's inert for every pre-existing
non-colliding case.

## Acceptance criteria

- [ ] A second real KMP project (or a documented, honest reason none is available on this machine)
      has been synced with the real CLI and its real `graph.json` inspected for same-module/kind/
      label expect/actual pairs across different packages.
- [ ] The roadmap's "Kotlin `expect`/`actual`" entry is updated either way: closed as
      verified-sufficient (no code change), or closed by shipping real package-path-aware matching
      backed by a real reproduced collision — not left open a third time without a stated reason.

## Test plan

- If no implementation is needed: no new tests — the "test" is the real sync + `graph.json`
  inspection itself, documented in the completed spec the same way 076's own verification was.
- If implementation is needed: extend `packages/core/src/analyzer/expect-actual.test.ts` with a
  same-module/kind/label, different-package case (mirroring spec 075's own
  "does not cross-link same-named methods belonging to different classes" test), plus a
  `packages/core/src/parser/kotlin.test.ts` case for the new `package_header` extraction itself.

## Success Metrics

Not a ranking/retrieval or token-cost change — no `retrieval-eval.ts`/`benchmarks/harness.ts`
before/after applies. Success is a closed roadmap item, backed by a real verification finding
either direction.

## Related

- `docs/development/completed/055-kotlin-expect-actual-kmp/spec.md` — original scope note that
  first flagged this as "verified-sufficient-once."
- `docs/development/completed/075-kotlin-expect-actual-members/spec.md` — the
  `buildMethodEnclosingTypeLabels` scoping-map pattern this spec would reuse if implementation
  turns out to be needed.
- `docs/development/completed/076-kotlin-top-level-properties/spec.md` — the sibling gap closed
  immediately before this one.
