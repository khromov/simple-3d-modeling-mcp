/**
 * OpenSCAD compiled to WebAssembly (bundled, zero setup).
 *
 * Every job runs in a worker thread with a fresh OpenSCAD instance
 * (Emscripten's callMain can only run once per instance). Jobs use the
 * Manifold backend, which is orders of magnitude faster than CGAL.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { posix, win32 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { FONTS_DIR, LIBRARIES_DIR, bundledLibraries, bundledLibraryVersion } from "../paths.js";
import { BaseEngine, timeoutMessage } from "./base-engine.js";
import { parseLog, rewritePaths } from "./output.js";
import { paramArgs } from "./params.js";
import type { EngineCapabilities, RunJob, RunResult } from "./types.js";
import type { WorkerInit, WorkerJob, WorkerReply } from "./wasm-worker.js";

const MAIN_VFS_PATH = "/work/input.scad";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Maps a host path to a path inside the WASM filesystem (POSIX). */
export function toVfsPath(hostPath: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32") return hostPath;
  const parsed = win32.parse(hostPath);
  const drive = parsed.root.replace(/[:\\/]/g, "") || "root";
  const rest = hostPath.slice(parsed.root.length).split("\\").join("/");
  return `/${drive}/${rest}`;
}

class TimeoutError extends Error {}

interface Task {
  job: WorkerJob;
  timeoutMs: number;
  resolve: (r: WorkerReply) => void;
  reject: (e: Error) => void;
  timer?: NodeJS.Timeout;
}

interface Slot {
  worker?: Worker;
  task?: Task;
}

/** Fixed-size pool of OpenSCAD worker threads with per-job timeouts. */
class WorkerPool {
  private readonly slots: Slot[];
  private readonly queue: Task[] = [];
  private nextId = 1;
  private disposed = false;

  constructor(size: number, private readonly init: WorkerInit, private readonly url: URL) {
    this.slots = Array.from({ length: Math.max(1, size) }, () => ({}));
  }

  run(job: Omit<WorkerJob, "id">, timeoutMs: number): Promise<WorkerReply> {
    if (this.disposed) return Promise.reject(new Error("Engine disposed"));
    return new Promise((resolve, reject) => {
      this.queue.push({ job: { ...job, id: this.nextId++ }, timeoutMs, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    for (const slot of this.slots) {
      if (slot.task) continue;
      const task = this.queue.shift();
      if (!task) return;
      this.start(slot, task);
    }
  }

  private spawn(slot: Slot): Worker {
    const worker = new Worker(this.url, { workerData: this.init });
    worker.on("message", (reply: WorkerReply) => {
      if (slot.worker === worker && slot.task?.job.id === reply.id) {
        const task = slot.task;
        this.settle(slot, () => task.resolve(reply));
      }
    });
    const onFailure = (err: Error) => {
      if (slot.worker !== worker) return;
      slot.worker = undefined;
      void worker.terminate();
      const task = slot.task;
      if (task) this.settle(slot, () => task.reject(err));
    };
    worker.on("error", onFailure);
    worker.on("exit", (code) => onFailure(new Error(`OpenSCAD worker exited unexpectedly (code ${code})`)));
    slot.worker = worker;
    return worker;
  }

  private start(slot: Slot, task: Task): void {
    const worker = slot.worker ?? this.spawn(slot);
    slot.task = task;
    worker.ref();
    task.timer = setTimeout(() => {
      if (slot.task !== task) return;
      const w = slot.worker;
      slot.worker = undefined;
      void w?.terminate();
      this.settle(slot, () => task.reject(new TimeoutError()));
    }, task.timeoutMs);
    worker.postMessage(task.job);
  }

  private settle(slot: Slot, fn: () => void): void {
    const task = slot.task;
    if (!task) return;
    clearTimeout(task.timer);
    slot.task = undefined;
    slot.worker?.unref();
    fn();
    this.pump();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const t of this.queue.splice(0)) t.reject(new Error("Engine disposed"));
    await Promise.all(
      this.slots.map(async (slot) => {
        const w = slot.worker;
        slot.worker = undefined;
        if (slot.task) this.settle(slot, () => slot.task?.reject(new Error("Engine disposed")));
        if (w) await w.terminate();
      }),
    );
  }
}

function workerUrl(): URL {
  const js = new URL("./wasm-worker.js", import.meta.url);
  if (existsSync(fileURLToPath(js))) return js;
  // Running from TypeScript sources (tests): Node strips the types itself.
  return new URL("./wasm-worker.ts", import.meta.url);
}

export interface WasmEngineOptions {
  /** Per-job timeout (default 120 s). */
  timeoutMs?: number;
  /** Number of worker threads (default 2). */
  workers?: number;
}

export class WasmEngine extends BaseEngine {
  readonly name = "wasm" as const;
  readonly capabilities: EngineCapabilities = {
    png: false,
    manifold: true,
    exportFormats: ["stl", "off", "obj", "amf", "dxf", "svg", "csg"],
  };
  readonly timeoutMs: number;
  private readonly pool: WorkerPool;
  private readonly libraries: string[];
  private versionCache?: Promise<string>;

  constructor(opts: WasmEngineOptions = {}) {
    super();
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    const require = createRequire(import.meta.url);
    const init: WorkerInit = {
      openscadUrl: pathToFileURL(require.resolve("openscad-wasm")).href,
      fontsDir: FONTS_DIR,
      librariesDir: LIBRARIES_DIR,
    };
    this.pool = new WorkerPool(opts.workers ?? 2, init, workerUrl());
    this.libraries = bundledLibraries();
  }

  async run(job: RunJob): Promise<RunResult> {
    const started = performance.now();
    const { src } = job;
    const mainPath = src.path ? toVfsPath(src.path) : MAIN_VFS_PATH;
    const workDir = posix.dirname(mainPath);
    const outputPath = `/out/result.${job.outputExt}`;

    const files: WorkerJob["files"] = [{ path: mainPath, data: encoder.encode(src.code) }];
    let corpus = src.code;
    for (const dep of src.deps) {
      files.push({ path: toVfsPath(dep.path), data: dep.data });
      if (dep.path.toLowerCase().endsWith(".scad")) corpus += "\n" + decoder.decode(dep.data);
    }
    for (const extra of job.extraFiles ?? []) files.push({ path: posix.join(workDir, extra.name), data: extra.data });

    const args = [mainPath, ...(job.args ?? []), ...paramArgs(job.params), "-o", outputPath];
    const timeoutMs = job.timeoutMs ?? this.timeoutMs;

    let reply: WorkerReply;
    try {
      reply = await this.pool.run(
        {
          args,
          files,
          outputPath,
          fonts: /text|font/i.test(corpus),
          libraries: this.libraries.filter((name) => corpus.includes(name)),
        },
        timeoutMs,
      );
    } catch (e) {
      const timedOut = e instanceof TimeoutError;
      return {
        ok: false,
        log: { errors: [timedOut ? timeoutMessage(timeoutMs) : `ERROR: ${(e as Error).message}`], warnings: [], echo: [] },
        exitCode: -1,
        timedOut,
        raw: [],
        timeMs: performance.now() - started,
      };
    }

    let log = parseLog(reply.lines);
    if (!src.path) log = rewritePaths(log, [[MAIN_VFS_PATH, "input.scad"]]);
    if (reply.crash) log.errors.push(`ERROR: OpenSCAD crashed: ${reply.crash}`);
    if (reply.exitCode !== 0 && log.errors.length === 0) {
      log.errors.push(`ERROR: OpenSCAD exited with code ${reply.exitCode}`);
    }
    const ok = reply.exitCode === 0 && log.errors.length === 0 && reply.output !== undefined;
    return { ok, output: reply.output, log, exitCode: reply.exitCode, timedOut: false, raw: reply.lines, timeMs: performance.now() - started };
  }

  version(): Promise<string> {
    this.versionCache ??= this.pool
      .run({ args: ["--version"], files: [], fonts: false, libraries: [] }, 30_000)
      .then((r) => {
        const all = r.lines.join("\n");
        const m = all.match(/OpenSCAD version\s+\S+/i) ?? all.match(/\d{4}\.\d{2}\.\d{2}|\d+\.\d+(\.\d+)?/);
        return m ? m[0] : all.trim() || "unknown";
      })
      .catch((e) => `unknown (${(e as Error).message})`);
    return this.versionCache;
  }

  async describe(): Promise<Record<string, string>> {
    return {
      Engine: "WASM (bundled OpenSCAD, no install needed)",
      OpenSCAD: await this.version(),
      Backend: "Manifold",
      "PNG previews": "built-in software renderer",
      "Bundled libraries": this.libraries.map((l) => `${l} ${bundledLibraryVersion(l) ?? ""}`.trim()).join(", ") || "none",
      Fonts: "DejaVu Sans / Serif / Sans Mono (Liberation Sans → DejaVu Sans)",
      Timeout: `${Math.round(this.timeoutMs / 1000)}s per job`,
    };
  }

  async dispose(): Promise<void> {
    await this.pool.dispose();
  }
}
