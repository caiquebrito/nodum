import { describe, it, expect } from "vitest";
import { resolveRelativeImport, resolveJvmImport, resolvePythonImport, resolveSwiftObjcImport, resolveGoImport } from "./import-resolver.js";
import { normalizeNodeId } from "../types.js";

function fileId(path: string): string {
  return normalizeNodeId(path, path, "file");
}

describe("resolveRelativeImport", () => {
  const knownFileIds = new Set([
    fileId("src/a.ts"),
    fileId("src/b.ts"),
    fileId("src/components/Widget.tsx"),
    fileId("src/utils/index.ts"),
  ]);

  it("resolves a same-directory relative import missing its extension", () => {
    expect(resolveRelativeImport("src/a.ts", "./b", knownFileIds)).toBe(fileId("src/b.ts"));
  });

  it("resolves a relative import with an explicit extension", () => {
    expect(resolveRelativeImport("src/a.ts", "./components/Widget.tsx", knownFileIds)).toBe(
      fileId("src/components/Widget.tsx"),
    );
  });

  it("resolves a relative import to a directory's index file", () => {
    expect(resolveRelativeImport("src/a.ts", "./utils", knownFileIds)).toBe(fileId("src/utils/index.ts"));
  });

  it("returns null for a bare/package specifier", () => {
    expect(resolveRelativeImport("src/a.ts", "react", knownFileIds)).toBeNull();
  });

  it("returns null when no candidate file is known", () => {
    expect(resolveRelativeImport("src/a.ts", "./missing", knownFileIds)).toBeNull();
  });
});

describe("resolveJvmImport", () => {
  const knownFilesByPath = new Map([
    ["src/main/kotlin/com/example/Foo.kt", fileId("src/main/kotlin/com/example/Foo.kt")],
    ["src/main/kotlin/com/example/Bar.kt", fileId("src/main/kotlin/com/example/Bar.kt")],
    ["src/main/java/com/example/Baz.java", fileId("src/main/java/com/example/Baz.java")],
  ]);

  it("resolves a normal FQN import to its file", () => {
    expect(resolveJvmImport("com.example.Foo", knownFilesByPath)).toEqual([
      fileId("src/main/kotlin/com/example/Foo.kt"),
    ]);
  });

  it("resolves a Java FQN import to its file", () => {
    expect(resolveJvmImport("com.example.Baz", knownFilesByPath)).toEqual([
      fileId("src/main/java/com/example/Baz.java"),
    ]);
  });

  it("resolves a member import by dropping the trailing member segment", () => {
    expect(resolveJvmImport("com.example.Foo.CONSTANT", knownFilesByPath)).toEqual([
      fileId("src/main/kotlin/com/example/Foo.kt"),
    ]);
  });

  it("resolves a wildcard import to every file in that package, regardless of Kotlin/Java source root", () => {
    const result = resolveJvmImport("com.example.*", knownFilesByPath).sort();
    expect(result).toEqual(
      [
        fileId("src/main/kotlin/com/example/Foo.kt"),
        fileId("src/main/kotlin/com/example/Bar.kt"),
        fileId("src/main/java/com/example/Baz.java"),
      ].sort(),
    );
  });

  it("returns an empty array when nothing matches", () => {
    expect(resolveJvmImport("com.other.Unknown", knownFilesByPath)).toEqual([]);
  });
});

describe("resolvePythonImport", () => {
  const knownFileIds = new Set([
    fileId("main.py"),
    fileId("local_sibling.py"),
    fileId("pkg/__init__.py"),
    fileId("pkg/util.py"),
  ]);
  const knownFilesByPath = new Map([
    ["main.py", fileId("main.py")],
    ["local_sibling.py", fileId("local_sibling.py")],
    ["pkg/__init__.py", fileId("pkg/__init__.py")],
    ["pkg/util.py", fileId("pkg/util.py")],
  ]);

  it("resolves an absolute dotted-module import to its file", () => {
    expect(resolvePythonImport("pkg.util", "main.py", knownFileIds, knownFilesByPath)).toEqual([
      fileId("pkg/util.py"),
    ]);
  });

  it("resolves an absolute import of a package to its __init__.py", () => {
    expect(resolvePythonImport("pkg", "main.py", knownFileIds, knownFilesByPath)).toEqual([
      fileId("pkg/__init__.py"),
    ]);
  });

  it("resolves a bare relative import ('from . import x') to a sibling file", () => {
    expect(resolvePythonImport(".local_sibling", "main.py", knownFileIds, knownFilesByPath)).toEqual([
      fileId("local_sibling.py"),
    ]);
  });

  it("resolves a relative import naming an explicit module ('from .pkg import x')", () => {
    expect(resolvePythonImport(".pkg", "main.py", knownFileIds, knownFilesByPath)).toEqual([
      fileId("pkg/__init__.py"),
    ]);
  });

  it("resolves a relative import from within a package, one level up ('from .. import x')", () => {
    const ids = new Set([fileId("main.py"), fileId("pkg/util.py")]);
    const byPath = new Map([
      ["main.py", fileId("main.py")],
      ["pkg/util.py", fileId("pkg/util.py")],
    ]);
    // pkg/other.py doing `from .. import main` — one level up from pkg/ is root.
    expect(resolvePythonImport("..main", "pkg/other.py", ids, byPath)).toEqual([fileId("main.py")]);
  });

  it("returns an empty array for an external absolute import (stdlib/third-party)", () => {
    expect(resolvePythonImport("os.path", "main.py", knownFileIds, knownFilesByPath)).toEqual([]);
  });

  it("returns an empty array when a relative import has no matching file", () => {
    expect(resolvePythonImport(".missing", "main.py", knownFileIds, knownFilesByPath)).toEqual([]);
  });
});

describe("resolveSwiftObjcImport", () => {
  const knownFileIds = new Set<string>();
  const knownFilesByPath = new Map([
    ["Sources/Legacy/LegacyManager.h", fileId("Sources/Legacy/LegacyManager.h")],
    ["Sources/Legacy/LegacyManager.m", fileId("Sources/Legacy/LegacyManager.m")],
    ["Sources/App/ViewController.swift", fileId("Sources/App/ViewController.swift")],
    ["Sources/App/Helper.swift", fileId("Sources/App/Helper.swift")],
  ]);

  it("resolves a Swift module import to every .h/.m file under that directory — cross-language, not filtered by extension", () => {
    const result = resolveSwiftObjcImport("Legacy", "Sources/App/ViewController.swift", knownFileIds, knownFilesByPath).sort();
    expect(result).toEqual(
      [fileId("Sources/Legacy/LegacyManager.h"), fileId("Sources/Legacy/LegacyManager.m")].sort(),
    );
  });

  it("resolves a Swift dotted submodule import (only the first segment is the module)", () => {
    const result = resolveSwiftObjcImport("Legacy.SomeType", "Sources/App/ViewController.swift", knownFileIds, knownFilesByPath).sort();
    expect(result).toEqual(
      [fileId("Sources/Legacy/LegacyManager.h"), fileId("Sources/Legacy/LegacyManager.m")].sort(),
    );
  });

  it("resolves a quoted ObjC #import to its exact-extension file", () => {
    expect(
      resolveSwiftObjcImport("LegacyManager.h", "Sources/Legacy/LegacyManager.m", knownFileIds, knownFilesByPath),
    ).toEqual([fileId("Sources/Legacy/LegacyManager.h")]);
  });

  it("falls back to a same-basename .swift file when a quoted #import has no matching .h/.m — the bridging-header case", () => {
    expect(
      resolveSwiftObjcImport("Helper.h", "Sources/Legacy/LegacyManager.m", knownFileIds, knownFilesByPath),
    ).toEqual([fileId("Sources/App/Helper.swift")]);
  });

  it("returns an empty array for a system/SDK module (Foundation, UIKit)", () => {
    expect(resolveSwiftObjcImport("Foundation", "Sources/App/ViewController.swift", knownFileIds, knownFilesByPath)).toEqual([]);
  });

  it("returns an empty array for a quoted include matching neither a same-extension nor a .swift file", () => {
    expect(
      resolveSwiftObjcImport("Missing.h", "Sources/Legacy/LegacyManager.m", knownFileIds, knownFilesByPath),
    ).toEqual([]);
  });
});

describe("resolveGoImport", () => {
  const knownFileIds = new Set<string>();
  const knownFilesByPath = new Map([
    ["internal/svc/server.go", fileId("internal/svc/server.go")],
    ["internal/svc/store.go", fileId("internal/svc/store.go")],
    ["cmd/app/main.go", fileId("cmd/app/main.go")],
  ]);

  it("resolves a local package import to every .go file in that directory", () => {
    const result = resolveGoImport("myapp/internal/svc", "cmd/app/main.go", knownFileIds, knownFilesByPath).sort();
    expect(result).toEqual(
      [fileId("internal/svc/server.go"), fileId("internal/svc/store.go")].sort(),
    );
  });

  it("resolves a full module-host-prefixed import path the same way", () => {
    const result = resolveGoImport("github.com/foo/myapp/internal/svc", "cmd/app/main.go", knownFileIds, knownFilesByPath).sort();
    expect(result).toEqual(
      [fileId("internal/svc/server.go"), fileId("internal/svc/store.go")].sort(),
    );
  });

  it("returns an empty array for a stdlib import", () => {
    expect(resolveGoImport("fmt", "cmd/app/main.go", knownFileIds, knownFilesByPath)).toEqual([]);
    expect(resolveGoImport("net/http", "cmd/app/main.go", knownFileIds, knownFilesByPath)).toEqual([]);
  });

  it("returns an empty array for an import with no matching directory", () => {
    expect(resolveGoImport("myapp/internal/missing", "cmd/app/main.go", knownFileIds, knownFilesByPath)).toEqual([]);
  });
});
