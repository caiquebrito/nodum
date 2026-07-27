import { describe, it, expect } from "vitest";
import type { Graph } from "@caiquebrito/nodum-core";
import { toJSON, toGraphML, toCSV } from "./export-formats.js";

const graph: Graph = {
  project: "sample",
  stats: { files: 1, functions: 2, classes: 0, interfaces: 0, edges: 1 },
  nodes: [
    {
      id: "a_ts__foo",
      label: 'foo, "quoted"',
      type: "function",
      file: "a.ts",
      group: "other",
      line: 3,
      embedding: [0.1, 0.2, 0.3],
      clusterId: "cluster_0",
    },
    {
      id: "a_ts__bar",
      label: "bar",
      type: "function",
      file: "a.ts",
      group: "other",
    },
  ],
  edges: [{ source: "a_ts__foo", target: "a_ts__bar", relation: "defines" }],
};

describe("toJSON", () => {
  it("strips embeddings and preserves every other field", () => {
    const parsed = JSON.parse(toJSON(graph));

    expect(parsed.nodes).toHaveLength(2);
    for (const node of parsed.nodes) {
      expect(node.embedding).toBeUndefined();
    }
    expect(parsed.nodes[0].label).toBe('foo, "quoted"');
    expect(parsed.nodes[0].clusterId).toBe("cluster_0");
    expect(parsed.edges).toEqual(graph.edges);
    expect(parsed.stats).toEqual(graph.stats);
  });
});

describe("toGraphML", () => {
  it("produces well-formed XML with matching node/edge counts and attributes", () => {
    const xml = toGraphML(graph);

    // Well-formedness: every opened tag closes, via a minimal stack parser.
    const tags = [...xml.matchAll(/<\/?([a-zA-Z]+)[^>]*?(\/?)>/g)];
    const stack: string[] = [];
    for (const [full, name, selfClosing] of tags) {
      if (full.startsWith("<?")) continue;
      if (selfClosing === "/") continue;
      if (full.startsWith("</")) {
        expect(stack.pop()).toBe(name);
      } else {
        stack.push(name);
      }
    }
    expect(stack).toEqual([]);

    expect((xml.match(/<node /g) || []).length).toBe(2);
    expect((xml.match(/<edge /g) || []).length).toBe(1);
    expect(xml).toContain('<node id="a_ts__foo">');
    expect(xml).toContain('<edge id="e0" source="a_ts__foo" target="a_ts__bar">');
    expect(xml).toContain("<data key=\"d6\">defines</data>");
    // XML-escaped label (comma is fine unescaped, but the quote must be escaped)
    expect(xml).toContain("foo, &quot;quoted&quot;");
    expect(xml).not.toContain("embedding");
  });
});

describe("toCSV", () => {
  it("produces correct row counts and escapes special characters", () => {
    const { nodesCsv, edgesCsv } = toCSV(graph);

    const nodeLines = nodesCsv.trim().split("\n");
    expect(nodeLines).toHaveLength(3); // header + 2 nodes
    expect(nodeLines[0]).toBe("id,label,type,file,group,line,clusterId");

    // label 'foo, "quoted"' must be quoted with doubled internal quotes
    expect(nodeLines[1]).toContain('"foo, ""quoted"""');

    const edgeLines = edgesCsv.trim().split("\n");
    expect(edgeLines).toHaveLength(2); // header + 1 edge
    expect(edgeLines[0]).toBe("source,target,relation");
    expect(edgeLines[1]).toBe("a_ts__foo,a_ts__bar,defines");
  });
});
