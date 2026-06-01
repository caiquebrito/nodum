import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { TextContent } from "@modelcontextprotocol/sdk/types.js";
import { syncProject } from "@caiquebrito/nodum-core";

const NODUM_DATA_DIR = join(homedir(), ".nodum");

interface Graph {
  project: string;
  stats: {
    files: number;
    functions: number;
    classes: number;
    interfaces: number;
    edges: number;
  };
  nodes: Array<{
    id: string;
    label: string;
    type: string;
    group?: string;
    file?: string;
  }>;
  edges: Array<{
    source: string;
    target: string;
    relation: string;
  }>;
}

interface ProjectIndex {
  [projectName: string]: {
    name: string;
    path: string;
    lastSync: string;
    stats: {
      files: number;
      functions: number;
      classes: number;
      interfaces: number;
      edges: number;
    };
    stack: {
      languages: string[];
      frameworks: string[];
    };
  };
}

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
    await syncProject(projectPath, NODUM_DATA_DIR);

    // Load the synced project to get stats
    const projects = await loadProjectIndex();
    const projectName = Object.keys(projects).pop();

    if (!projectName) {
      return { error: "Failed to find synced project" };
    }

    const project = projects[projectName];
    return {
      content: [
        text(
          `✅ Project synced successfully!\n\n` +
            `📦 Project: ${projectName}\n` +
            `📁 Files: ${project.stats.files}\n` +
            `⚙️  Functions: ${project.stats.functions}\n` +
            `📦 Classes: ${project.stats.classes}\n` +
            `🔗 Dependencies: ${project.stats.edges}\n\n` +
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

    // Return summary with sample nodes
    const summary = {
      project: graph.project,
      stats: graph.stats,
      totalNodes: graph.nodes.length,
      totalEdges: graph.edges.length,
      nodeTypes: {
        files: graph.nodes.filter((n) => n.type === "file").length,
        functions: graph.nodes.filter((n) => n.type === "function").length,
        classes: graph.nodes.filter((n) => n.type === "class").length,
        methods: graph.nodes.filter((n) => n.type === "method").length,
        interfaces: graph.nodes.filter((n) => n.type === "interface").length,
      },
      sampleNodes: graph.nodes.slice(0, 10),
      sampleEdges: graph.edges.slice(0, 5),
    };

    return {
      content: [text(JSON.stringify(summary, null, 2))],
    };
  } catch (error) {
    return { error: `Failed to get graph: ${String(error)}` };
  }
}

export async function handleGetNode(projectName: string, nodeId: string) {
  try {
    const graph = await loadGraph(projectName);
    const node = graph.nodes.find((n) => n.id === nodeId);

    if (!node) {
      return { error: `Node not found: ${nodeId}` };
    }

    // Get edges for this node
    const outgoing = graph.edges.filter((e) => e.source === nodeId);
    const incoming = graph.edges.filter((e) => e.target === nodeId);

    const nodeMap: { [key: string]: any } = Object.fromEntries(
      graph.nodes.map((n) => [n.id, n])
    );

    return {
      content: [
        text(
          `📍 Node: ${node.label}\n` +
            `   ID: ${node.id}\n` +
            `   Type: ${node.type}\n` +
            `   File: ${node.file || "N/A"}\n` +
            `   Group: ${node.group || "N/A"}\n\n` +
            `🔗 Dependencies (${outgoing.length}):\n` +
            (outgoing.length === 0
              ? "   (none)"
              : outgoing
                  .slice(0, 20)
                  .map(
                    (e) => `   • ${nodeMap[e.target]?.label || e.target}`
                  )
                  .join("\n")) +
            `\n\n` +
            `↑ Used by (${incoming.length}):\n` +
            (incoming.length === 0
              ? "   (none)"
              : incoming
                  .slice(0, 20)
                  .map(
                    (e) => `   • ${nodeMap[e.source]?.label || e.source}`
                  )
                  .join("\n"))
        ),
      ],
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
    const queryLower = query.toLowerCase();

    let results = graph.nodes.filter(
      (n) =>
        n.label.toLowerCase().includes(queryLower) ||
        n.id.includes(queryLower) ||
        (n.file && n.file.toLowerCase().includes(queryLower))
    );

    if (typeFilter) {
      results = results.filter((n) => n.type === typeFilter);
    }

    if (results.length === 0) {
      return {
        content: [text(`No results found for "${query}"`)],
      };
    }

    const formatted = results
      .slice(0, 20)
      .map((n) => `📍 ${n.label}\n   Type: ${n.type}\n   ID: ${n.id}`)
      .join("\n\n");

    return {
      content: [
        text(
          `Found ${results.length} result(s) for "${query}":\n\n${formatted}` +
            (results.length > 20
              ? `\n\n(showing first 20 of ${results.length})`
              : "")
        ),
      ],
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
      title = `Dependencies of ${node.label}`;
    } else {
      edges = graph.edges.filter((e) => e.target === nodeId);
      title = `Dependents of ${node.label}`;
    }

    if (edges.length === 0) {
      return {
        content: [text(`${title}:\n(no ${direction} edges)`)],
      };
    }

    const formatted = edges
      .map((e) => {
        const otherNodeId = direction === "outgoing" ? e.target : e.source;
        const otherNode = nodeMap[otherNodeId];
        return (
          `• ${otherNode?.label || otherNodeId}\n` +
          `  (${e.relation}) [${otherNode?.type || "unknown"}]`
        );
      })
      .join("\n");

    return {
      content: [
        text(
          `${title} (${edges.length}):\n\n${formatted}` +
            (edges.length > 20
              ? `\n\n(showing first 20 of ${edges.length})`
              : "")
        ),
      ],
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

    const summary =
      `📄 File: ${filePath}\n\n` +
      `📊 Contents:\n` +
      nodesInFile
        .filter((n) => n.type !== "file")
        .map((n) => `  • ${n.label} (${n.type})`)
        .join("\n") +
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
