import { findOpenScadCandidates, NativeEngine, probeOpenScad } from "./native-engine.js";
import { WasmEngine } from "./wasm-engine.js";
import type { Engine } from "./types.js";

export type EngineMode = "auto" | "wasm" | "native";

export interface CreateEngineOptions {
  /**
   * auto (default): use native OpenSCAD when OPENSCAD_PATH is set, or when a
   * Manifold-capable OpenSCAD is installed; otherwise the bundled WASM engine.
   * wasm: always use the bundled engine. native: prefer any installed OpenSCAD.
   */
  mode?: EngineMode;
  /** Explicit OpenSCAD binary (OPENSCAD_PATH). */
  executablePath?: string;
  /** Temp directory for the native engine. */
  workDir?: string;
  timeoutMs?: number;
  /** Override auto-detection candidates (tests). */
  candidates?: string[];
  /** Diagnostics sink (stderr in production). */
  log?: (message: string) => void;
}

export async function createEngine(opts: CreateEngineOptions = {}): Promise<Engine> {
  const mode = opts.mode ?? "auto";
  const log = opts.log ?? (() => {});
  const wasm = (note?: string) => {
    if (note) log(note);
    return new WasmEngine({ timeoutMs: opts.timeoutMs });
  };
  const native = { workDir: opts.workDir, timeoutMs: opts.timeoutMs };

  if (mode === "wasm") return wasm();

  if (opts.executablePath) {
    try {
      const engine = await NativeEngine.create(opts.executablePath, native);
      engine.selectionNote = "OPENSCAD_PATH";
      return engine;
    } catch (e) {
      return wasm(`OPENSCAD_PATH is not usable (${(e as Error).message}); using the bundled WASM engine instead.`);
    }
  }

  let fallback: string | undefined;
  for (const candidate of opts.candidates ?? findOpenScadCandidates()) {
    try {
      const probe = await probeOpenScad(candidate);
      if (probe.manifold || mode === "native") {
        const engine = new NativeEngine(probe, native);
        engine.selectionNote = mode === "native" ? "OPENSCAD_ENGINE=native" : "auto-detected (Manifold-capable)";
        return engine;
      }
      fallback ??= `Found ${candidate} (${probe.version}) but it lacks the Manifold backend; the bundled WASM engine is faster. Set OPENSCAD_PATH to use it anyway.`;
    } catch {
      // not usable, try the next one
    }
  }
  if (mode === "native") return wasm("OPENSCAD_ENGINE=native but no working OpenSCAD was found; using the bundled WASM engine.");
  return wasm(fallback);
}
