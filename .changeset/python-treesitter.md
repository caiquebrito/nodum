---
"@caiquebrito/nodum-core": minor
---

Migrates the Python parser from line-regex to tree-sitter. Python previously had no real import extraction at all — the loop existed but its body was dead code, so every Python project silently produced zero cross-file `imports` edges while `nodum sync` reported success. It now resolves absolute (`import os.path`, `from os import x`), package (`from pkg import x` → `pkg/__init__.py`), and relative (`from . import sibling`, `from .pkg import x`) imports into real edges via new `resolvePythonImport()`.

Also adds real cyclomatic complexity (including ternaries — the old regex-based scorer deliberately excluded them across all three of its languages to dodge a Kotlin false-positive that doesn't apply to a tree-sitter-based parser) and `duplicateHash` for Python for the first time, fixes a class/function name collision from a shared name-tracking set, fixes `async def` never matching the old `^\s*def` regex anchor, and attributes class methods to their class (`type: 'method'`, `classId -> methodId` edge) instead of flattening them into file-level `function` nodes.

Spec 031, second of the v2.3.0 tree-sitter migration batch.
