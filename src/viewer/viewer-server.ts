/**
 * Local HTTP + WebSocket server for the interactive 3D viewer.
 *
 * Bound to 127.0.0.1 only. Requests must carry a localhost Host header
 * (blocks DNS rebinding) and, when a browser sends an Origin, it must be the
 * viewer's own origin (blocks other web pages from reading models over the
 * WebSocket or triggering the slicer endpoint).
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { isDefaultColor } from "../geometry/mesh.js";
import { ASSETS_DIR } from "../paths.js";
import { write3mf, writeBinaryStl } from "../geometry/writers.js";
import { generateViewerHtml } from "./viewer-html.js";
import { ViewerState, type AddVersionInput, type ModelVersion } from "./viewer-state.js";

const SLICERS: Record<string, { mac: string; win: string; linux: string }> = {
  bambu: { mac: "BambuStudio", win: "BambuStudio", linux: "bambu-studio" },
  orca: { mac: "OrcaSlicer", win: "orca-slicer", linux: "orca-slicer" },
  prusa: { mac: "PrusaSlicer", win: "prusa-slicer", linux: "prusa-slicer" },
  cura: { mac: "UltiMaker Cura", win: "UltiMaker-Cura", linux: "cura" },
  creality: { mac: "Creality Print", win: "Creality Print", linux: "creality-print" },
};

export function buildSlicerCommand(slicer: string, filePath: string, os: string): { cmd: string; args: string[] } {
  if (slicer === "default") {
    if (os === "darwin") return { cmd: "open", args: [filePath] };
    if (os === "win32") return { cmd: "cmd", args: ["/c", "start", "", filePath] };
    return { cmd: "xdg-open", args: [filePath] };
  }
  const entry = SLICERS[slicer];
  if (!entry) throw new Error(`Unknown slicer: "${slicer}". Valid options: default, ${Object.keys(SLICERS).join(", ")}`);
  if (os === "darwin") return { cmd: "open", args: ["-a", entry.mac, filePath] };
  if (os === "win32") return { cmd: "cmd", args: ["/c", "start", "", entry.win, filePath] };
  return { cmd: entry.linux, args: [filePath] };
}

/** Binary mesh for the viewer: "S3DM", version, triangle count, flags, positions (f32×9n), colours (u8×4n, A=0 → default). */
export function encodeViewerMesh(model: ModelVersion): Buffer {
  const { positions: p, indices: idx, colors } = model.mesh;
  const n = idx.length / 3;
  const hasColors = !!colors;
  const buf = Buffer.alloc(16 + n * 36 + (hasColors ? n * 4 : 0));
  buf.write("S3DM", 0, "ascii");
  buf.writeUInt32LE(1, 4);
  buf.writeUInt32LE(n, 8);
  buf.writeUInt32LE(hasColors ? 1 : 0, 12);
  const pos = new Float32Array(buf.buffer, buf.byteOffset + 16, n * 9);
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k] * 3;
      pos[t * 9 + k * 3] = p[v];
      pos[t * 9 + k * 3 + 1] = p[v + 1];
      pos[t * 9 + k * 3 + 2] = p[v + 2];
    }
  }
  if (colors) {
    const off = 16 + n * 36;
    for (let t = 0; t < n; t++) {
      const r = colors[t * 4], g = colors[t * 4 + 1], b = colors[t * 4 + 2];
      const def = isDefaultColor(r, g, b);
      buf[off + t * 4] = r;
      buf[off + t * 4 + 1] = g;
      buf[off + t * 4 + 2] = b;
      buf[off + t * 4 + 3] = def ? 0 : 255;
    }
  }
  return buf;
}

function safeFileName(title: string): string {
  return (title || "model").replace(/[^A-Za-z0-9 _.-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "model";
}

/** three.js files vendored into assets/vendor/three by scripts/fetch-assets.mjs. */
function resolveThreeFiles(): Record<string, string> {
  const dir = join(ASSETS_DIR, "vendor", "three");
  return {
    "/vendor/three/three.module.js": join(dir, "three.module.js"),
    "/vendor/three/three.core.js": join(dir, "three.core.js"),
    "/vendor/three/addons/controls/OrbitControls.js": join(dir, "addons", "controls", "OrbitControls.js"),
  };
}

export interface ViewerServerOptions {
  maxVersions?: number;
}

export class ViewerServer {
  private _server: Server | null = null;
  private _wss: WebSocketServer | null = null;
  private _url: string | null = null;
  private _port = 0;
  private _starting: Promise<string> | null = null;
  private readonly _clients = new Set<WebSocket>();
  private readonly _vendor = resolveThreeFiles();
  private readonly _vendorCache = new Map<string, Buffer>();
  readonly state: ViewerState;

  constructor(opts: ViewerServerOptions | number = {}) {
    const o = typeof opts === "number" ? { maxVersions: opts } : opts;
    this.state = new ViewerState(o.maxVersions ?? 30);
  }

  get isRunning(): boolean {
    return this._server !== null && this._server.listening;
  }

  get url(): string | null {
    return this._url;
  }

  private allowedHost(host: string | undefined): boolean {
    return host === `localhost:${this._port}` || host === `127.0.0.1:${this._port}`;
  }

  private allowedOrigin(origin: string | undefined): boolean {
    // Non-browser clients send no Origin; browsers always do for WebSocket and POST.
    return origin === undefined || origin === `http://localhost:${this._port}` || origin === `http://127.0.0.1:${this._port}`;
  }

  async start(): Promise<string> {
    if (this._url) return this._url;
    this._starting ??= this.listen().finally(() => {
      this._starting = null;
    });
    return this._starting;
  }

  private listen(): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        this.handle(req, res).catch(() => {
          if (!res.headersSent) res.writeHead(500);
          res.end("Internal error");
        });
      });

      const wss = new WebSocketServer({
        server,
        maxPayload: 64 * 1024,
        verifyClient: ({ req, origin }: { req: IncomingMessage; origin?: string }) =>
          this.allowedHost(req.headers.host) && this.allowedOrigin(origin || undefined),
      });
      wss.on("connection", (ws) => this.onConnection(ws));

      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          this._port = addr.port;
          this._url = `http://localhost:${addr.port}`;
          this._server = server;
          this._wss = wss;
          resolve(this._url);
        } else {
          reject(new Error("Failed to bind viewer server"));
        }
      });
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.allowedHost(req.headers.host)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    const url = new URL(req.url ?? "/", `http://localhost:${this._port}`);
    const path = url.pathname;

    if (req.method === "GET" && path === "/") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
        "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' ws://localhost:* ws://127.0.0.1:*; img-src 'self' data:",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(generateViewerHtml());
      return;
    }

    if (req.method === "GET" && this._vendor[path]) {
      let body = this._vendorCache.get(path);
      if (!body) {
        body = await readFile(this._vendor[path]);
        this._vendorCache.set(path, body);
      }
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "max-age=86400" });
      res.end(body);
      return;
    }

    let m = /^\/mesh\/(\d+)$/.exec(path);
    if (req.method === "GET" && m) {
      const model = this.state.getVersion(Number(m[1]));
      if (!model) return this.notFound(res);
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(encodeViewerMesh(model));
      return;
    }

    m = /^\/model\/(\d+)(?:\.(stl|3mf))?$/.exec(path);
    if (req.method === "GET" && m) {
      const model = this.state.getVersion(Number(m[1]));
      if (!model) return this.notFound(res);
      const fmt = m[2] ?? "stl";
      const bytes = fmt === "3mf" ? write3mf(model.mesh, { title: model.title }) : writeBinaryStl(model.mesh);
      res.writeHead(200, {
        "Content-Type": fmt === "3mf" ? "model/3mf" : "model/stl",
        "Content-Disposition": `attachment; filename="${safeFileName(model.title)}-v${model.version}.${fmt}"`,
      });
      res.end(Buffer.from(bytes));
      return;
    }

    m = /^\/open-in-slicer\/(\d+)$/.exec(path);
    if (req.method === "POST" && m) {
      if (!this.allowedOrigin(req.headers.origin)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      const model = this.state.getVersion(Number(m[1]));
      if (!model) return this.notFound(res);
      const slicer = url.searchParams.get("slicer") ?? "default";
      let command: { cmd: string; args: string[] };
      const dir = join(tmpdir(), "simple-3d-modeling-mcp", "slicer");
      const filePath = join(dir, `${safeFileName(model.title)}-v${model.version}.stl`);
      try {
        command = buildSlicerCommand(slicer, filePath, platform());
      } catch {
        res.writeHead(400);
        res.end(`Invalid slicer. Valid options: default, ${Object.keys(SLICERS).join(", ")}`);
        return;
      }
      await mkdir(dir, { recursive: true });
      await writeFile(filePath, writeBinaryStl(model.mesh));
      execFile(command.cmd, command.args, (err) => {
        res.writeHead(err ? 500 : 200);
        res.end(err ? "Failed to open slicer" : "OK");
      });
      return;
    }

    this.notFound(res);
  }

  private notFound(res: ServerResponse): void {
    res.writeHead(404);
    res.end("Not found");
  }

  private updateMessage(model: ModelVersion): string {
    return JSON.stringify({
      type: "model-update",
      version: model.version,
      title: model.title,
      timestamp: model.timestamp,
      is2D: model.is2D,
      stats: model.stats,
    });
  }

  private onConnection(ws: WebSocket): void {
    this._clients.add(ws);
    ws.on("close", () => this._clients.delete(ws));
    ws.on("error", () => this._clients.delete(ws));
    ws.send(JSON.stringify({ type: "model-history", versions: this.state.getHistory() }));
    const latest = this.state.latest;
    if (latest) ws.send(this.updateMessage(latest));
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "request-model" && typeof msg.version === "number") {
          const model = this.state.getVersion(msg.version);
          if (model) ws.send(this.updateMessage(model));
        }
      } catch {
        // ignore malformed messages
      }
    });
  }

  /** Records a model version and notifies connected viewers. */
  pushModel(input: AddVersionInput): ModelVersion {
    const { entry, added } = this.state.addVersion(input);
    const msg = this.updateMessage(entry);
    if (added || input.title) {
      for (const client of this._clients) {
        try {
          client.send(msg);
        } catch {
          // client went away
        }
      }
    }
    return entry;
  }

  async stop(): Promise<void> {
    for (const client of this._clients) {
      try {
        client.terminate();
      } catch {
        // ignore
      }
    }
    this._clients.clear();
    if (this._wss) {
      this._wss.close();
      this._wss = null;
    }
    if (this._server) {
      const server = this._server;
      this._server = null;
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    this._url = null;
  }
}
