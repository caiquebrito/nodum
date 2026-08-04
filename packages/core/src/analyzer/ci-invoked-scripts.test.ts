import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { parseCiInvokedPaths, findCiInvokedFiles } from "./ci-invoked-scripts.js";
import { normalizeNodeId } from "../types.js";
import type { Node } from "../types.js";

describe("parseCiInvokedPaths", () => {
  it("extracts a script path invoked from a shell command", () => {
    const yaml = `
      script: |
        python3 tools/ci/run_quality_checks.py --base "origin/$BASE_BRANCH"
    `;
    expect(parseCiInvokedPaths(yaml)).toEqual(["tools/ci/run_quality_checks.py"]);
  });

  it("extracts multiple distinct paths and dedupes repeats", () => {
    const yaml = `
      steps:
        - run: bash scripts/build.sh
        - run: bash scripts/build.sh
        - run: node tools/check.js
    `;
    expect(parseCiInvokedPaths(yaml).sort()).toEqual(["scripts/build.sh", "tools/check.js"].sort());
  });

  it("ignores bare filenames with no directory separator", () => {
    const yaml = `run: npx eslint.js`;
    expect(parseCiInvokedPaths(yaml)).toEqual([]);
  });

  it("returns [] for content with no path-shaped tokens", () => {
    expect(parseCiInvokedPaths("name: CI\non: [push]")).toEqual([]);
  });
});

describe("findCiInvokedFiles", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nodum-ci-invoked-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function fileNode(path: string): Node {
    return { id: normalizeNodeId(path, path, "file"), label: path, type: "file", file: path, group: "other" };
  }

  it("resolves a script invoked from a root-level CI YAML file to its graph path", async () => {
    await writeFile(
      join(dir, "bitrise.yml"),
      `steps:\n  - script: python3 tools/ci/run_quality_checks.py --base "origin/$BASE_BRANCH"\n`,
      "utf-8",
    );

    const filePath = "tools/ci/run_quality_checks.py";
    const graphNodes = [fileNode(filePath)];

    const entryFiles = await findCiInvokedFiles(dir, graphNodes);
    expect(entryFiles).toEqual([filePath]);
  });

  it("resolves scripts referenced from a .sh file too", async () => {
    await mkdir(join(dir, "ci"), { recursive: true });
    await writeFile(join(dir, "ci/entry.sh"), `#!/bin/sh\npython3 tools/ci/run_quality_checks.py\n`, "utf-8");

    const graphNodes = [fileNode("tools/ci/run_quality_checks.py")];
    const entryFiles = await findCiInvokedFiles(dir, graphNodes);
    expect(entryFiles).toEqual(["tools/ci/run_quality_checks.py"]);
  });

  it("returns [] when no CI YAML/shell file exists under rootPath", async () => {
    await mkdir(join(dir, "src"), { recursive: true });
    const entryFiles = await findCiInvokedFiles(dir, [fileNode("src/index.ts")]);
    expect(entryFiles).toEqual([]);
  });

  it("skips a referenced path that doesn't resolve to any known graph file", async () => {
    await writeFile(join(dir, "ci.yml"), `run: python3 tools/ci/missing.py\n`, "utf-8");
    const entryFiles = await findCiInvokedFiles(dir, [fileNode("app/other.ts")]);
    expect(entryFiles).toEqual([]);
  });

  it("does not flag a script that's already reachable via a real import edge as newly special", async () => {
    await writeFile(join(dir, "ci.yml"), `run: python3 tools/ci/run_quality_checks.py\n`, "utf-8");
    const graphNodes = [fileNode("tools/ci/run_quality_checks.py"), fileNode("tools/ci/helper.py")];
    const entryFiles = await findCiInvokedFiles(dir, graphNodes);
    expect(entryFiles).toEqual(["tools/ci/run_quality_checks.py"]);
  });
});
