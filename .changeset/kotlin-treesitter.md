---
"@caiquebrito/nodum-core": minor
---

Migrates Kotlin from line-regex to tree-sitter, gaining real `method` nodes (class/interface members are now properly attributed instead of flat file-attached functions colliding on same-named methods across classes), same-file `calls` edges, a dedicated `enum` node type, real complexity/`duplicateHash` for expression-bodied functions, and fixes a real gap where extension functions (`fun String.slugify()`) were silently never extracted at all by the old regex parser.

Cyclomatic complexity now also counts non-default `when` entries (never matched by the old regex) and `elvis_expression` (`?:`) — previously excluded as a text-matching workaround that a real AST makes unnecessary, matching Swift's `??` precedent.

Import resolution (`resolveJvmImport`, dotted-FQN + wildcard specifier format) is unchanged — every pre-existing import test passes unmodified, this migration's explicit contract.

Second of three specs in the v2.9.0 batch (Go parser, Kotlin tree-sitter migration, cognitive complexity).
