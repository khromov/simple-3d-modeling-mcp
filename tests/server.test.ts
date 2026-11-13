import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryTransport, type Session } from "@tmcp/transport-in-memory";
import type { CallToolResult, InitializeResult } from "tmcp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WasmEngine } from "../src/engine/wasm-engine.js";
import { decodePng } from "../src/rendering/png.js";
import { createServer, enforceInlineLimit, MAX_INLINE_BYTES, type AppServer } from "../src/server.js";

type Result = CallToolResult<undefined>;
const contentOf = (r: Result) => r.content ?? [];
const textOf = (r: Result) => contentOf(r).filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("\n");
const imageOf = (r: Result) => {
  const img = contentOf(r).find((c) => c.type === "image") as { data: string } | undefined;
  return img ? Buffer.from(img.data, "base64") : undefined;
};

/** Connects an in-memory MCP client session to the server and runs the initialize handshake. */
async function connect(app: AppServer) {
  const transport = new InMemoryTransport(app.server);
  const session = transport.session();
  const init = await session.initialize("2025-06-18", {}, { name: "test", version: "0" });
  return { transport, session, init };
}

describe("MCP server", () => {
  const outDir = mkdtempSync(join(tmpdir(), "s3d-server-"));
  const opened: string[] = [];
  let app: AppServer;
  let transport: InMemoryTransport;
  let session: Session;
  let init: InitializeResult;

  /** The in-memory client resolves JSON-RPC errors to undefined; tool calls must never produce one. */
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await session.callTool(name, args);
    if (!result) throw new Error(`tools/call ${name} returned a JSON-RPC error instead of a result`);
    return result;
  };

  beforeAll(async () => {
    app = createServer({ engine: new WasmEngine(), outputDir: outDir, openUrl: (u) => opened.push(u) });
    ({ transport, session, init } = await connect(app));
  });

  afterAll(async () => {
    session.close();
    await transport.close();
    await app.close();
    rmSync(outDir, { recursive: true, force: true });
  });

  it("lists tools with titles and annotations, and provides instructions", async () => {
    const { tools } = await session.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual(
      ["cheatsheet", "export", "get_version", "list_libraries", "open_viewer", "read_scad_file", "render", "render_multiview", "render_turntable", "save_scad_file", "validate"].sort(),
    );
    expect(byName.render.title).toBe("Render preview");
    expect(byName.render.annotations?.readOnlyHint).toBe(true);
    expect(byName.export.annotations?.readOnlyHint).toBe(false);
    expect(byName.render.inputSchema.properties).toHaveProperty("file");
    expect(byName.get_version.inputSchema).toMatchObject({ type: "object", properties: {} });
    // Input-side schemas, as the MCP SDK sent them: unknown keys are stripped, not rejected.
    expect(byName.render.inputSchema).toMatchObject({ $schema: "http://json-schema.org/draft-07/schema#", type: "object" });
    expect(byName.render.inputSchema).not.toHaveProperty("additionalProperties");
    expect(init.capabilities).toMatchObject({ tools: {}, resources: {} });
    expect(init.instructions).toMatch(/OpenSCAD/);
  });

  it("serves the cheatsheet as a markdown resource", async () => {
    const { resources } = await session.listResources();
    expect(resources).toEqual([expect.objectContaining({ uri: "openscad://cheatsheet", name: "cheatsheet", mimeType: "text/markdown" })]);
    const { contents } = await session.readResource("openscad://cheatsheet");
    expect(contents[0]).toMatchObject({ uri: "openscad://cheatsheet", mimeType: "text/markdown" });
    expect((contents[0] as { text: string }).text).toContain("BOSL2");
  });

  it("render returns an image, dimensions and echo output, and opens the viewer once", async () => {
    const r = await call("render", { code: '// Test block\necho("w", 40);\ncube([40, 20, 10]);', width: 320, height: 240 });
    expect(r.isError).toBeFalsy();
    expect(decodePng(imageOf(r)!).width).toBe(320);
    const t = textOf(r);
    expect(t).toContain("Size: 40 × 20 × 10 mm");
    expect(t).toContain('"w", 40');
    expect(t).toMatch(/Interactive viewer: http:\/\/localhost:\d+/);
    expect(app.viewer.state.latest?.title).toBe("Test block");
    expect(app.viewer.state.latest?.source).toEqual({ code: '// Test block\necho("w", 40);\ncube([40, 20, 10]);' });

    await call("render", { code: "cube(3);", width: 64, height: 64 });
    expect(opened).toHaveLength(1);
  });

  it("re-renders cached geometry without re-evaluating", async () => {
    const code = "sphere(5, $fn = 24);";
    await call("render", { code, width: 64, height: 64 });
    const again = await call("render", { code, width: 64, height: 64, view: "top" });
    expect(textOf(again)).toContain("cached (no re-evaluation)");
  });

  it("returns OpenSCAD's real error message with a hint", async () => {
    const syntax = await call("render", { code: "cube([10, 10, 10);" });
    expect(syntax.isError).toBe(true);
    expect(textOf(syntax)).toMatch(/Parser error: syntax error in file input\.scad, line 1/);
    expect(textOf(syntax)).toMatch(/Hint: Check for a missing semicolon/);
    const empty = await call("render", { code: "difference() { cube(5); cube(10); }" });
    expect(textOf(empty)).toMatch(/top level object is empty[\s\S]*Hint: The model produced no geometry/);
  });

  it("hints at bundled libraries when an include is missing", async () => {
    const r = await call("render", { code: "include <MCAD/boxes.scad>\nroundedBox([10, 10, 10], 2, true);" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/Can't find include file 'MCAD\/boxes\.scad'[\s\S]*Hint: Relative paths only resolve when rendering with `file`\. Bundled libraries: BOSL2/);
  });

  it("reports bad parameter names as input errors", async () => {
    const r = await call("render", { code: "cube(1);", params: { "bad-name": 1 } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toBe('Invalid parameter name "bad-name" (must be an OpenSCAD identifier)');
  });

  it("validates inputs", async () => {
    expect(textOf(await call("render", { code: "cube(1);", view: "sideways" }))).toMatch(/Invalid view/);
    expect(textOf(await call("render", {}))).toMatch(/Provide OpenSCAD source/);
    const tooBig = await call("render", { code: "cube(1);", width: 100000 });
    expect(tooBig.isError).toBe(true);
  });

  it("render_multiview returns a labelled grid and its layout", async () => {
    const r = await call("render_multiview", { code: "cube([10, 20, 30]);", width: 128, height: 128 });
    expect(decodePng(imageOf(r)!).width).toBe(258);
    expect(textOf(r)).toContain("Layout: row 1 col 1: front (ortho)");
    const two = await call("render_multiview", { code: "cube(1);", views: ["iso", "bottom"], width: 128, height: 128 });
    expect(textOf(two)).toContain("perspective; row 1 col 2: bottom (ortho)");
  });

  it("render_turntable returns an animated PNG", async () => {
    const r = await call("render_turntable", { code: "cube(5);", frames: 4, width: 128, height: 128 });
    expect(imageOf(r)!.includes(Buffer.from("acTL"))).toBe(true);
  });

  it("render_turntable views from below, and rejects negative elevations", async () => {
    const small = { code: "cube(5);", frames: 4, width: 128, height: 128 };
    expect((await call("render_turntable", { ...small, elevation: 125 })).isError).toBeFalsy();
    expect((await call("render_turntable", { ...small, elevation: -55 })).isError).toBe(true);
  });

  it("rejects cameras without a direction", async () => {
    const r = await call("render", { code: "cube(1);", view: "1,1,1,1,1,1" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/the eye and the center are the same point/);
  });

  it("exports to the output folder without overwriting", async () => {
    const code = 'color("red") cube(10);';
    const a = await call("export", { code, format: "3mf", title: "Red cube" });
    expect(a.isError).toBeFalsy();
    const first = join(outDir, "Red-cube.3mf");
    expect(existsSync(first)).toBe(true);
    expect(textOf(a)).toContain(first);
    expect(contentOf(a).find((c) => c.type === "resource_link")).toMatchObject({ name: "Red-cube.3mf", mimeType: "model/3mf" });

    await call("export", { code, format: "3mf", title: "Red cube" });
    expect(existsSync(join(outDir, "Red-cube-1.3mf"))).toBe(true);

    await call("export", { code, path: "Red-cube.3mf", overwrite: true });
    expect(existsSync(join(outDir, "Red-cube-2.3mf"))).toBe(false);
  });

  it("infers the format from the path and rejects mismatches", async () => {
    const target = join(outDir, "nested", "part.stl");
    const r = await call("export", { code: "cube(2);", path: target });
    expect(r.isError).toBeFalsy();
    expect(readFileSync(target).length).toBe(84 + 12 * 50); // binary STL
    expect(textOf(await call("export", { code: "cube(1);", path: "x.3mf", format: "stl" }))).toMatch(/Make them match/);
  });

  it("embeds small files only on request", async () => {
    const r = await call("export", { code: "cube(1);", format: "stl", embed: true, title: "embedded" });
    const res = contentOf(r).find((c) => c.type === "resource") as { resource: { blob: string } };
    expect(Buffer.from(res.resource.blob, "base64").length).toBe(84 + 12 * 50);
  });

  it("writes but does not embed files over the inline limit", async () => {
    // ~3.7 MB STL: big enough to overflow tmcp's base64 check if it were embedded.
    const r = await call("export", { code: "sphere(10, $fn = 280);", format: "stl", embed: true, title: "big sphere" });
    expect(r.isError).toBeFalsy();
    expect(contentOf(r).some((c) => c.type === "resource")).toBe(false);
    expect(textOf(r)).toContain(`(Not embedded: larger than ${MAX_INLINE_BYTES / 1024 / 1024} MB.)`);
    expect(readFileSync(join(outDir, "big-sphere.stl")).length).toBeGreaterThan(MAX_INLINE_BYTES);
  });

  it("turns oversized inline images into isError results", () => {
    const png = (bytes: number) => ({ type: "image" as const, data: Buffer.alloc(bytes).toString("base64"), mimeType: "image/png" });
    const small = { content: [png(1024), { type: "text" as const, text: "ok" }] };
    expect(enforceInlineLimit(small)).toBe(small);
    const big = enforceInlineLimit({ content: [png(MAX_INLINE_BYTES + 3), { type: "text" as const, text: "summary" }] });
    expect(big.isError).toBe(true);
    expect(textOf(big)).toMatch(/image is 2\.0 MB, over the 2 MB limit[\s\S]*smaller width\/height/);
  });

  it("exports 2D designs as SVG and refuses mesh formats for them", async () => {
    const svg = await call("export", { code: "square([20, 10]);", format: "svg", title: "plate" });
    expect(readFileSync(join(outDir, "plate.svg"), "utf8")).toContain("<svg");
    expect(svg.isError).toBeFalsy();
    expect(textOf(await call("export", { code: "square([20, 10]);", format: "stl" }))).toMatch(/This is a 2D design/);
  });

  it("saves, reads and renders .scad files with relative includes", async () => {
    const lib = await call("save_scad_file", { path: "proj/parts/lib.scad", code: "module part(s) { cube(s); }\n" });
    expect(lib.isError).toBeFalsy();
    await call("save_scad_file", { path: "proj/main.scad", code: "use <parts/lib.scad>\npart(6);\n" });
    const main = join(outDir, "proj", "main.scad");
    expect(textOf(await call("read_scad_file", { path: main }))).toContain("part(6)");
    expect(textOf(await call("save_scad_file", { path: main, code: "cube(1);" }))).toMatch(/already exists/);
    const r = await call("render", { file: main, width: 64, height: 64 });
    expect(textOf(r)).toContain("Size: 6 × 6 × 6 mm");
    expect(app.viewer.state.latest?.title).toBe("main");
    expect(app.viewer.state.latest?.source).toMatchObject({ code: "use <parts/lib.scad>\npart(6);\n", file: "main.scad" });

    await call("render", { file: main, params: { s: 4 }, width: 64, height: 64 });
    expect(app.viewer.state.latest?.source?.params).toEqual(["s=4"]);
  });

  it("only reads .scad files", async () => {
    writeFileSync(join(outDir, "secret.txt"), "x");
    expect(textOf(await call("read_scad_file", { path: join(outDir, "secret.txt") }))).toMatch(/not a .scad file/);
    expect(textOf(await call("save_scad_file", { path: join(outDir, "x.sh"), code: "rm -rf /" }))).toMatch(/must end in .scad/);
  });

  it("validate reports assert failures and echo output", async () => {
    expect(textOf(await call("validate", { code: 'echo("ok"); cube(1);' }))).toMatch(/Code is valid[\s\S]*"ok"/);
    const bad = await call("validate", { code: 'assert(false, "too thin");' });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatch(/too thin/);
  });

  it("describes the engine and libraries", async () => {
    const v = textOf(await call("get_version"));
    expect(v).toMatch(/Engine: WASM/);
    expect(v).toMatch(/Backend: Manifold/);
    expect(v).toContain(`Export folder: ${outDir}`);
    expect(textOf(await call("list_libraries"))).toMatch(/BOSL2 v2\.\d+\.\d+ — include <BOSL2\/std\.scad>/);
    expect(textOf(await call("cheatsheet"))).toContain("BOSL2");
  });

  it("open_viewer opens the browser explicitly", async () => {
    const before = opened.length;
    const r = await call("open_viewer");
    expect(textOf(r)).toMatch(/http:\/\/localhost:\d+/);
    expect(opened.length).toBe(before + 1);
  });
});

describe("MCP server with auto-open disabled", () => {
  it("never opens the browser on render", async () => {
    const opened: string[] = [];
    const app = createServer({ engine: new WasmEngine(), outputDir: tmpdir(), autoOpenViewer: false, openUrl: (u) => opened.push(u) });
    const { transport, session } = await connect(app);
    const r = await session.callTool("render", { code: "cube(1);", width: 64, height: 64 });
    expect(textOf(r)).toMatch(/Interactive viewer: http/);
    expect(opened).toEqual([]);
    session.close();
    await transport.close();
    await app.close();
  });
});
