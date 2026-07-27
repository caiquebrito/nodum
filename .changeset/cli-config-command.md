---
"@caiquebrito/nodum-core": minor
"@caiquebrito/nodum-cli": minor
---

Real `.gitignore` support (the `ignore` package was a dependency this whole time but never wired up) and `.nodumrc.json` include/exclude patterns via a new `nodum config` command. Also fixes `.go`/`.rs`/`.rb` extensions being discovered and counted in sync stats despite having no parser — the supported-extension list is now derived from the registered parsers themselves instead of a separately-maintained hardcoded list, so this can't drift again. Excluded directories now stop the file walk from recursing into them entirely, not just filter their contents afterward.
