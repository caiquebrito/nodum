import { describe, it, expect } from "vitest";
import { resolveProjectGraphPath } from "./project-path.js";

describe("resolveProjectGraphPath", () => {
  const dataDir = "/tmp/nodum-data";

  it("resolves a plain project name to its graph.json path", () => {
    expect(resolveProjectGraphPath(dataDir, "myproj")).toBe("/tmp/nodum-data/myproj/graph/graph.json");
  });

  it("allows a dotted project name — not treated as traversal", () => {
    expect(resolveProjectGraphPath(dataDir, "my.project")).toBe("/tmp/nodum-data/my.project/graph/graph.json");
  });

  it("allows a project name with spaces and unicode — a real basename() can contain these", () => {
    expect(resolveProjectGraphPath(dataDir, "Meu Projeto")).toBe("/tmp/nodum-data/Meu Projeto/graph/graph.json");
    expect(resolveProjectGraphPath(dataDir, "café")).toBe("/tmp/nodum-data/café/graph/graph.json");
  });

  it("rejects an empty project name", () => {
    expect(resolveProjectGraphPath(dataDir, "")).toBeNull();
  });

  it("rejects '.' and '..' exactly", () => {
    expect(resolveProjectGraphPath(dataDir, ".")).toBeNull();
    expect(resolveProjectGraphPath(dataDir, "..")).toBeNull();
  });

  it("rejects a name containing a forward slash (the real traversal payload)", () => {
    expect(resolveProjectGraphPath(dataDir, "../outside")).toBeNull();
    expect(resolveProjectGraphPath(dataDir, "a/b")).toBeNull();
  });

  it("rejects a name containing a backslash", () => {
    expect(resolveProjectGraphPath(dataDir, "a\\b")).toBeNull();
  });

  it("rejects a name containing a NUL byte", () => {
    expect(resolveProjectGraphPath(dataDir, "a\0b")).toBeNull();
  });
});
