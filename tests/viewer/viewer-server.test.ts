import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { computeStats } from "../../src/geometry/stats.js";
import { buildSlicerCommand, ViewerServer } from "../../src/viewer/viewer-server.js";
import { box, lShape } from "../helpers/meshes.js";

function rawGet(url: string, path: string, headers: Record<string, string>): Promise<number> {
  const { port } = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}

describe("ViewerServer", () => {
  let server: ViewerServer | null = null;
  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  const push = (s: ViewerServer, title = "Test") => {
    const mesh = lShape();
    return s.pushModel({ mesh, stats: computeStats(mesh), title, key: title });
  };

  it("starts once on a random localhost port and serves the page", async () => {
    server = new ViewerServer();
    const [a, b] = await Promise.all([server.start(), server.start()]);
    expect(a).toMatch(/^http:\/\/localhost:\d+$/);
    expect(b).toBe(a);
    const res = await fetch(a);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    const html = await res.text();
    expect(html).toContain("/vendor/three/three.module.js");
    expect(html).not.toContain("cdn.jsdelivr");
  });

  it("serves three.js locally", async () => {
    server = new ViewerServer();
    const url = await server.start();
    for (const path of ["/vendor/three/three.module.js", "/vendor/three/three.core.js", "/vendor/three/addons/controls/OrbitControls.js"]) {
      const res = await fetch(url + path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type")).toContain("javascript");
    }
    expect((await fetch(url + "/vendor/three/../../package.json")).status).toBe(404);
  });

  it("rejects requests with a foreign Host header (DNS rebinding)", async () => {
    server = new ViewerServer();
    const url = await server.start();
    const port = new URL(url).port;
    expect(await rawGet(url, "/", { Host: "evil.example" })).toBe(403);
    expect(await rawGet(url, "/", { Host: `127.0.0.1:${port}` })).toBe(200);
  });

  it("rejects WebSocket connections from other origins", async () => {
    server = new ViewerServer();
    const url = await server.start();
    const ws = new WebSocket(url.replace("http", "ws"), { origin: "https://evil.example" });
    const status = await new Promise<number>((resolve) => {
      ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      ws.on("open", () => resolve(101));
    });
    expect(status).not.toBe(101);
  });

  it("rejects cross-origin POSTs to the slicer endpoint", async () => {
    server = new ViewerServer();
    const url = await server.start();
    push(server);
    const res = await fetch(`${url}/open-in-slicer/1?slicer=prusa`, { method: "POST", headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    const bad = await fetch(`${url}/open-in-slicer/1?slicer=nope`, { method: "POST" });
    expect(bad.status).toBe(400);
  });

  it("notifies WebSocket clients with stats and serves the mesh", async () => {
    server = new ViewerServer();
    const url = await server.start();
    const ws = new WebSocket(url.replace("http", "ws"), { origin: url });
    const messages: any[] = [];
    ws.on("message", (d) => messages.push(JSON.parse(String(d))));
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));

    push(server, "Bracket");
    await new Promise((r) => setTimeout(r, 100));
    const update = messages.find((m) => m.type === "model-update");
    expect(update).toMatchObject({ version: 1, title: "Bracket" });
    expect(update.stats.size).toEqual([30, 25, 30]);
    expect(update.stlBase64).toBeUndefined(); // mesh is fetched over HTTP, not pushed as base64
    ws.close();

    const mesh = Buffer.from(await (await fetch(`${url}/mesh/1`)).arrayBuffer());
    expect(mesh.toString("ascii", 0, 4)).toBe("S3DM");
    const tris = mesh.readUInt32LE(8);
    expect(tris).toBe(36);
    expect(mesh.readUInt32LE(12) & 1).toBe(1); // has colours
    expect(mesh.length).toBe(16 + tris * 36 + tris * 4);
  });

  it("offers STL and 3MF downloads", async () => {
    server = new ViewerServer();
    const url = await server.start();
    server.pushModel({ mesh: box([0, 0, 0], [1, 1, 1]), stats: computeStats(box([0, 0, 0], [1, 1, 1])), title: "My part!" });
    const stl = await fetch(`${url}/model/1.stl`);
    expect(stl.headers.get("content-disposition")).toBe('attachment; filename="My-part-v1.stl"');
    expect((await stl.arrayBuffer()).byteLength).toBe(84 + 12 * 50);
    const threeMf = await fetch(`${url}/model/1.3mf`);
    expect(Buffer.from(await threeMf.arrayBuffer()).readUInt32LE(0)).toBe(0x04034b50);
    expect((await fetch(`${url}/model/99`)).status).toBe(404);
  });

  it("reports running state", async () => {
    server = new ViewerServer();
    expect(server.isRunning).toBe(false);
    await server.start();
    expect(server.isRunning).toBe(true);
    await server.stop();
    expect(server.isRunning).toBe(false);
    expect(server.url).toBeNull();
  });
});

describe("buildSlicerCommand", () => {
  it("builds platform commands and rejects unknown slicers", () => {
    expect(buildSlicerCommand("default", "/m.stl", "darwin")).toEqual({ cmd: "open", args: ["/m.stl"] });
    expect(buildSlicerCommand("prusa", "/m.stl", "darwin")).toEqual({ cmd: "open", args: ["-a", "PrusaSlicer", "/m.stl"] });
    expect(buildSlicerCommand("orca", "C:\\m.stl", "win32")).toEqual({ cmd: "cmd", args: ["/c", "start", "", "orca-slicer", "C:\\m.stl"] });
    expect(buildSlicerCommand("cura", "/m.stl", "linux")).toEqual({ cmd: "cura", args: ["/m.stl"] });
    expect(() => buildSlicerCommand("evil; rm -rf /", "/m.stl", "linux")).toThrow(/Unknown slicer/);
  });
});
