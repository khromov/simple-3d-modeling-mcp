/**
 * Native OpenSCAD CLI engine. Used when OPENSCAD_PATH points at a binary, or
 * when a Manifold-capable OpenSCAD (2024+ / nightly) is found automatically.
 */

import { execFile } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { promisify } from "node:util";
import { LIBRARIES_DIR, bundledLibraries } from "../paths.js";
import type { CameraSpec } from "../rendering/camera.js";
import { BaseEngine, timeoutMessage } from "./base-engine.js";
import { parseLog, rewritePaths } from "./output.js";
import { paramArgs } from "./params.js";
import type { EngineCapabilities, PngRenderOptions, PreparedSource, RunJob, RunResult } from "./types.js";

const execFileAsync = promisify(execFile);

export interface NativeProbe {
  executable: string;
  version: string;
  manifold: boolean;
}

/** Runs `--version` / `--help`; throws when the binary is not a working OpenSCAD. */
export async function probeOpenScad(executable: string): Promise<NativeProbe> {
  let versionText: string;
  try {
    const r = await execFileAsync(executable, ["--version"], { timeout: 20_000, windowsHide: true });
    versionText = `${r.stdout}${r.stderr}`.trim();
  } catch (e: any) {
    throw new Error(e?.code === "ENOENT" ? `${executable} not found` : `${executable} --version failed: ${e?.message ?? e}`);
  }
  if (!/openscad|\d{4}\.\d{2}/i.test(versionText)) {
    throw new Error(`${executable} does not look like OpenSCAD (--version printed "${versionText.slice(0, 80)}")`);
  }
  let help = "";
  try {
    const r = await execFileAsync(executable, ["--help"], { timeout: 20_000, windowsHide: true });
    help = `${r.stdout}${r.stderr}`;
  } catch (e: any) {
    help = `${e?.stdout ?? ""}${e?.stderr ?? ""}`; // some versions exit non-zero for --help
  }
  return { executable, version: versionText.split(/\r?\n/)[0], manifold: /--backend/.test(help) };
}

/** Candidate OpenSCAD binaries: PATH first (nightly preferred), then well-known install locations. */
export function findOpenScadCandidates(env: NodeJS.ProcessEnv = process.env, os: NodeJS.Platform = platform()): string[] {
  const out: string[] = [];
  const add = (p: string) => {
    if (!out.includes(p) && existsSync(p)) out.push(p);
  };
  const exts = os === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean) : [""];
  for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const name of ["openscad-nightly", "openscad"]) {
      for (const ext of exts) add(join(dir, name + ext.toLowerCase()));
    }
  }
  if (os === "darwin") {
    add("/Applications/OpenSCAD (Nightly).app/Contents/MacOS/OpenSCAD");
    add("/Applications/OpenSCAD-Nightly.app/Contents/MacOS/OpenSCAD");
    add("/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD");
    add(join(homedir(), "Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD"));
  } else if (os === "win32") {
    add("C:\\Program Files\\OpenSCAD (Nightly)\\openscad.exe");
    add("C:\\Program Files\\OpenSCAD\\openscad.exe");
    add("C:\\Program Files (x86)\\OpenSCAD\\openscad.exe");
  } else {
    add("/usr/bin/openscad-nightly");
    add("/usr/bin/openscad");
    add("/usr/local/bin/openscad");
    add("/snap/bin/openscad");
  }
  return out;
}

function cameraArgs(camera: CameraSpec): string[] {
  switch (camera.kind) {
    case "fit":
      return [`--camera=0,0,0,${camera.rot.join(",")},100`, "--autocenter", "--viewall"];
    case "gimbal":
      return [`--camera=${[...camera.translate, ...camera.rot, camera.distance].join(",")}`];
    case "vector":
      return [`--camera=${[...camera.eye, ...camera.center].join(",")}`];
  }
}

export interface NativeEngineOptions {
  workDir?: string;
  timeoutMs?: number;
}

export class NativeEngine extends BaseEngine {
  readonly name = "native" as const;
  readonly capabilities: EngineCapabilities;
  readonly workDir: string;
  readonly timeoutMs: number;
  /** Explanation of why this engine was chosen (shown by get_version). */
  selectionNote?: string;

  constructor(readonly probe: NativeProbe, opts: NativeEngineOptions = {}) {
    super();
    this.workDir = opts.workDir ?? join(tmpdir(), "sketchpad-3d-model-mcp");
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.capabilities = {
      png: true,
      manifold: probe.manifold,
      exportFormats: ["stl", "off", "obj", "amf", "3mf", "dxf", "svg", "pdf", "csg"],
    };
  }

  static async create(executable: string, opts: NativeEngineOptions = {}): Promise<NativeEngine> {
    return new NativeEngine(await probeOpenScad(executable), opts);
  }

  get executable(): string {
    return this.probe.executable;
  }

  /** OPENSCADPATH: the user's value, plus bundled libraries they don't already have. */
  private openscadPath(): string {
    const parts = (process.env.OPENSCADPATH ?? "").split(delimiter).filter(Boolean);
    const installed = new Set(Object.keys(this.listLibraries()));
    if (bundledLibraries().some((lib) => !installed.has(lib))) parts.push(LIBRARIES_DIR);
    return parts.join(delimiter);
  }

  async run(job: RunJob): Promise<RunResult> {
    const started = performance.now();
    await mkdir(this.workDir, { recursive: true });
    const tmp = await mkdtemp(join(this.workDir, "job-"));
    try {
      const useOriginal = !!job.src.path && !job.extraFiles?.length;
      const mainPath = useOriginal ? job.src.path! : join(tmp, "input.scad");
      if (!useOriginal) await writeFile(mainPath, job.src.code, "utf8");
      for (const extra of job.extraFiles ?? []) await writeFile(join(tmp, extra.name), extra.data);
      const outPath = join(tmp, `result.${job.outputExt}`);
      const args = [...(job.args ?? []), ...paramArgs(job.params), "-o", outPath, mainPath];
      const timeoutMs = job.timeoutMs ?? this.timeoutMs;

      let stdout = "";
      let stderr = "";
      let exitCode = 0;
      let timedOut = false;
      try {
        const r = await execFileAsync(this.executable, args, {
          timeout: timeoutMs,
          maxBuffer: 64 * 1024 * 1024,
          cwd: dirname(mainPath),
          env: { ...process.env, OPENSCADPATH: this.openscadPath() },
          windowsHide: true,
        });
        stdout = r.stdout;
        stderr = r.stderr;
      } catch (e: any) {
        stdout = e?.stdout ?? "";
        stderr = e?.stderr ?? "";
        timedOut = e?.killed === true;
        exitCode = typeof e?.code === "number" ? e.code : -1;
        if (!stderr && !timedOut) stderr = `ERROR: ${e?.message ?? e}`;
      }

      const raw = `${stderr}\n${stdout}`.split(/\r?\n/);
      let log = parseLog(raw);
      if (!useOriginal) log = rewritePaths(log, [[mainPath, "input.scad"]]);
      if (timedOut) log.errors.push(timeoutMessage(timeoutMs));
      let output: Uint8Array | undefined;
      try {
        output = new Uint8Array(await readFile(outPath));
      } catch {
        // no output
      }
      if (exitCode !== 0 && log.errors.length === 0) log.errors.push(`ERROR: OpenSCAD exited with code ${exitCode}`);
      const ok = exitCode === 0 && !timedOut && log.errors.length === 0 && output !== undefined;
      return { ok, output, log, exitCode, timedOut, raw, timeMs: performance.now() - started };
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  /** OpenSCAD's own preview render (OpenCSG): fast and shows color(). */
  renderPng(src: PreparedSource, opts: PngRenderOptions): Promise<RunResult> {
    const args = [
      ...cameraArgs(opts.camera),
      `--projection=${opts.projection === "orthographic" ? "ortho" : "perspective"}`,
      `--imgsize=${opts.width},${opts.height}`,
    ];
    if (opts.colorscheme) args.push(`--colorscheme=${opts.colorscheme}`);
    return this.run({ src, params: opts.params, outputExt: "png", args });
  }

  async version(): Promise<string> {
    return this.probe.version;
  }

  async describe(): Promise<Record<string, string>> {
    const libs = Object.keys(this.listLibraries());
    const info: Record<string, string> = {
      Engine: "Native OpenSCAD",
      Executable: this.executable,
      OpenSCAD: this.probe.version,
      Backend: this.probe.manifold ? "Manifold" : "CGAL (slow — a 2024+ or nightly OpenSCAD adds the much faster Manifold backend)",
      "PNG previews": "OpenSCAD preview (falls back to the software renderer if OpenGL is unavailable)",
      "Installed libraries": libs.length ? libs.join(", ") : "none",
      "Bundled libraries": bundledLibraries().join(", ") || "none",
      Timeout: `${Math.round(this.timeoutMs / 1000)}s per job`,
    };
    if (this.selectionNote) info.Selection = this.selectionNote;
    return info;
  }

  async dispose(): Promise<void> {}

  // -- Native-only extras -------------------------------------------------

  libraryPaths(): string[] {
    const home = homedir();
    const os = platform();
    const candidates = (process.env.OPENSCADPATH ?? "").split(delimiter).filter(Boolean);
    if (os === "darwin") {
      candidates.push(join(home, "Documents", "OpenSCAD", "libraries"));
      candidates.push(join(home, "Library", "Application Support", "OpenSCAD", "libraries"));
    } else if (os === "win32") {
      candidates.push(join(home, "Documents", "OpenSCAD", "libraries"));
    } else {
      candidates.push(join(home, ".local", "share", "OpenSCAD", "libraries"));
      candidates.push("/usr/share/openscad/libraries");
      candidates.push("/usr/local/share/openscad/libraries");
    }
    return [...new Set(candidates)].filter((p) => existsSync(p));
  }

  listLibraries(): Record<string, string[]> {
    const libs: Record<string, string[]> = {};
    for (const libDir of this.libraryPaths()) {
      try {
        for (const entry of readdirSync(libDir)) {
          const full = join(libDir, entry);
          if (statSync(full).isDirectory()) {
            libs[entry] = readdirSync(full).filter((f) => f.endsWith(".scad")).slice(0, 20);
          } else if (entry.endsWith(".scad")) {
            libs[entry.replace(/\.scad$/, "")] = [entry];
          }
        }
      } catch {
        // skip unreadable directories
      }
    }
    return libs;
  }
}
