import type { ParamValue, Params } from "./types.js";

const IDENT = /^\$?[A-Za-z_][A-Za-z0-9_]*$/;

function literal(v: ParamValue, name: string): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`Parameter "${name}" must be a finite number`);
    return String(v);
  }
  // JSON string escapes (\" \\ \n \uXXXX) are valid OpenSCAD string escapes.
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => literal(x, name)).join(",")}]`;
  throw new Error(`Parameter "${name}" has an unsupported type`);
}

/** Converts variable overrides into OpenSCAD `-D name=value` arguments. */
export function paramArgs(params: Params | undefined): string[] {
  if (!params) return [];
  const args: string[] = [];
  for (const [name, value] of Object.entries(params)) {
    if (!IDENT.test(name)) throw new Error(`Invalid parameter name "${name}" (must be an OpenSCAD identifier)`);
    args.push("-D", `${name}=${literal(value, name)}`);
  }
  return args;
}

/** Deterministic serialisation for cache keys. */
export function stableParams(params: Params | undefined): string {
  if (!params) return "";
  return JSON.stringify(Object.keys(params).sort().map((k) => [k, params[k]]));
}
