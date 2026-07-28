---
"@caiquebrito/nodum-core": minor
---

Migrates the Java parser from line-regex to tree-sitter. The old method regex needed a `CONTROL_FLOW_WORDS` guard just to avoid matching `} else if (...)` as a method named `if` — its own comment admitted the fix wasn't exhaustive — and missed constructors entirely (`public Foo(int x)` doesn't match a "two words before the paren" pattern once `public` is consumed as a modifier). Both are now structurally impossible rather than patched around.

Constructors are now extracted (as `method`-type nodes labeled with the class name). Methods and constructors are attributed to their class or interface (`classId -> methodId` edge) instead of flattened to the file. Real cyclomatic complexity, including a ternary (previously excluded across all three regex-scored languages, spec 014) and two node types the old regex never distinguished: enhanced-for (`for (T x : xs)`) and do-while. Real `duplicateHash`. Import resolution (`resolveJvmImport`, shared with Kotlin) is unchanged.

Spec 032, third of the v2.3.0 tree-sitter migration batch.
