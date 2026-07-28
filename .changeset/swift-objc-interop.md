---
"@caiquebrito/nodum-core": minor
---

Unifies Swift and Objective-C import resolution into one shared `resolveSwiftObjcImport()`, mirroring how JVM dotted-FQN imports already resolve across Java and Kotlin. A Swift `import Foo` now resolves to `Foo`'s `.m`/`.h` files and vice versa — a mixed Swift+Objective-C project renders as one connected graph instead of two disconnected islands. A quoted `#import "Foo.h"` with no `.h`/`.m` match also probes a same-basename `.swift` file, the bridging-header case.

This is file-level `imports` edges only — not symbol-level `@objc` call resolution, which would require changes to `graph-gen.ts` and is deferred to a future spec, same posture as same-file `calls` edges deferring cross-file resolution.

Last spec in the v2.7.0 "iOS: Swift + Objective-C" batch (036-039).
