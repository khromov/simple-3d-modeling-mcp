/**
 * MCP server: tool definitions and wiring between the engine, the model
 * cache, the preview renderer and the browser viewer.
 */

import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { platform } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { McpServer, type CallToolResult } from "tmcp";
import { JsonSchemaAdapter } from "tmcp/adapter";
import { z } from "zod";
import { OPENSCAD_CHEATSHEET, SERVER_INSTRUCTIONS } from "./cheatsheet.js";
import { formatLog } from "./engine/output.js";
import { paramAssignments } from "./engine/params.js";
import { expandHome, prepareSource, resolveScadPath } from "./engine/source.js";
import type { Engine, EngineLog, Params, PreparedSource } from "./engine/types.js";
import { UserError } from "./errors.js";
import { formatStats } from "./geometry/stats.js";
import { write3mf, writeBinaryStl, writeObj, writeOff } from "./geometry/writers.js";
import { ModelService, type Model } from "./model-service.js";
import { bundledLibraries, bundledLibraryVersion, PACKAGE_NAME, PACKAGE_VERSION } from "./paths.js";
import { parseView, resolvePreset, VIEW_HELP, VIEW_NAMES, type PresetView } from "./rendering/camera.js";
import { renderMultiView, renderTurntable } from "./rendering/previews.js";
import { renderMeshPng } from "./rendering/software-renderer.js";
import { ViewerServer } from "./viewer/index.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CreateServerOptions {
  engine: Engine;
  /** Default folder for exports and relative save paths. */
  outputDir: string;
  /** Open the browser viewer automatically on the first render (default true). */
  autoOpenViewer?: boolean;
  viewer?: ViewerServer;
  /** Opens a URL in the user's browser (overridable for tests). */
  openUrl?: (url: string) => void;
  /** Notes about configuration shown by get_version. */
  notes?: string[];
}

export type AppMcpServer = McpServer<z.ZodType>;

export interface AppServer {
  server: AppMcpServer;
  viewer: ViewerServer;
  close(): Promise<void>;
}

export function openInBrowser(url: string): void {
  const os = platform();
  const [cmd, args] =
    os === "darwin" ? ["open", [url]] : os === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  execFile(cmd as string, args as string[], () => {
    // Opening a browser is best-effort (e.g. headless machines).
  });
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const MESH_FORMATS = ["stl", "3mf", "obj", "off"] as const;
const EXPORT_FORMATS = [...MESH_FORMATS, "dxf", "svg", "csg"] as const;
const MIME: Record<string, string> = {
  stl: "model/stl",
  "3mf": "model/3mf",
  obj: "model/obj",
  off: "text/plain",
  dxf: "image/vnd.dxf",
  svg: "image/svg+xml",
  csg: "text/plain",
};
/**
 * Largest binary payload (image or embedded file) returned inline. tmcp checks
 * every result's base64 with a regex that overflows V8's stack at about 3.2 MiB
 * of data, which would turn the result into a JSON-RPC error.
 */
export const MAX_INLINE_BYTES = 2 * 1024 * 1024;
const MAX_INLINE_MB = MAX_INLINE_BYTES / 1024 / 1024;

const scalar = z.union([z.string(), z.number(), z.boolean()]);
const paramsSchema = z
  .record(z.string(), z.union([scalar, z.array(z.union([scalar, z.array(z.number())]))]))
  .optional()
  .describe('Variable overrides (like OpenSCAD -D), e.g. {"width": 40, "label": "A", "size": [10, 20, 5]}');

const sourceShape = {
  code: z.string().optional().describe("OpenSCAD source code. Provide this or `file`."),
  file: z
    .string()
    .optional()
    .describe("Absolute path to a .scad file to use instead of `code`. Relative include/use/import paths resolve from its folder."),
};

const titleSchema = z.string().max(80).optional().describe("Short name for this version, shown in the viewer history (e.g. \"phone stand v2\")");

const viewEnum = z.enum(["front", "back", "right", "left", "top", "bottom", "perspective", "iso"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ToolResult = CallToolResult<undefined>;
type Content = NonNullable<ToolResult["content"]>[number];

function text(t: string): Content {
  return { type: "text", text: t };
}

function image(png: Uint8Array): Content {
  return { type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" };
}

function errorResult(message: string): ToolResult {
  return { content: [text(message)], isError: true };
}

type JsonSchema = Awaited<ReturnType<JsonSchemaAdapter<z.ZodType>["toJsonSchema"]>>;

/**
 * zod → JSON Schema for tool inputs. `io: "input"` describes what a tool
 * accepts: objects get no `additionalProperties: false` (unknown keys are
 * stripped, not rejected), matching the schemas the MCP SDK used to send.
 */
class ZodInputSchemaAdapter extends JsonSchemaAdapter<z.ZodType> {
  override async toJsonSchema(schema: z.ZodType): Promise<JsonSchema> {
    return z.toJSONSchema(schema, { target: "draft-7", io: "input" }) as JsonSchema;
  }
}

/** Turns a result whose image or embedded file is too big to send inline into an isError result. */
export function enforceInlineLimit(result: ToolResult): ToolResult {
  for (const item of result.content ?? []) {
    const base64 =
      item.type === "image" ? item.data
      : item.type === "resource" && "blob" in item.resource ? item.resource.blob
      : undefined;
    if (base64 === undefined) continue;
    const bytes = Math.floor((base64.length * 3) / 4);
    if (bytes <= MAX_INLINE_BYTES) continue;
    const advice =
      item.type === "image" ? "Use a smaller width/height (or fewer frames for render_turntable)." : "Export without embed and use the file on disk.";
    return errorResult(
      `The ${item.type === "image" ? "image" : "embedded file"} is ${(bytes / 1024 / 1024).toFixed(1)} MB, over the ${MAX_INLINE_MB} MB limit for inline results. ${advice}`,
    );
  }
  return result;
}

function hintsFor(log: EngineLog): string[] {
  const all = [...log.errors, ...log.warnings].join("\n");
  const hints: string[] = [];
  if (/top level object is empty/i.test(all)) {
    hints.push("The model produced no geometry — e.g. difference() removed everything, every object is disabled with *, or a module is defined but never called.");
  }
  if (/parser error/i.test(all)) hints.push("Check for a missing semicolon, bracket or comma at or just before that line.");
  if (/can't (open|find) (include|library|import)|can't open file/i.test(all)) {
    hints.push(`Relative paths only resolve when rendering with \`file\`. Bundled libraries: ${bundledLibraries().join(", ") || "none"} (e.g. include <BOSL2/std.scad>).`);
  }
  if (/timed out/i.test(all)) hints.push("Simplify the model or lower $fn; minkowski() and high $fn are common culprits.");
  return hints;
}

function failure(header: string, log: EngineLog): ToolResult {
  const body = formatLog(log) || "OpenSCAD reported no details.";
  const hints = hintsFor(log);
  return errorResult(`${header}\n\n${body}${hints.length ? `\n\nHint: ${hints.join("\nHint: ")}` : ""}`);
}

function defaultTitle(src: PreparedSource): string {
  if (src.path) return basename(src.path, extname(src.path));
  const first = src.code.trimStart().match(/^\/\/\s*(.+)/);
  return first ? first[1].trim().slice(0, 60) : "Model";
}

function summary(model: Model, cached: boolean, extra: string[] = []): string {
  const timing = cached ? "cached (no re-evaluation)" : `evaluated in ${(model.timeMs / 1000).toFixed(2)}s`;
  const parts = [formatStats(model.stats, { is2D: model.is2D }), `Geometry ${timing}.`];
  const log = formatLog({ errors: [], warnings: model.log.warnings, echo: model.log.echo });
  if (log) parts.push(log);
  parts.push(...extra.filter(Boolean));
  return parts.join("\n\n");
}

function uniquePath(path: string): string {
  if (!existsSync(path)) return path;
  const ext = extname(path);
  const stem = path.slice(0, path.length - ext.length);
  for (let i = 1; i < 10_000; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (!existsSync(candidate)) return candidate;
  }
  throw new UserError(`Could not find a free file name for ${path}`);
}

function sanitizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9 _.-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "model";
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export function createServer(opts: CreateServerOptions): AppServer {
  const server: AppMcpServer = new McpServer(
    { name: "sketchpad-3d-model-mcp", version: PACKAGE_VERSION },
    {
      adapter: new ZodInputSchemaAdapter(),
      capabilities: { tools: { listChanged: true }, resources: { listChanged: true } },
      instructions: SERVER_INSTRUCTIONS,
    },
  );
  const viewer = opts.viewer ?? new ViewerServer();
  const openUrl = opts.openUrl ?? openInBrowser;
  const autoOpen = opts.autoOpenViewer ?? true;
  const engine = opts.engine;
  const models = new ModelService(engine);
  let browserOpened = false;

  /** Wraps a handler: user errors and oversized payloads become isError results instead of protocol errors. */
  const handle =
    <A extends unknown[]>(fn: (...args: A) => Promise<ToolResult>) =>
    async (...args: A): Promise<ToolResult> => {
      try {
        return enforceInlineLimit(await fn(...args));
      } catch (e) {
        if (e instanceof UserError) return errorResult(e.message);
        return errorResult(`Internal error: ${(e as Error).message ?? e}`);
      }
    };

  async function loadModel(args: { code?: string; file?: string }, params?: Params) {
    const src = prepareSource(args);
    const outcome = await models.getModel(src, params);
    return { src, outcome };
  }

  async function publish(model: Model, src: PreparedSource, title?: string, params?: Params): Promise<string | undefined> {
    try {
      if (!viewer.isRunning) await viewer.start();
      const overrides = paramAssignments(params);
      const source = { code: src.code, file: src.path ? basename(src.path) : undefined, params: overrides.length ? overrides : undefined };
      viewer.pushModel({ mesh: model.mesh, stats: model.stats, is2D: model.is2D, title: title?.trim() || defaultTitle(src), key: model.key, source });
      if (autoOpen && !browserOpened && viewer.url) {
        browserOpened = true;
        openUrl(viewer.url);
      }
      return viewer.url ?? undefined;
    } catch {
      return undefined; // the viewer is a convenience; never fail a render because of it
    }
  }

  // -- Resources ------------------------------------------------------------

  server.resource(
    {
      name: "cheatsheet",
      uri: "openscad://cheatsheet",
      title: "OpenSCAD cheatsheet",
      description: "OpenSCAD language quick reference and modelling tips",
      mimeType: "text/markdown",
    },
    async (uri) => ({ contents: [{ uri, text: OPENSCAD_CHEATSHEET, mimeType: "text/markdown" }] }),
  );

  // -- render -----------------------------------------------------------------

  server.tool(
    {
      name: "render",
      title: "Render preview",
      description:
        "Render OpenSCAD code (or a .scad file) to a PNG preview. Returns the image plus the model's size, bounds, volume, echo() output and warnings. Also updates the live 3D viewer.",
      schema: z.object({
        ...sourceShape,
        view: z.string().optional().describe(`Camera: ${VIEW_HELP}. Default: iso.`),
        projection: z.enum(["perspective", "orthographic"]).optional().describe("Default perspective; orthographic is better for checking alignment."),
        width: z.number().int().min(64).max(2048).optional().describe("Image width in pixels (default 1024)"),
        height: z.number().int().min(64).max(2048).optional().describe("Image height in pixels (default 768)"),
        params: paramsSchema,
        title: titleSchema,
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    handle(async (args) => {
      const camera = parseView(args.view);
      const { src, outcome } = await loadModel(args, args.params);
      if (!outcome.ok) return failure("Render failed.", outcome.log);
      const { model } = outcome;
      const viewerUrl = await publish(model, src, args.title, args.params);
      const png = renderMeshPng(model.mesh, {
        camera,
        projection: args.projection ?? "perspective",
        width: args.width ?? 1024,
        height: args.height ?? 768,
      });
      return {
        content: [
          image(png),
          text(summary(model, outcome.cached, [viewerUrl ? `Interactive viewer: ${viewerUrl}` : ""])),
        ],
      };
    }),
  );

  // -- render_multiview -------------------------------------------------------

  server.tool(
    {
      name: "render_multiview",
      title: "Render multiple views",
      description:
        "Render several labelled views in one image (default: front, right, top in orthographic projection + a perspective view). Best way to check proportions and alignment. Also returns size/bounds.",
      schema: z.object({
        ...sourceShape,
        views: z.array(viewEnum).min(1).max(6).optional().describe(`Views to include (default front, right, top, perspective). Options: ${VIEW_NAMES.join(", ")}, iso`),
        projection: z.enum(["auto", "perspective", "orthographic"]).optional().describe("auto (default): orthographic for front/back/left/right/top/bottom, perspective for the 3D view"),
        width: z.number().int().min(128).max(1024).optional().describe("Width of each cell in pixels (default 512)"),
        height: z.number().int().min(128).max(1024).optional().describe("Height of each cell in pixels (default 512)"),
        params: paramsSchema,
        title: titleSchema,
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    handle(async (args) => {
      const views = (args.views ?? ["front", "right", "top", "perspective"]).map((v) => resolvePreset(v) as PresetView);
      const { src, outcome } = await loadModel(args, args.params);
      if (!outcome.ok) return failure("Multi-view render failed.", outcome.log);
      const { model } = outcome;
      const viewerUrl = await publish(model, src, args.title, args.params);
      const result = renderMultiView(model.mesh, {
        views,
        cellWidth: args.width ?? 512,
        cellHeight: args.height ?? 512,
        projection: args.projection ?? "auto",
      });
      return {
        content: [
          image(result.png),
          text(summary(model, outcome.cached, [`Layout: ${result.layout}`, viewerUrl ? `Interactive viewer: ${viewerUrl}` : ""])),
        ],
      };
    }),
  );

  // -- render_turntable -------------------------------------------------------

  server.tool(
    {
      name: "render_turntable",
      title: "Render turntable animation",
      description:
        "Render a 360° turntable animation (animated PNG) for the user to look at. Note: you may only see the first frame yourself — use render_multiview to inspect the geometry.",
      schema: z.object({
        ...sourceShape,
        frames: z.number().int().min(4).max(72).optional().describe("Number of frames (default 24)"),
        width: z.number().int().min(128).max(1024).optional().describe("Image width (default 512)"),
        height: z.number().int().min(128).max(1024).optional().describe("Image height (default 512)"),
        elevation: z
          .number()
          .min(0)
          .max(180)
          .optional()
          .describe("Camera tilt from the top view in degrees: 0 looks straight down, 90 from the side, over 90 from below (default 55)"),
        params: paramsSchema,
        title: titleSchema,
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    handle(async (args) => {
      const { src, outcome } = await loadModel(args, args.params);
      if (!outcome.ok) return failure("Turntable render failed.", outcome.log);
      const { model } = outcome;
      const viewerUrl = await publish(model, src, args.title, args.params);
      const apng = renderTurntable(model.mesh, {
        frames: args.frames ?? 24,
        width: args.width ?? 512,
        height: args.height ?? 512,
        elevation: args.elevation ?? 55,
      });
      return {
        content: [image(apng), text(summary(model, outcome.cached, [viewerUrl ? `Interactive viewer: ${viewerUrl}` : ""]))],
      };
    }),
  );

  // -- export -----------------------------------------------------------------

  server.tool(
    {
      name: "export",
      title: "Export model file",
      description:
        "Export the model to a file on disk (STL, 3MF with colours, OBJ, OFF; DXF/SVG for 2D designs). Writes to `path`, or to the default output folder, and never overwrites unless overwrite=true.",
      schema: z.object({
        ...sourceShape,
        format: z.enum(EXPORT_FORMATS).optional().describe("File format (default: taken from `path`'s extension, else stl). 3mf keeps color() colours."),
        path: z
          .string()
          .optional()
          .describe("Output file: absolute path (\"~/\" allowed) or a file name inside the default output folder. Default: <title or model>.<format>"),
        overwrite: z.boolean().optional().describe("Replace an existing file (default false: a numbered name is used instead)"),
        params: paramsSchema,
        title: z.string().max(80).optional().describe("Model name, used for the default file name and 3MF metadata"),
        embed: z.boolean().optional().describe(`Also return the file contents inline (only for files up to ${MAX_INLINE_MB} MB). Default false.`),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    handle(async (args) => {
      const src = prepareSource(args);

      let target = args.path ? expandHome(args.path.trim()) : undefined;
      const pathExt = target ? extname(target).slice(1).toLowerCase() : "";
      const format = (args.format ?? (pathExt || "stl")).toLowerCase();
      if (!(EXPORT_FORMATS as readonly string[]).includes(format)) {
        throw new UserError(`Unsupported format "${format}". Use one of: ${EXPORT_FORMATS.join(", ")}`);
      }
      if (target && pathExt && pathExt !== format) {
        throw new UserError(`The path ends in .${pathExt} but format is ${format}. Make them match.`);
      }
      const name = sanitizeName(args.title ?? defaultTitle(src));
      if (!target) target = join(opts.outputDir, `${name}.${format}`);
      else if (!pathExt) target = `${target}.${format}`;
      if (!isAbsolute(target)) target = join(opts.outputDir, target);
      target = resolve(target);

      let bytes: Uint8Array;
      let model: Model | undefined;
      let log: EngineLog;
      if ((MESH_FORMATS as readonly string[]).includes(format)) {
        const outcome = await models.getModel(src, args.params);
        if (!outcome.ok) return failure("Export failed.", outcome.log);
        model = outcome.model;
        if (model.is2D) {
          throw new UserError(`This is a 2D design. Export it as svg or dxf, or linear_extrude() it to make a 3D ${format.toUpperCase()}.`);
        }
        log = model.log;
        bytes =
          format === "3mf" ? write3mf(model.mesh, { title: args.title ?? defaultTitle(src) })
          : format === "obj" ? writeObj(model.mesh)
          : format === "off" ? writeOff(model.mesh)
          : writeBinaryStl(model.mesh);
      } else {
        if (!engine.capabilities.exportFormats.includes(format)) {
          throw new UserError(`The ${engine.name} engine cannot export ${format}. Supported: ${[...new Set([...MESH_FORMATS, ...engine.capabilities.exportFormats])].join(", ")}`);
        }
        const r = await engine.exportFormat(src, format, args.params);
        if (!r.ok || !r.bytes) return failure("Export failed.", r.log);
        bytes = r.bytes;
        log = r.log;
      }

      if (existsSync(target) && !args.overwrite) target = uniquePath(target);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);

      const size = bytes.length >= 1024 * 1024 ? `${(bytes.length / 1024 / 1024).toFixed(1)} MB` : `${(bytes.length / 1024).toFixed(1)} KB`;
      const lines = [`Exported ${format.toUpperCase()} to ${target} (${size}).`];
      if (model) lines.push(formatStats(model.stats));
      const logText = formatLog({ errors: [], warnings: log.warnings, echo: log.echo });
      if (logText) lines.push(logText);
      const content: Content[] = [
        { type: "resource_link", uri: pathToFileURL(target).href, name: basename(target), mimeType: MIME[format], description: `Exported ${format.toUpperCase()} model` },
      ];
      if (args.embed) {
        if (bytes.length <= MAX_INLINE_BYTES) {
          content.push({ type: "resource", resource: { uri: pathToFileURL(target).href, mimeType: MIME[format], blob: Buffer.from(bytes).toString("base64") } });
        } else {
          lines.push(`(Not embedded: larger than ${MAX_INLINE_MB} MB.)`);
        }
      }
      content.push(text(lines.join("\n\n")));
      return { content };
    }),
  );

  // -- validate ---------------------------------------------------------------

  server.tool(
    {
      name: "validate",
      title: "Validate code",
      description: "Parse and evaluate OpenSCAD code without building geometry. Fast check for syntax errors, failed assert()s, unknown variables/modules, and echo() output.",
      schema: z.object({ ...sourceShape, params: paramsSchema }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    handle(async (args) => {
      const src = prepareSource(args);
      const r = await engine.validate(src, args.params);
      if (!r.ok) return failure("Validation found errors.", r.log);
      const detail = formatLog(r.log);
      return { content: [text(`Code is valid — no errors.${detail ? `\n\n${detail}` : ""}`)] };
    }),
  );

  // -- open_viewer ------------------------------------------------------------

  server.tool(
    {
      name: "open_viewer",
      title: "Open 3D viewer",
      description: "Open the interactive 3D viewer in the user's browser (rotate/zoom/pan, history, dimensions, STL/3MF download, open in slicer). It updates automatically on every render.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    handle(async () => {
      const url = await viewer.start();
      browserOpened = true;
      openUrl(url);
      return {
        content: [text(`Interactive 3D viewer: ${url}\n\nControls: drag to rotate, scroll to zoom, right-drag to pan. It updates automatically on each render.`)],
      };
    }),
  );

  // -- cheatsheet -------------------------------------------------------------

  server.tool(
    {
      name: "cheatsheet",
      title: "OpenSCAD cheatsheet",
      description: "OpenSCAD language quick reference: primitives, transformations, BOSL2 basics and modelling tips.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => ({ content: [text(OPENSCAD_CHEATSHEET)] }),
  );

  // -- list_libraries ---------------------------------------------------------

  server.tool(
    {
      name: "list_libraries",
      title: "List OpenSCAD libraries",
      description: "List the OpenSCAD libraries available to models (bundled BOSL2).",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    handle(async () => {
      const lines: string[] = [];
      const bundled = bundledLibraries();
      if (bundled.length) {
        lines.push("## Bundled (always available)");
        for (const lib of bundled) {
          lines.push(`- ${lib} ${bundledLibraryVersion(lib) ?? ""} — include <${lib}/std.scad>`.replace("  ", " "));
        }
      }
      lines.push("", "For other libraries, render a .scad file with `file` and include them by relative path.");
      return { content: [text(lines.join("\n"))] };
    }),
  );

  // -- get_version ------------------------------------------------------------

  server.tool(
    {
      name: "get_version",
      title: "Engine info",
      description: "Show the OpenSCAD engine (bundled WASM), its version, backend, bundled libraries and server settings.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    handle(async () => {
      const info = await engine.describe();
      const rows = Object.entries({
        Server: `${PACKAGE_NAME} ${PACKAGE_VERSION}`,
        ...info,
        "Export folder": opts.outputDir,
        Viewer: viewer.url ?? (autoOpen ? "opens on first render" : "starts on first render (auto-open disabled)"),
      });
      const notes = opts.notes?.length ? `\n\nNotes:\n${opts.notes.map((n) => `- ${n}`).join("\n")}` : "";
      return { content: [text(rows.map(([k, v]) => `${k}: ${v}`).join("\n") + notes)] };
    }),
  );

  // -- read_scad_file / save_scad_file ----------------------------------------

  server.tool(
    {
      name: "read_scad_file",
      title: "Read .scad file",
      description: "Read an OpenSCAD (.scad) file from disk.",
      schema: z.object({ path: z.string().describe("Absolute path to the .scad file (\"~/\" allowed)") }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    handle(async ({ path }) => {
      const full = resolveScadPath(path);
      let size: number;
      try {
        size = statSync(full).size;
      } catch {
        throw new UserError(`File not found: ${full}`);
      }
      if (size > 2 * 1024 * 1024) throw new UserError(`${full} is too large to read (${size} bytes).`);
      return { content: [text(await readFile(full, "utf8"))] };
    }),
  );

  server.tool(
    {
      name: "save_scad_file",
      title: "Save .scad file",
      description:
        "Save OpenSCAD source to a .scad file so the user keeps an editable copy. Relative paths go into the default output folder. Refuses to replace an existing file unless overwrite=true.",
      schema: z.object({
        path: z.string().describe("Destination .scad path: absolute (\"~/\" allowed) or a file name inside the default output folder"),
        code: z.string().describe("OpenSCAD source code to save"),
        overwrite: z.boolean().optional().describe("Replace the file if it exists (default false)"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    handle(async ({ path, code, overwrite }) => {
      let target = expandHome(path.trim());
      if (!isAbsolute(target)) target = join(opts.outputDir, target);
      if (extname(target).toLowerCase() !== ".scad") throw new UserError("The path must end in .scad");
      target = resolve(target);
      if (existsSync(target) && !overwrite) {
        throw new UserError(`${target} already exists. Pass overwrite: true to replace it, or choose another name.`);
      }
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, code, "utf8");
      return { content: [text(`Saved ${Buffer.byteLength(code)} bytes to ${target}. Render it with file: "${target}".`)] };
    }),
  );

  return {
    server,
    viewer,
    async close() {
      await viewer.stop();
      await engine.dispose();
    },
  };
}
