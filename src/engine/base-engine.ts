/**
 * Behaviour shared by the WASM and native engines, built on a single
 * `run()` primitive that each engine implements.
 */

import { parseOff, parseStl } from "../geometry/parse.js";
import type { Mesh } from "../geometry/mesh.js";
import { emptyLog, mergeLogs } from "./output.js";
import type {
  Engine,
  EngineCapabilities,
  EngineLog,
  ExportResult,
  MeshResult,
  Params,
  PreparedSource,
  RunJob,
  RunResult,
} from "./types.js";
import { UserError } from "../errors.js";

const NOT_3D = /not a 3D object/;

export function timeoutMessage(ms: number): string {
  return `ERROR: Timed out after ${Math.round(ms / 1000)}s. The model may be too complex (try a lower $fn) or contain an infinite loop.`;
}

export abstract class BaseEngine implements Engine {
  abstract readonly name: "wasm" | "native";
  abstract readonly capabilities: EngineCapabilities;

  abstract run(job: RunJob): Promise<RunResult>;
  abstract version(): Promise<string>;
  abstract describe(): Promise<Record<string, string>>;
  abstract dispose(): Promise<void>;

  protected backendArgs(): string[] {
    return this.capabilities.manifold ? ["--backend=manifold"] : [];
  }

  /** OFF carries per-face colours (Manifold); otherwise fall back to binary STL. */
  private meshJob(): { ext: string; args: string[]; parse: (b: Uint8Array) => Mesh } {
    return this.capabilities.manifold
      ? { ext: "off", args: this.backendArgs(), parse: parseOff }
      : { ext: "stl", args: ["--export-format=binstl"], parse: parseStl };
  }

  async computeMesh(src: PreparedSource, params?: Params): Promise<MeshResult> {
    const started = performance.now();
    const fmt = this.meshJob();
    const first = await this.run({ src, params, outputExt: fmt.ext, args: fmt.args });
    const done = (r: Omit<MeshResult, "timeMs">): MeshResult => ({ ...r, timeMs: performance.now() - started });

    if (first.ok && first.output) {
      const mesh = this.parseMesh(fmt.parse, first.output, first.log);
      return mesh ? done({ ok: true, mesh, is2D: false, log: first.log }) : done({ ok: false, is2D: false, log: first.log });
    }

    if (!first.log.errors.some((e) => NOT_3D.test(e))) {
      return done({ ok: false, is2D: false, log: first.log });
    }

    // 2D design: export DXF, then preview it as a 1 mm extrusion.
    const baseLog: EngineLog = { ...first.log, errors: first.log.errors.filter((e) => !NOT_3D.test(e)) };
    const dxf = await this.run({ src, params, outputExt: "dxf", args: this.backendArgs() });
    if (!dxf.ok || !dxf.output) return done({ ok: false, is2D: true, log: mergeLogs(baseLog, dxf.log) });

    const wrapper: PreparedSource = {
      code: 'linear_extrude(height = 1) import("preview2d.dxf");\n',
      deps: [],
      hash: `${src.hash}:2d`,
    };
    const extruded = await this.run({
      src: wrapper,
      outputExt: fmt.ext,
      args: fmt.args,
      extraFiles: [{ name: "preview2d.dxf", data: dxf.output }],
    });
    const log = mergeLogs(baseLog, dxf.log);
    if (!extruded.ok || !extruded.output) return done({ ok: false, is2D: true, log: mergeLogs(log, extruded.log) });
    const mesh = this.parseMesh(fmt.parse, extruded.output, log);
    return mesh ? done({ ok: true, mesh, is2D: true, log }) : done({ ok: false, is2D: true, log });
  }

  private parseMesh(parse: (b: Uint8Array) => Mesh, bytes: Uint8Array, log: EngineLog): Mesh | undefined {
    try {
      const mesh = parse(bytes);
      if (mesh.indices.length === 0) {
        log.errors.push("ERROR: The model produced no geometry.");
        return undefined;
      }
      return mesh;
    } catch (e) {
      log.errors.push(`ERROR: Could not read OpenSCAD output: ${(e as Error).message}`);
      return undefined;
    }
  }

  async exportFormat(src: PreparedSource, format: string, params?: Params): Promise<ExportResult> {
    const fmt = format.toLowerCase().replace(/^\./, "");
    if (!this.capabilities.exportFormats.includes(fmt)) {
      throw new UserError(`The ${this.name} engine cannot export "${fmt}". Supported: ${this.capabilities.exportFormats.join(", ")}`);
    }
    const r = await this.run({ src, params, outputExt: fmt, args: this.backendArgs() });
    const ok = r.ok && !!r.output && r.output.length > 0;
    if (r.ok && !ok) r.log.errors.push(`ERROR: OpenSCAD produced an empty ${fmt.toUpperCase()} file.`);
    return { ok, bytes: ok ? r.output : undefined, log: r.log };
  }

  async validate(src: PreparedSource, params?: Params): Promise<{ ok: boolean; log: EngineLog }> {
    const r = await this.run({ src, params, outputExt: "csg", timeoutMs: 30_000 });
    return { ok: r.ok, log: r.log ?? emptyLog() };
  }
}
