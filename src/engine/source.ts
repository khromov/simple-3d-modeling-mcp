/**
 * Turns tool input (inline code or a .scad path) into a PreparedSource,
 * collecting the files it references so the WASM engine can mirror them into
 * its virtual filesystem and so cache keys change when a dependency changes.
 */

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { UserError } from "../errors.js";
import type { PreparedSource, SourceFile } from "./types.js";

const MAX_MAIN_BYTES = 8 * 1024 * 1024;
const MAX_DEP_FILES = 500;
const MAX_DEP_BYTES = 64 * 1024 * 1024;

export interface SourceInput {
  code?: string;
  file?: string;
}

export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(homedir(), p.slice(2));
  return p;
}

/** Resolve a user-supplied .scad path; must be absolute (or ~-relative). */
export function resolveScadPath(file: string): string {
  const expanded = expandHome(file.trim());
  if (!isAbsolute(expanded)) {
    throw new UserError(`"${file}" is not an absolute path. Pass the full path to the .scad file.`);
  }
  if (extname(expanded).toLowerCase() !== ".scad") {
    throw new UserError(`"${file}" is not a .scad file.`);
  }
  return resolve(expanded);
}

export function prepareSource(input: SourceInput): PreparedSource {
  const hasCode = typeof input.code === "string" && input.code.trim().length > 0;
  const hasFile = typeof input.file === "string" && input.file.trim().length > 0;
  if (hasCode && hasFile) throw new UserError("Provide either `code` or `file`, not both.");
  if (!hasCode && !hasFile) throw new UserError("Provide OpenSCAD source via `code`, or a .scad path via `file`.");

  let code: string;
  let path: string | undefined;
  if (hasFile) {
    path = resolveScadPath(input.file!);
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      throw new UserError(`File not found: ${path}`);
    }
    if (size > MAX_MAIN_BYTES) throw new UserError(`${path} is too large (${size} bytes).`);
    code = readFileSync(path, "utf8");
  } else {
    code = input.code!;
  }

  const deps = collectDependencies(code, path);
  const hash = createHash("sha256");
  hash.update(path ?? "<inline>").update("\0").update(code);
  for (const d of deps) hash.update("\0").update(d.path).update("\0").update(d.data);
  return { code, path, deps, hash: hash.digest("hex") };
}

const INCLUDE_RE = /\b(?:include|use)\s*<([^>\n]+)>/g;
const FILE_ARG_RE = /\b(?:import|surface)\s*\(\s*(?:file\s*=\s*)?"([^"\n]+)"/g;

/**
 * Finds files referenced by include/use/import/surface, resolving relative
 * paths against the referencing file's folder. Library references that do
 * not exist next to the file (e.g. <BOSL2/std.scad>) are left to OpenSCAD's
 * library search path.
 */
export function collectDependencies(code: string, mainPath?: string): SourceFile[] {
  const out: SourceFile[] = [];
  const seen = new Set<string>(mainPath ? [mainPath] : []);
  let total = 0;

  const visit = (text: string, fromDir: string | undefined) => {
    const refs: Array<{ ref: string; scad: boolean }> = [];
    for (const m of text.matchAll(INCLUDE_RE)) refs.push({ ref: m[1].trim(), scad: true });
    for (const m of text.matchAll(FILE_ARG_RE)) refs.push({ ref: m[1].trim(), scad: false });

    for (const { ref, scad } of refs) {
      const expanded = expandHome(ref);
      let full: string;
      if (isAbsolute(expanded)) full = resolve(expanded);
      else if (fromDir) full = resolve(fromDir, expanded);
      else continue;
      if (seen.has(full)) continue;
      seen.add(full);

      let size: number;
      try {
        const st = statSync(full);
        if (!st.isFile()) continue;
        size = st.size;
      } catch {
        continue;
      }
      if (out.length >= MAX_DEP_FILES || total + size > MAX_DEP_BYTES) {
        throw new UserError(`Too many or too large referenced files (limit ${MAX_DEP_FILES} files / ${MAX_DEP_BYTES >> 20} MB).`);
      }
      const data = readFileSync(full);
      total += size;
      out.push({ path: full, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) });
      if (scad || full.toLowerCase().endsWith(".scad")) visit(data.toString("utf8"), dirname(full));
    }
  };

  visit(code, mainPath ? dirname(mainPath) : undefined);
  return out;
}
