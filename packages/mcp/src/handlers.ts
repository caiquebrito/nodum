import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { TextContent } from "@modelcontextprotocol/sdk/types.js";
import {
  syncProject,
  writeGraphFile,
  traceImpact,
  findBottlenecks,
  explainArchitecture,
  loadArchitectureConfig,
  findSimilarCode,
  suggestRefactoring,
  type ProjectIndexEntry,
  type Graph,
} from "@caiquebrito/nodum-core";
import { buildSmartContext, buildNodeContext } from "./smart-context.js";
import { globalConversationCache } from "./conversation-cache.js";
import { generateGraphEmbeddings } from "./embeddings.js";

export const NODUM_DATA_DIR = join(homedir(), ".nodum");

// Caps a single file/cluster listing's member list — distinct from
// smart-context.ts's expansion caps, which bound a 1-hop graph traversal
// rather than a flat listing. See spec 027.
const MAX_LISTED_MEMBERS = 20;

type ProjectIndex = Record<string, ProjectIndexEntry>;

async function loadProjectIndex(): Promise<ProjectIndex> {
  try {
    const content = await readFile(
      join(NODUM_DATA_DIR, "projects.json"),
      "utf-8"
    );
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function loadGraph(projectName: string): Promise<Graph> {
  const content = await readFile(
    join(NODUM_DATA_DIR, projectName, "graph", "graph.json"),
    "utf-8"
  );
  return JSON.parse(content);
}

function text(content: string): TextContent {
  return {
    type: "text",
    text: content,
  };
}

export async function handleSync(projectPath: string) {
  try {
    // core.syncProject already discovers, parses, analyzes, clusters, and
    // persists the graph — this handler only needs to add embeddings.
    const graph = await syncProject(projectPath, NODUM_DATA_DIR);

    // v2.0: Generate embeddings for semantic search
    await generateGraphEmbeddings(graph.nodes);
    await writeGraphFile(NODUM_DATA_DIR, graph.project, graph);

    // Clear conversation cache for this project (graph changed)
    globalConversationCache.clearProject(graph.project);

    const projects = await loadProjectIndex();
    const project = projects[graph.project];

    return {
      content: [
        text(
          `✅ Project synced successfully!\n\n` +
            `📦 Project: ${graph.project}\n` +
            `📁 Files: ${graph.stats.files}\n` +
            `⚙️  Functions: ${graph.stats.functions}\n` +
            `📦 Classes: ${graph.stats.classes}\n` +
            `🔗 Dependencies: ${graph.stats.edges}\n` +
            `🧠 Embeddings: Generated for semantic search (v2.0)\n\n` +
            `Data saved to: ${project.path}`
        ),
      ],
    };
  } catch (error) {
    return { error: `Failed to sync project: ${String(error)}` };
  }
}

export async function handleStatus() {
  try {
    const projects = await loadProjectIndex();
    const entries = Object.entries(projects);

    if (entries.length === 0) {
      return {
        content: [
          text(
            "📭 No synced projects yet.\n\n" +
              "Use the sync_project tool to scan a project:\n" +
              "  Tool: sync_project\n" +
              "  Parameter: project_path = /path/to/your/project"
          ),
        ],
      };
    }

    const summary = entries
      .map(([name, data]) => {
        const lastSync = new Date(data.lastSync).toLocaleString();
        return (
          `📦 ${name}\n` +
          `   Files: ${data.stats.files} | ` +
          `Functions: ${data.stats.functions} | ` +
          `Classes: ${data.stats.classes}\n` +
          `   Last synced: ${lastSync}\n` +
          `   Languages: ${data.stack.languages.join(", ") || "Unknown"}`
        );
      })
      .join("\n\n");

    return {
      content: [
        text(
          `✅ ${entries.length} project(s) synced:\n\n${summary}\n\n` +
            `💡 Use get_graph to fetch a project's knowledge graph`
        ),
      ],
    };
  } catch (error) {
    return { error: `Failed to get project status: ${String(error)}` };
  }
}

export async function handleGetGraph(projectName: string) {
  try {
    const graph = await loadGraph(projectName);

    // Optional per-language counters (spec 036, Swift/Objective-C) — only
    // shown when non-zero, so a non-iOS project's output stays identical to
    // pre-036 output rather than growing four permanent zero lines.
    const optionalStatLines = (
      [
        ["Structs", graph.stats.structs],
        ["Enums", graph.stats.enums],
        ["Protocols", graph.stats.protocols],
        ["Extensions", graph.stats.extensions],
      ] as const
    )
      .filter(([, count]) => (count ?? 0) > 0)
      .map(([label, count]) => `• ${label}: ${count}\n`)
      .join("");
    const optionalNodeTypeLines = [
      ["Structs", "struct"],
      ["Enums", "enum"],
      ["Protocols", "protocol"],
      ["Extensions", "extension"],
    ]
      .map(([label, type]) => [label, graph.nodes.filter((n) => n.type === type).length] as const)
      .filter(([, count]) => count > 0)
      .map(([label, count]) => `• ${label}: ${count}\n`)
      .join("");

    // Use smart context: return helpful summary, not raw dump
    const summary =
      `📊 Knowledge Graph: ${graph.project}\n\n` +
      `Statistics:\n` +
      `• Files: ${graph.stats.files}\n` +
      `• Functions: ${graph.stats.functions}\n` +
      `• Classes: ${graph.stats.classes}\n` +
      `• Interfaces: ${graph.stats.interfaces}\n` +
      optionalStatLines +
      `• Dependencies: ${graph.stats.edges}\n\n` +
      `Node Types:\n` +
      `• Files: ${graph.nodes.filter((n) => n.type === "file").length}\n` +
      `• Functions: ${graph.nodes.filter((n) => n.type === "function").length}\n` +
      `• Classes: ${graph.nodes.filter((n) => n.type === "class").length}\n` +
      `• Methods: ${graph.nodes.filter((n) => n.type === "method").length}\n` +
      `• Interfaces: ${graph.nodes.filter((n) => n.type === "interface").length}\n` +
      optionalNodeTypeLines +
      `\n💡 Use search_graph to find specific nodes and get smart context.`;

    return {
      content: [text(summary)],
    };
  } catch (error) {
    return { error: `Failed to get graph: ${String(error)}` };
  }
}

export async function handleGetNode(projectName: string, nodeId: string) {
  try {
    const graph = await loadGraph(projectName);
    const nodeContext = buildNodeContext(nodeId, graph);
    return {
      content: [text(nodeContext)],
    };
  } catch (error) {
    return { error: `Failed to get node: ${String(error)}` };
  }
}

export async function handleSearch(
  projectName: string,
  query: string,
  typeFilter?: string
) {
  try {
    const graph = await loadGraph(projectName);

    // Use smart context with caching + semantic search
    // v1.1.2: 40-60% reduction (300 tokens)
    // v2.0: 83% reduction on cache hits + 20% better selection via semantic search
    const { text: smartContext } = await buildSmartContext(query, graph, 20, globalConversationCache);

    return {
      content: [text(smartContext)],
    };
  } catch (error) {
    return { error: `Search failed: ${String(error)}` };
  }
}

export async function handleGetDeps(
  projectName: string,
  nodeId: string,
  direction: "incoming" | "outgoing"
) {
  try {
    const graph = await loadGraph(projectName);
    const node = graph.nodes.find((n) => n.id === nodeId);

    if (!node) {
      return { error: `Node not found: ${nodeId}` };
    }

    const nodeMap: { [key: string]: any } = Object.fromEntries(
      graph.nodes.map((n) => [n.id, n])
    );

    let edges = [];
    let title = "";

    if (direction === "outgoing") {
      edges = graph.edges.filter((e) => e.source === nodeId);
      title = `🔗 What ${node.label} depends on`;
    } else {
      edges = graph.edges.filter((e) => e.target === nodeId);
      title = `↑ What depends on ${node.label}`;
    }

    if (edges.length === 0) {
      return {
        content: [text(`${title}:\n(no dependencies)`)],
      };
    }

    // Smart formatting: group by type
    const byType = new Map<string, any[]>();
    edges.forEach((e) => {
      const otherNodeId = direction === "outgoing" ? e.target : e.source;
      const otherNode = nodeMap[otherNodeId];
      const type = otherNode?.type || "unknown";
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type)!.push({
        label: otherNode?.label || otherNodeId,
        relation: e.relation,
        type,
      });
    });

    const lines: string[] = [title, `(${edges.length} total)\n`];
    for (const [type, items] of byType) {
      lines.push(`${type.toUpperCase()}S (${items.length}):`);
      items.slice(0, 5).forEach((item) => {
        lines.push(`  • ${item.label} [${item.relation}]`);
      });
      if (items.length > 5) {
        lines.push(`  ... and ${items.length - 5} more`);
      }
      lines.push("");
    }

    return {
      content: [text(lines.join("\n"))],
    };
  } catch (error) {
    return { error: `Failed to get dependencies: ${String(error)}` };
  }
}

export async function handleAnalyzeFile(
  projectName: string,
  filePath: string
) {
  try {
    const graph = await loadGraph(projectName);
    const fileNode = graph.nodes.find(
      (n) => n.file === filePath && n.type === "file"
    );

    if (!fileNode) {
      return { error: `File not found: ${filePath}` };
    }

    const nodesInFile = graph.nodes.filter((n) => n.file === filePath);
    const edgesInFile = graph.edges.filter(
      (e) =>
        nodesInFile.some((n) => n.id === e.source) ||
        nodesInFile.some((n) => n.id === e.target)
    );

    const nodeMap: { [key: string]: any } = Object.fromEntries(
      graph.nodes.map((n) => [n.id, n])
    );

    const externalDeps = edgesInFile.filter(
      (e) => !nodesInFile.some((n) => n.id === e.target)
    );

    const listedMembers = nodesInFile.filter((n) => n.type !== "file");

    const summary =
      `📄 File: ${filePath}\n\n` +
      `📊 Contents:\n` +
      listedMembers
        .slice(0, MAX_LISTED_MEMBERS)
        .map((n) => `  • ${n.label} (${n.type})`)
        .join("\n") +
      (listedMembers.length > MAX_LISTED_MEMBERS
        ? `\n  ... and ${listedMembers.length - MAX_LISTED_MEMBERS} more`
        : "") +
      `\n\n` +
      `🔗 External dependencies (${externalDeps.length}):\n` +
      (externalDeps.length === 0
        ? "  (none)"
        : externalDeps
            .slice(0, 15)
            .map(
              (e) =>
                `  • ${nodeMap[e.target]?.label || e.target} ` +
                `(from ${nodeMap[e.source]?.label || e.source})`
            )
            .join("\n"));

    return {
      content: [text(summary)],
    };
  } catch (error) {
    return { error: `Failed to analyze file: ${String(error)}` };
  }
}

export async function handleExpandCluster(
  projectName: string,
  clusterId: string
) {
  try {
    const graph = await loadGraph(projectName);
    const clusters = (graph.clusters || []) as any[];
    const cluster = clusters.find((c) => c.id === clusterId);

    if (!cluster) {
      return { error: `Cluster not found: ${clusterId}` };
    }

    const nodeMap: { [key: string]: any } = Object.fromEntries(
      graph.nodes.map((n) => [n.id, n])
    );

    const memberNodes = cluster.nodeIds
      .map((id: string) => nodeMap[id])
      .filter((n: any) => n);

    const internalEdges = graph.edges.filter(
      (e: any) =>
        cluster.nodeIds.includes(e.source) &&
        cluster.nodeIds.includes(e.target)
    );

    const summary =
      `🔗 ${cluster.label}\n\n` +
      `📊 Member nodes (${memberNodes.length}):\n` +
      memberNodes
        .slice(0, MAX_LISTED_MEMBERS)
        .map((n: any) => `  • ${n.label} (${n.type})`)
        .join("\n") +
      (memberNodes.length > MAX_LISTED_MEMBERS
        ? `\n  ... and ${memberNodes.length - MAX_LISTED_MEMBERS} more`
        : "") +
      `\n\n` +
      `🔀 Internal connections (${internalEdges.length}):\n` +
      (internalEdges.length === 0
        ? "  (none)"
        : internalEdges
            .slice(0, 10)
            .map(
              (e: any) =>
                `  • ${nodeMap[e.source]?.label || e.source} → ${nodeMap[e.target]?.label || e.target}`
            )
            .join("\n")) +
      `\n\n` +
      `🔗 External dependencies:\n` +
      (cluster.externalDeps.length === 0
        ? "  (none)"
        : cluster.externalDeps
            .slice(0, MAX_LISTED_MEMBERS)
            .map((id: string) => `  • ${nodeMap[id]?.label || id}`)
            .join("\n") +
          (cluster.externalDeps.length > MAX_LISTED_MEMBERS
            ? `\n  ... and ${cluster.externalDeps.length - MAX_LISTED_MEMBERS} more`
            : ""));

    return {
      content: [text(summary)],
    };
  } catch (error) {
    return { error: `Failed to expand cluster: ${String(error)}` };
  }
}

export async function handleTraceImpact(
  projectName: string,
  nodeId: string,
  maxDepth?: number
) {
  try {
    const graph = await loadGraph(projectName);
    const node = graph.nodes.find((n) => n.id === nodeId);

    if (!node) {
      return { error: `Node not found: ${nodeId}` };
    }

    const impacted = traceImpact(graph, nodeId, { maxDepth });

    if (impacted.length === 0) {
      return {
        content: [text(`✅ No files depend on ${node.label} (${node.file || node.id})`)],
      };
    }

    const byDistance = new Map<number, typeof impacted>();
    for (const item of impacted) {
      if (!byDistance.has(item.distance)) byDistance.set(item.distance, []);
      byDistance.get(item.distance)!.push(item);
    }

    const lines: string[] = [
      `📡 Impact of changing ${node.label} (${node.file || node.id}): ${impacted.length} files`,
      "",
    ];
    for (const [distance, items] of [...byDistance.entries()].sort((a, b) => a[0] - b[0])) {
      lines.push(`${distance} hop${distance === 1 ? "" : "s"}:`);
      items.slice(0, 10).forEach((item) => lines.push(`  • ${item.file}`));
      if (items.length > 10) {
        lines.push(`  ... and ${items.length - 10} more`);
      }
      lines.push("");
    }

    return {
      content: [text(lines.join("\n"))],
    };
  } catch (error) {
    return { error: `Failed to trace impact: ${String(error)}` };
  }
}

export async function handleFindBottlenecks(projectName: string, limit?: number) {
  try {
    const graph = await loadGraph(projectName);

    const bottlenecks = findBottlenecks(graph, { limit });

    if (bottlenecks.length === 0) {
      return {
        content: [text("✅ No scored functions found")],
      };
    }

    const lines: string[] = [`🔥 Bottlenecks (${bottlenecks.length})`, ""];
    bottlenecks.forEach((b, i) => {
      lines.push(
        `  ${i + 1}. ${b.file}  score=${b.score}  complexity=${b.maxComplexity}  dependents=${b.dependentCount}`
      );
    });

    return {
      content: [text(lines.join("\n"))],
    };
  } catch (error) {
    return { error: `Failed to find bottlenecks: ${String(error)}` };
  }
}

export async function handleExplainArchitecture(projectName: string) {
  try {
    const graph = await loadGraph(projectName);
    const index = await loadProjectIndex();
    const projectPath = index[projectName]?.path;
    const rules = projectPath ? (await loadArchitectureConfig(projectPath)).rules : undefined;

    const summary = explainArchitecture(graph, rules);

    const lines: string[] = ["🏛️  Architecture overview", "", "Layers:"];
    for (const layer of summary.layers) {
      lines.push(`  ${layer.group}  ${layer.fileCount} files, ${layer.nodeCount} nodes`);
    }

    lines.push("", "Dependencies between layers:");
    if (summary.layerDependencies.length === 0) {
      lines.push("  (none)");
    } else {
      for (const dep of summary.layerDependencies) {
        lines.push(`  ${dep.sourceGroup} → ${dep.targetGroup}  ${dep.importCount} imports`);
      }
    }

    lines.push("");
    if (summary.violations === undefined) {
      lines.push(
        "Architecture rules: (none configured — run `nodum config --set-architecture-rules` to add some)"
      );
    } else {
      lines.push(`Architecture rules: ${rules!.length} configured`);
      lines.push(`Violations: ${summary.violations.length} found`);
      summary.violations.forEach((v) => {
        lines.push(`  [${v.rule.from} → ${v.rule.to}] ${v.sourceFile} → ${v.targetFile}`);
      });
    }

    return {
      content: [text(lines.join("\n"))],
    };
  } catch (error) {
    return { error: `Failed to explain architecture: ${String(error)}` };
  }
}

export async function handleFindSimilarCode(projectName: string, nodeId: string) {
  try {
    const graph = await loadGraph(projectName);
    const node = graph.nodes.find((n) => n.id === nodeId);

    const result = findSimilarCode(graph, nodeId);

    if (result.matches.length === 0) {
      return {
        content: [text(`✅ No similar code found for ${node?.label ?? nodeId}`)],
      };
    }

    const lines: string[] = [
      `🧬 Code similar to ${node?.label ?? nodeId}: ${result.matches.length} match${result.matches.length === 1 ? "" : "es"}`,
      "",
    ];
    result.matches.forEach((m) => lines.push(`  • ${m.label} (${m.file})`));

    return {
      content: [text(lines.join("\n"))],
    };
  } catch (error) {
    return { error: `Failed to find similar code: ${String(error)}` };
  }
}

export async function handleSuggestRefactoring(
  projectName: string,
  complexityThreshold?: number
) {
  try {
    const graph = await loadGraph(projectName);
    const index = await loadProjectIndex();
    const projectPath = index[projectName]?.path;
    const architectureRules = projectPath
      ? (await loadArchitectureConfig(projectPath)).rules
      : undefined;

    const suggestions = suggestRefactoring(graph, {
      architectureRules,
      complexityThreshold,
    });

    if (suggestions.length === 0) {
      return {
        content: [text("✅ No refactoring suggestions")],
      };
    }

    const byKind = new Map<string, typeof suggestions>();
    for (const s of suggestions) {
      if (!byKind.has(s.kind)) byKind.set(s.kind, []);
      byKind.get(s.kind)!.push(s);
    }

    const lines: string[] = [`🛠️  Refactoring suggestions (${suggestions.length})`, ""];
    for (const [kind, items] of byKind) {
      lines.push(`${kind.toUpperCase()} (${items.length}):`);
      items.forEach((s) => lines.push(`  - ${s.description} (${s.files.join(", ")})`));
      lines.push("");
    }

    return {
      content: [text(lines.join("\n"))],
    };
  } catch (error) {
    return { error: `Failed to suggest refactoring: ${String(error)}` };
  }
}
