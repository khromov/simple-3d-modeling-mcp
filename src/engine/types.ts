import type { Mesh } from "../geometry/mesh.js";

export type ParamValue = string | number | boolean | ParamValue[];
export type Params = Record<string, ParamValue>;

/** A host file the model depends on (include/use/import), copied into the WASM filesystem. */
export interface SourceFile {
  /** Absolute host path. */
  path: string;
  data: Uint8Array;
}

/** OpenSCAD source ready to run: inline code or a file on disk, plus its dependencies. */
export interface PreparedSource {
  code: string;
  /** Absolute host path of the main .scad file, when rendering from disk. */
  path?: string;
  /** Files referenced via include/use/import (resolved relative to the including file). */
  deps: SourceFile[];
  /** Content hash of code + path + deps; used as part of cache keys. */
  hash: string;
}

export interface EngineLog {
  errors: string[];
  warnings: string[];
  /** echo() output, without the "ECHO: " prefix. */
  echo: string[];
}

export interface RunJob {
  src: PreparedSource;
  params?: Params;
  /** Output file extension, e.g. "off", "stl", "dxf", "csg". */
  outputExt: string;
  /** Extra command-line arguments (camera, export format, …). */
  args?: string[];
  /** Additional files written next to the main file (used for the 2D preview). */
  extraFiles?: { name: string; data: Uint8Array }[];
  timeoutMs?: number;
}

export interface RunResult {
  ok: boolean;
  output?: Uint8Array;
  log: EngineLog;
  exitCode: number;
  timedOut: boolean;
  /** Raw stderr/stdout lines (for diagnostics). */
  raw: string[];
  timeMs: number;
}

export interface MeshResult {
  ok: boolean;
  mesh?: Mesh;
  /** The design is 2D; `mesh` is a 1 mm extrusion of it for previewing. */
  is2D: boolean;
  log: EngineLog;
  timeMs: number;
}

export interface ExportResult {
  ok: boolean;
  bytes?: Uint8Array;
  log: EngineLog;
}

export interface EngineCapabilities {
  /** Formats the engine can export directly via OpenSCAD. */
  exportFormats: string[];
}

export interface Engine {
  readonly name: "wasm";
  readonly capabilities: EngineCapabilities;
  /** Low-level: run OpenSCAD once. */
  run(job: RunJob): Promise<RunResult>;
  /** Evaluate the model to a triangle mesh (with colours when available). */
  computeMesh(src: PreparedSource, params?: Params): Promise<MeshResult>;
  /** Export via OpenSCAD itself (formats not built from the mesh, e.g. dxf, svg, csg). */
  exportFormat(src: PreparedSource, format: string, params?: Params): Promise<ExportResult>;
  /** Parse and evaluate without generating geometry. */
  validate(src: PreparedSource, params?: Params): Promise<{ ok: boolean; log: EngineLog }>;
  version(): Promise<string>;
  /** Extra details for get_version (paths, backend, …). */
  describe(): Promise<Record<string, string>>;
  dispose(): Promise<void>;
}
