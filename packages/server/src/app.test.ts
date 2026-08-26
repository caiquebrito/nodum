import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { createApp } from "./app.js";

// Real listening server against a real temp data dir — the first tests for
// this package (spec 047). A sentinel file is planted as a SIBLING of the
// data dir (not inside it), so a successful traversal payload would read
// it — mirroring the exact directory shape the pre-fix vulnerability was
// confirmed against.
describe("createApp — spec 047 path-traversal hardening", () => {
  let dataDir: string;
  let siblingDir: string;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), "nodum-server-test-"));
    dataDir = join(root, "data");
    siblingDir = join(root, "sentinel-outside-data-dir");

    await mkdir(join(dataDir, "myproj", "graph"), { recursive: true });
    await writeFile(
      join(dataDir, "myproj", "graph", "graph.json"),
      JSON.stringify({ project: "myproj", stats: {}, nodes: [], edges: [] }),
      "utf-8",
    );
    await mkdir(join(dataDir, "my.project", "graph"), { recursive: true });
    await writeFile(
      join(dataDir, "my.project", "graph", "graph.json"),
      JSON.stringify({ project: "my.project", stats: {}, nodes: [], edges: [] }),
      "utf-8",
    );
    await writeFile(
      join(dataDir, "projects.json"),
      JSON.stringify({ myproj: { name: "myproj" } }),
      "utf-8",
    );

    await mkdir(join(siblingDir, "graph"), { recursive: true });
    await writeFile(
      join(siblingDir, "graph", "graph.json"),
      JSON.stringify({ SENTINEL: "THIS_SHOULD_NEVER_BE_READABLE_VIA_HTTP" }),
      "utf-8",
    );

    const app = createApp(dataDir);
    server = app.listen(0);
    await new Promise<void>((resolveReady) => server.once("listening", resolveReady));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
    await rm(join(dataDir, ".."), { recursive: true, force: true });
  });

  it("returns a legit project's real graph", async () => {
    const res = await fetch(`${baseUrl}/api/projects/myproj/graph`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.project).toBe("myproj");
  });

  it("returns a dotted project name's graph — proves the fix doesn't over-reject legal names", async () => {
    const res = await fetch(`${baseUrl}/api/projects/my.project/graph`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.project).toBe("my.project");
  });

  it("returns 404 for an unknown project, not the sentinel", async () => {
    const res = await fetch(`${baseUrl}/api/projects/nonexistent/graph`);
    expect(res.status).toBe(404);
  });

  it("blocks a URL-encoded '../' traversal payload — the real, confirmed pre-fix vulnerability", async () => {
    const res = await fetch(`${baseUrl}/api/projects/..%2Fsentinel-outside-data-dir/graph`);
    const text = await res.text();
    expect(text).not.toContain("SENTINEL");
    expect(res.status).toBe(400);
  });

  it("blocks a double-encoded traversal payload", async () => {
    const res = await fetch(`${baseUrl}/api/projects/%2e%2e%2fsentinel-outside-data-dir/graph`);
    const text = await res.text();
    expect(text).not.toContain("SENTINEL");
  });

  it("blocks a literal '..' project name", async () => {
    const res = await fetch(`${baseUrl}/api/projects/..%2f../graph`);
    const text = await res.text();
    expect(text).not.toContain("SENTINEL");
  });

  it("returns the project index", async () => {
    const res = await fetch(`${baseUrl}/api/projects`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.myproj).toBeDefined();
  });
});

// Real listening server with a token configured (spec 078) — verifies the
// gate actually rejects/accepts over a real HTTP request, not just a unit
// test of the comparison function.
describe("createApp — spec 078 token auth for non-loopback binds", () => {
  const TOKEN = "correct-token-abc123";
  let dataDir: string;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), "nodum-server-auth-test-"));
    dataDir = join(root, "data");
    await mkdir(join(dataDir, "myproj", "graph"), { recursive: true });
    await writeFile(
      join(dataDir, "myproj", "graph", "graph.json"),
      JSON.stringify({ project: "myproj", stats: {}, nodes: [], edges: [] }),
      "utf-8",
    );
    await writeFile(
      join(dataDir, "projects.json"),
      JSON.stringify({ myproj: { name: "myproj" } }),
      "utf-8",
    );

    const app = createApp(dataDir, { token: TOKEN });
    server = app.listen(0);
    await new Promise<void>((resolveReady) => server.once("listening", resolveReady));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
    await rm(join(dataDir, ".."), { recursive: true, force: true });
  });

  it("rejects a request with no token", async () => {
    const res = await fetch(`${baseUrl}/api/projects`);
    expect(res.status).toBe(401);
  });

  it("rejects a request with the wrong token", async () => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts a request with the correct token via Authorization header", async () => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
  });

  it("accepts a request with the correct token via ?token= query param", async () => {
    const res = await fetch(`${baseUrl}/api/projects?token=${TOKEN}`);
    expect(res.status).toBe(200);
  });

  it("rejects the graph route without a token too", async () => {
    const res = await fetch(`${baseUrl}/api/projects/myproj/graph`);
    expect(res.status).toBe(401);
  });
});
