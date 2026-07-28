---
"@caiquebrito/nodum-core": patch
"@caiquebrito/nodum-mcp": patch
---

Consolidates duplicated `Graph`/`Node`/`Edge` type declarations. `packages/core/src/analyzer/clustering.ts`, `packages/mcp/src/embeddings.ts`, and `packages/mcp/src/smart-context.ts` now import these types from `@caiquebrito/nodum-core` instead of hand-redeclaring an approximation of them. `packages/mcp/src/handlers.ts`'s local `Graph` type (which used `type: string` instead of the real `NodeType`, papered over with an `as unknown as CoreGraph` cast at five call sites) is removed entirely along with all five casts.

Fixes a stale doc comment claiming 1536-dim embeddings — the real model is 384-dim. Pure type consolidation with no intended behavior change; verified via a real end-to-end sync exercising every previously-cast handler.
