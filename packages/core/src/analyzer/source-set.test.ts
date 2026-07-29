import { describe, it, expect } from "vitest";
import { detectSourceSet, applySourceSets, detectModule, applyModules } from "./source-set.js";
import type { Node } from "../types.js";

describe("detectSourceSet", () => {
  it("detects a KMP source set via a /kotlin/ path", () => {
    expect(detectSourceSet("shared/src/commonMain/kotlin/Greeting.kt")).toBe("commonMain");
    expect(detectSourceSet("shared/src/androidMain/kotlin/Platform.kt")).toBe("androidMain");
    expect(detectSourceSet("shared/src/iosMain/kotlin/Platform.kt")).toBe("iosMain");
    expect(detectSourceSet("shared/src/commonTest/kotlin/GreetingTest.kt")).toBe("commonTest");
  });

  it("detects a classic Android/Java source set via a /java/ path", () => {
    expect(detectSourceSet("app/src/main/java/com/example/Main.kt")).toBe("main");
    expect(detectSourceSet("app/src/test/java/com/example/MainTest.kt")).toBe("test");
    expect(detectSourceSet("app/src/androidTest/java/com/example/MainTest.kt")).toBe("androidTest");
  });

  it("detects a product-flavor source set", () => {
    expect(detectSourceSet("app/src/androidTestBahia/kotlin/Foo.kt")).toBe("androidTestBahia");
  });

  it("returns undefined for a bare src/main.kt with no source-set segment", () => {
    expect(detectSourceSet("src/main.kt")).toBeUndefined();
  });

  it("returns undefined for a non-Kotlin/Java path", () => {
    expect(detectSourceSet("src/components/foo.ts")).toBeUndefined();
  });

  it("returns undefined for a path with no src/ segment at all", () => {
    expect(detectSourceSet("main/kotlin/Foo.kt")).toBeUndefined();
  });

  it("normalizes a Windows-style backslash path", () => {
    expect(detectSourceSet("app\\src\\main\\java\\com\\example\\Main.kt")).toBe("main");
  });

  it("matches at any depth, not just the project root", () => {
    expect(detectSourceSet("deeply/nested/module/path/src/commonMain/kotlin/Foo.kt")).toBe("commonMain");
  });
});

describe("applySourceSets", () => {
  function node(file: string, sourceSet?: string): Node {
    return { id: file, label: file, type: "file", file, group: "other", ...(sourceSet ? { sourceSet } : {}) };
  }

  it("stamps sourceSet on nodes whose file matches the convention", () => {
    const nodes = [node("shared/src/commonMain/kotlin/Foo.kt"), node("app.ts")];
    applySourceSets(nodes);
    expect(nodes[0].sourceSet).toBe("commonMain");
    expect(nodes[1].sourceSet).toBeUndefined();
  });

  it("is idempotent — running it twice produces the same result", () => {
    const nodes = [node("shared/src/androidMain/kotlin/Foo.kt")];
    applySourceSets(nodes);
    applySourceSets(nodes);
    expect(nodes[0].sourceSet).toBe("androidMain");
  });

  it("clears a stale sourceSet when the node's file no longer matches", () => {
    const nodes = [node("shared/src/androidMain/kotlin/Foo.kt", "commonMain")]; // pre-existing stale label
    applySourceSets(nodes);
    expect(nodes[0].sourceSet).toBe("androidMain");
  });

  it("removes sourceSet entirely for a node whose file doesn't match the convention", () => {
    const nodes = [node("app.ts", "commonMain")]; // shouldn't have had one in the first place
    applySourceSets(nodes);
    expect(nodes[0].sourceSet).toBeUndefined();
    expect("sourceSet" in nodes[0]).toBe(false);
  });
});

describe("detectModule", () => {
  it("detects a top-level module", () => {
    expect(detectModule("app/src/main/kotlin/com/example/Main.kt")).toBe("app");
  });

  it("detects a nested module path", () => {
    expect(detectModule("forro/feature/src/androidMain/kotlin/Foo.kt")).toBe("forro/feature");
  });

  it("returns undefined for a single-module project with no path segment before src/", () => {
    expect(detectModule("src/main/kotlin/Foo.kt")).toBeUndefined();
  });

  it("returns undefined for a path with no src/ segment at all", () => {
    expect(detectModule("app/build.gradle.kts")).toBeUndefined();
  });

  it("normalizes a Windows-style backslash path", () => {
    expect(detectModule("app\\src\\main\\kotlin\\Foo.kt")).toBe("app");
  });

  it("stops at the first /src/ occurrence, not a later one", () => {
    expect(detectModule("app/src/main/kotlin/com/example/src/Foo.kt")).toBe("app");
  });

  it("returns undefined for a non-Gradle TypeScript monorepo's own packages/<name>/src/ layout", () => {
    // Regression: a bare `/src/` split would false-positive on this exact
    // repo's own package layout — module must be gated on the Kotlin/Java
    // source-set convention, not any `/src/` occurrence.
    expect(detectModule("packages/core/src/graph-gen.ts")).toBeUndefined();
  });
});

describe("applyModules", () => {
  function node(file: string, module?: string): Node {
    return { id: file, label: file, type: "file", file, group: "other", ...(module ? { module } : {}) };
  }

  it("stamps module on nodes whose file matches the convention", () => {
    const nodes = [node("forro/feature/src/main/kotlin/Foo.kt"), node("app.ts")];
    applyModules(nodes);
    expect(nodes[0].module).toBe("forro/feature");
    expect(nodes[1].module).toBeUndefined();
  });

  it("is idempotent — running it twice produces the same result", () => {
    const nodes = [node("app/src/main/kotlin/Foo.kt")];
    applyModules(nodes);
    applyModules(nodes);
    expect(nodes[0].module).toBe("app");
  });

  it("clears a stale module when the node's file no longer matches", () => {
    const nodes = [node("app/src/main/kotlin/Foo.kt", "stale-module")];
    applyModules(nodes);
    expect(nodes[0].module).toBe("app");
  });

  it("removes module entirely for a node whose file doesn't match the convention", () => {
    const nodes = [node("app.ts", "stale-module")];
    applyModules(nodes);
    expect(nodes[0].module).toBeUndefined();
    expect("module" in nodes[0]).toBe(false);
  });
});
