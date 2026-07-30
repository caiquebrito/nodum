import { describe, it, expect } from "vitest";
import parser from "../parser/kotlin.js";
import { detectUnreachableFiles } from "./dead-code.js";
import type { FileInfo, Graph } from "../types.js";

function fileInfo(path: string, content: string): FileInfo {
  return { path, ext: ".kt", content, hash: "h", mtimeMs: 1, size: content.length };
}

async function graphFrom(files: FileInfo[]): Promise<Graph> {
  const nodes = [];
  const edges = [];
  for (const file of files) {
    const result = await parser.parse(file);
    nodes.push(...result.nodes);
    edges.push(...result.edges);
  }
  return {
    project: "proj",
    stats: { files: files.length, functions: 0, classes: 0, interfaces: 0, edges: edges.length },
    nodes,
    edges,
  };
}

describe("detectUnreachableFiles + real KotlinParser — same-package no-import usage", () => {
  it("does not flag a route data class used only as a composable<T> generic type argument in a same-package sibling", async () => {
    const routeFile = fileInfo(
      "app/nav/PokemonDetailRoute.kt",
      `data class PokemonDetailRoute(val id: Int)\n`,
    );
    const navGraphFile = fileInfo(
      "app/nav/NavGraph.kt",
      `fun buildGraph() {\n    composable<PokemonDetailRoute> { entry ->\n        renderScreen(entry)\n    }\n}\n`,
    );

    const graph = await graphFrom([routeFile, navGraphFile]);
    const unreachable = detectUnreachableFiles(graph);
    expect(unreachable.map(f => f.file)).not.toContain("app/nav/PokemonDetailRoute.kt");
  });

  it("does not flag a Koin module value used only as a bare argument to loadKoinModules in a same-package sibling", async () => {
    const moduleFile = fileInfo(
      "app/di/CommonModule.kt",
      `val commonModule = buildModule()\n`,
    );
    const initFile = fileInfo(
      "app/di/Common.kt",
      `fun init() {\n    loadKoinModules(commonModule)\n}\n`,
    );

    const graph = await graphFrom([moduleFile, initFile]);
    const unreachable = detectUnreachableFiles(graph);
    expect(unreachable.map(f => f.file)).not.toContain("app/di/CommonModule.kt");
  });

  it("still flags a genuinely unused same-package file dead", async () => {
    const usedFile = fileInfo("app/di/CommonModule.kt", `val commonModule = buildModule()\n`);
    const uselessFile = fileInfo("app/di/Unused.kt", `val neverReferenced = 1\n`);
    const initFile = fileInfo(
      "app/di/Common.kt",
      `fun init() {\n    loadKoinModules(commonModule)\n}\n`,
    );

    const graph = await graphFrom([usedFile, uselessFile, initFile]);
    const unreachable = detectUnreachableFiles(graph);
    expect(unreachable.map(f => f.file)).toContain("app/di/Unused.kt");
  });
});
