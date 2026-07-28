---
"@caiquebrito/nodum-core": minor
---

Adds Objective-C support (`.m`/`.h`) via tree-sitter: classes, categories/extensions, protocols, methods, C functions, real cyclomatic complexity, structural `duplicateHash`, same-file `calls` edges, and `resolveObjcImport()` (quoted `#import`/`#include` by filename-suffix match, `@import` by module-name directory match).

A type node is emitted only from `@implementation`/`@protocol` — a bare `@interface` (`.h` declaration) contributes imports only, avoiding the split-node problem a header/implementation pair would otherwise cause. `calls` edges resolve `self`/`super` message sends (a deliberate, documented divergence from the other four parsers' bare-call-only rule — Objective-C has no bare method-call syntax at all) plus bare C function calls.

Zero changes to `graph-gen.ts` or `file-discovery.ts` — same result as the Swift parser (spec 037).
