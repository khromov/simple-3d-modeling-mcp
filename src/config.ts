/**
 * Environment-based configuration.
 *
 *   OPENSCAD_ENGINE            auto | wasm | native            (default auto)
 *   OPENSCAD_PATH              explicit OpenSCAD binary         (implies native)
 *   OPENSCAD_WORK_DIR          temp directory for native runs
 *   OPENSCAD_TIMEOUT           seconds per OpenSCAD run         (default 120)
 *   OPENSCAD_OUTPUT_DIR        default folder for exports       (default ~/Downloads)
 *   OPENSCAD_AUTO_OPEN_VIEWER  open the browser viewer on first render (default true)
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { EngineMode } from "./engine/engine-factory.js";
import { expandHome } from "./engine/source.js";

export interface ServerConfig {
  engineMode: EngineMode;
  openscadPath?: string;
  workDir?: string;
  timeoutMs: number;
  outputDir: string;
  autoOpenViewer: boolean;
}

/** Treat blank values and unsubstituted placeholders (e.g. "${user_config.x}") as unset. */
function clean(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const v = value.trim();
  if (!v || v.includes("${")) return undefined;
  return v;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  return fallback;
}

export function defaultOutputDir(): string {
  const downloads = join(homedir(), "Downloads");
  return existsSync(downloads) ? downloads : homedir();
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): { config: ServerConfig; warnings: string[] } {
  const warnings: string[] = [];

  let engineMode: EngineMode = "auto";
  const mode = clean(env.OPENSCAD_ENGINE)?.toLowerCase();
  if (mode === "auto" || mode === "wasm" || mode === "native") engineMode = mode;
  else if (mode) warnings.push(`Ignoring OPENSCAD_ENGINE="${mode}" (expected auto, wasm or native).`);

  let timeoutMs = 120_000;
  const timeout = clean(env.OPENSCAD_TIMEOUT);
  if (timeout) {
    const secs = Number(timeout);
    if (Number.isFinite(secs) && secs > 0) timeoutMs = Math.min(3600, Math.max(5, secs)) * 1000;
    else warnings.push(`Ignoring OPENSCAD_TIMEOUT="${timeout}" (expected seconds).`);
  }

  let outputDir = defaultOutputDir();
  const out = clean(env.OPENSCAD_OUTPUT_DIR);
  if (out) {
    const expanded = expandHome(out);
    if (isAbsolute(expanded)) outputDir = resolve(expanded);
    else warnings.push(`Ignoring OPENSCAD_OUTPUT_DIR="${out}" (must be an absolute path).`);
  }

  return {
    config: {
      engineMode,
      openscadPath: clean(env.OPENSCAD_PATH),
      workDir: clean(env.OPENSCAD_WORK_DIR),
      timeoutMs,
      outputDir,
      autoOpenViewer: parseBool(clean(env.OPENSCAD_AUTO_OPEN_VIEWER), true),
    },
    warnings,
  };
}
