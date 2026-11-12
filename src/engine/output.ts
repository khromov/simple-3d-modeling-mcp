/**
 * Classifies OpenSCAD console output into errors / warnings / echo lines.
 */

import type { EngineLog } from "./types.js";

/** Informational lines OpenSCAD prints on every run; never shown to the model. */
const NOISE = [
  /^Could not initialize localization/,
  /^Fontconfig (error|warning)/,
  /^Geometries in cache/,
  /^Geometry cache size/,
  /^CGAL (Polyhedrons in cache|cache size)/,
  /^Total rendering time/,
  /^Top level object is a/,
  /^(Convex|Facets|Vertices|Volumes|Status|Genus|Contours|Simple|Halfedges|Edges|Halffacets):/,
  /^Rendering (finished|Polygon Mesh)/,
  /^(Parsing|Compiling) design/,
  /^Normalized tree/,
  /^Saved backup/,
  /^Can't parse file/,
  /^\[out\]\s*$/,
];

/** Lines that mean the run failed even though they lack "ERROR:". */
const FATAL = [
  /^Current top level object is empty\./,
  /^Current top level object is not a (2D|3D) object\./,
];

export function parseLog(lines: string[]): EngineLog {
  const log: EngineLog = { errors: [], warnings: [], echo: [] };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("ECHO:")) {
      log.echo.push(line.slice(5).trim());
    } else if (/^(ERROR|TRACE):/.test(line) || /parser error/i.test(line)) {
      log.errors.push(line);
    } else if (/^(WARNING|DEPRECATED):/.test(line)) {
      log.warnings.push(line);
    } else if (FATAL.some((re) => re.test(line))) {
      log.errors.push(line);
    } else if (NOISE.some((re) => re.test(line))) {
      continue;
    } else if (/\berror\b/i.test(line)) {
      log.errors.push(line);
    } else if (/\bwarning\b/i.test(line)) {
      log.warnings.push(line);
    }
  }
  return log;
}

/** Replace internal virtual paths in messages with something meaningful. */
export function rewritePaths(log: EngineLog, replacements: Array<[string, string]>): EngineLog {
  if (replacements.length === 0) return log;
  const fix = (s: string) => replacements.reduce((acc, [from, to]) => acc.split(from).join(to), s);
  return { errors: log.errors.map(fix), warnings: log.warnings.map(fix), echo: log.echo.map(fix) };
}

export function emptyLog(): EngineLog {
  return { errors: [], warnings: [], echo: [] };
}

export function mergeLogs(...logs: EngineLog[]): EngineLog {
  const out = emptyLog();
  for (const l of logs) {
    for (const k of ["errors", "warnings", "echo"] as const) {
      for (const line of l[k]) if (!out[k].includes(line)) out[k].push(line);
    }
  }
  return out;
}

/** Human/LLM-readable rendering of a log, used in tool responses. */
export function formatLog(log: EngineLog, opts: { maxLines?: number } = {}): string {
  const max = opts.maxLines ?? 40;
  const sections: string[] = [];
  const add = (title: string, lines: string[]) => {
    if (lines.length === 0) return;
    const shown = lines.slice(0, max);
    const more = lines.length > max ? `\n… ${lines.length - max} more` : "";
    sections.push(`${title}:\n${shown.join("\n")}${more}`);
  };
  add("Errors", log.errors);
  add("Warnings", log.warnings);
  add("ECHO output", log.echo);
  return sections.join("\n\n");
}
