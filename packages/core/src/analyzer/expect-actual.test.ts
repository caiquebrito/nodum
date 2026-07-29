import { describe, it, expect } from "vitest";
import { applyExpectActual } from "./expect-actual.js";
import type { Node, Edge } from "../types.js";

function funcNode(
  id: string,
  label: string,
  opts: { module?: string; sourceSet?: string; platformModifier?: "expect" | "actual"; type?: Node["type"] } = {},
): Node {
  return {
    id,
    label,
    type: opts.type ?? "function",
    file: `${opts.module ?? "app"}/src/${opts.sourceSet ?? "commonMain"}/kotlin/${id}.kt`,
    group: "other",
    ...(opts.module ? { module: opts.module } : {}),
    ...(opts.sourceSet ? { sourceSet: opts.sourceSet } : {}),
    ...(opts.platformModifier ? { platformModifier: opts.platformModifier } : {}),
  };
}

describe("applyExpectActual", () => {
  it("links a matching expect/actual pair (iosMain fulfilling commonMain)", () => {
    const expectNode = funcNode("e", "getPlatform", { module: "core/network", sourceSet: "commonMain", platformModifier: "expect" });
    const actualNode = funcNode("a", "getPlatform", { module: "core/network", sourceSet: "iosMain", platformModifier: "actual" });
    const nodes = [expectNode, actualNode];
    const edges: Edge[] = [];

    applyExpectActual(nodes, edges);

    expect(edges).toEqual([{ source: "a", target: "e", relation: "actualizes" }]);
  });

  it("links androidMain fulfilling commonMain the same way", () => {
    const expectNode = funcNode("e", "getPlatform", { module: "core", sourceSet: "commonMain", platformModifier: "expect" });
    const actualNode = funcNode("a", "getPlatform", { module: "core", sourceSet: "androidMain", platformModifier: "actual" });
    const edges: Edge[] = [];

    applyExpectActual([expectNode, actualNode], edges);

    expect(edges).toEqual([{ source: "a", target: "e", relation: "actualizes" }]);
  });

  it("does not link across different modules, even with identical name/kind/source-sets", () => {
    const expectNode = funcNode("e", "platformModule", { module: "core/network", sourceSet: "commonMain", platformModifier: "expect" });
    const actualNode = funcNode("a", "platformModule", { module: "core/profile", sourceSet: "iosMain", platformModifier: "actual" });
    const edges: Edge[] = [];

    applyExpectActual([expectNode, actualNode], edges);

    expect(edges).toEqual([]);
  });

  it("does not link when the declaration kinds differ (fun vs class)", () => {
    const expectNode = funcNode("e", "Foo", { module: "app", sourceSet: "commonMain", platformModifier: "expect", type: "class" });
    const actualNode = funcNode("a", "Foo", { module: "app", sourceSet: "iosMain", platformModifier: "actual", type: "function" });
    const edges: Edge[] = [];

    applyExpectActual([expectNode, actualNode], edges);

    expect(edges).toEqual([]);
  });

  it("does not link when the actual's source set isn't a legitimate dependent of the expect's", () => {
    // iosMain does not depend on androidMain (both depend on commonMain, but not on each other).
    const expectNode = funcNode("e", "getPlatform", { module: "app", sourceSet: "androidMain", platformModifier: "expect" });
    const actualNode = funcNode("a", "getPlatform", { module: "app", sourceSet: "iosMain", platformModifier: "actual" });
    const edges: Edge[] = [];

    applyExpectActual([expectNode, actualNode], edges);

    expect(edges).toEqual([]);
  });

  it("links commonTest fulfilled by androidTest/iosTest the same way as Main", () => {
    const expectNode = funcNode("e", "fixture", { module: "app", sourceSet: "commonTest", platformModifier: "expect" });
    const actualNode = funcNode("a", "fixture", { module: "app", sourceSet: "androidTest", platformModifier: "actual" });
    const edges: Edge[] = [];

    applyExpectActual([expectNode, actualNode], edges);

    expect(edges).toEqual([{ source: "a", target: "e", relation: "actualizes" }]);
  });

  it("links multiple actuals (one per platform) to the same expect", () => {
    const expectNode = funcNode("e", "getPlatform", { module: "app", sourceSet: "commonMain", platformModifier: "expect" });
    const androidActual = funcNode("android", "getPlatform", { module: "app", sourceSet: "androidMain", platformModifier: "actual" });
    const iosActual = funcNode("ios", "getPlatform", { module: "app", sourceSet: "iosMain", platformModifier: "actual" });
    const edges: Edge[] = [];

    applyExpectActual([expectNode, androidActual, iosActual], edges);

    expect(edges.sort((a, b) => a.source.localeCompare(b.source))).toEqual([
      { source: "android", target: "e", relation: "actualizes" },
      { source: "ios", target: "e", relation: "actualizes" },
    ]);
  });

  it("does nothing for a project with no expect/actual declarations at all", () => {
    const nodes = [funcNode("a", "foo"), funcNode("b", "bar")];
    const edges: Edge[] = [{ source: "a", target: "b", relation: "calls" }];

    applyExpectActual(nodes, edges);

    expect(edges).toEqual([{ source: "a", target: "b", relation: "calls" }]);
  });

  it("clears stale actualizes edges before recomputing — idempotent, not additive", () => {
    const expectNode = funcNode("e", "getPlatform", { module: "app", sourceSet: "commonMain", platformModifier: "expect" });
    const actualNode = funcNode("a", "getPlatform", { module: "app", sourceSet: "iosMain", platformModifier: "actual" });
    const nodes = [expectNode, actualNode];
    const edges: Edge[] = [{ source: "a", target: "e", relation: "actualizes" }]; // pre-existing, e.g. carried over by incremental sync

    applyExpectActual(nodes, edges);
    applyExpectActual(nodes, edges);

    expect(edges).toEqual([{ source: "a", target: "e", relation: "actualizes" }]);
  });

  it("preserves non-actualizes edges untouched", () => {
    const expectNode = funcNode("e", "getPlatform", { module: "app", sourceSet: "commonMain", platformModifier: "expect" });
    const actualNode = funcNode("a", "getPlatform", { module: "app", sourceSet: "iosMain", platformModifier: "actual" });
    const edges: Edge[] = [{ source: "x", target: "y", relation: "imports" }];

    applyExpectActual([expectNode, actualNode], edges);

    expect(edges).toContainEqual({ source: "x", target: "y", relation: "imports" });
    expect(edges).toContainEqual({ source: "a", target: "e", relation: "actualizes" });
    expect(edges).toHaveLength(2);
  });

  it("does not overflow the call stack clearing a huge edges array — real regression found on a real ~200,000-edge project", () => {
    // Real check (not a synthetic worry): a real ~21,447-file KMP project's
    // actual stack trace pointed at the old `edges.push(...preserved)` line
    // here — spreading a large array as individual call arguments crashes
    // once the array is big enough. 300,000 is comfortably past the real
    // scale that reproduced it.
    const edges: Edge[] = Array.from({ length: 300_000 }, (_, i) => ({
      source: `n${i}`,
      target: `n${i + 1}`,
      relation: "imports" as const,
    }));

    expect(() => applyExpectActual([], edges)).not.toThrow();
    expect(edges).toHaveLength(300_000);
  });
});
