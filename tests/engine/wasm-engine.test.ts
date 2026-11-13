import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareSource } from "../../src/engine/source.js";
import { WasmEngine } from "../../src/engine/wasm-engine.js";
import { computeStats } from "../../src/geometry/stats.js";

const src = (code: string) => prepareSource({ code });

describe("WasmEngine", () => {
  let engine: WasmEngine;
  const dir = mkdtempSync(join(tmpdir(), "s3d-wasm-"));

  beforeAll(() => {
    engine = new WasmEngine();
  });
  afterAll(async () => {
    await engine.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  it("evaluates a model to a mesh with the Manifold backend", async () => {
    const r = await engine.computeMesh(src("cube([10, 20, 30]);"));
    expect(r.ok).toBe(true);
    const s = computeStats(r.mesh!);
    expect(s.size).toEqual([10, 20, 30]);
    expect(s.volume).toBeCloseTo(6000, 1);
  });

  it("keeps color() information", async () => {
    const r = await engine.computeMesh(src('color("red") cube(5); translate([10,0,0]) cube(5);'));
    expect(r.ok).toBe(true);
    expect(computeStats(r.mesh!).colors).toEqual(["#ff0000"]);
  });

  it("applies parameter overrides", async () => {
    const r = await engine.computeMesh(src("size = 10; label = \"x\"; cube(size);"), { size: 20, label: "y" });
    expect(computeStats(r.mesh!).size).toEqual([20, 20, 20]);
  });

  it("returns echo output and warnings", async () => {
    const r = await engine.computeMesh(src('echo("w", 42); cube(w);'));
    expect(r.ok).toBe(true);
    expect(r.log.echo).toEqual(['"w", 42']);
    expect(r.log.warnings.join("\n")).toMatch(/unknown variable "w"/);
  });

  it("reports parser errors with a readable file name", async () => {
    const r = await engine.computeMesh(src("cube([10, 10, 10);"));
    expect(r.ok).toBe(false);
    expect(r.log.errors[0]).toMatch(/Parser error: syntax error in file input\.scad, line 1/);
  });

  it("reports empty geometry as an error", async () => {
    const r = await engine.computeMesh(src("difference() { cube(5); cube(10); }"));
    expect(r.ok).toBe(false);
    expect(r.log.errors).toContain("Current top level object is empty.");
  });

  it("supports text() with bundled fonts", async () => {
    const r = await engine.computeMesh(src('linear_extrude(2) text("Hi", size = 10, font = "Liberation Sans:style=Bold");'));
    expect(r.ok, r.log.errors.join("\n")).toBe(true);
    expect(computeStats(r.mesh!).size[0]).toBeGreaterThan(5);
  });

  it("loads fonts when only a bundled library calls text()", async () => {
    // BOSL2's debug_region() labels vertices with text(); the user's code never mentions text or fonts.
    const r = await engine.computeMesh(src("include <BOSL2/std.scad>\ndebug_region([square(10)]);"));
    expect(r.ok).toBe(true);
    expect(r.log.warnings.filter((w) => /Can't get font/.test(w))).toEqual([]);
  });

  it("keeps echoed strings with newlines whole", async () => {
    const r = await engine.validate(src('echo("first\\nsecond"); cube(1);')); // OpenSCAD's \n escape
    expect(r.log.echo).toEqual(['"first\nsecond"']);
  });

  it("supports the bundled BOSL2 library", async () => {
    const r = await engine.computeMesh(src("include <BOSL2/std.scad>\ncuboid([30, 20, 10], rounding = 2, $fn = 16);"));
    expect(r.ok, r.log.errors.join("\n")).toBe(true);
    const s = computeStats(r.mesh!);
    expect(s.size.map(Math.round)).toEqual([30, 20, 10]);
    expect(s.volume).toBeLessThan(6000); // rounded edges remove material
  });

  it("previews 2D designs as a thin extrusion", async () => {
    const r = await engine.computeMesh(src("square([40, 20]);"));
    expect(r.ok).toBe(true);
    expect(r.is2D).toBe(true);
    expect(computeStats(r.mesh!).size).toEqual([40, 20, 1]);
  });

  it("resolves relative include/use/import for files on disk", async () => {
    mkdirSync(join(dir, "parts"), { recursive: true });
    writeFileSync(join(dir, "parts", "lib.scad"), "module part(s) { cube(s); }\n");
    writeFileSync(join(dir, "main.scad"), "use <parts/lib.scad>\npart(7);\n");
    const r = await engine.computeMesh(prepareSource({ file: join(dir, "main.scad") }));
    expect(r.ok, r.log.errors.join("\n")).toBe(true);
    expect(computeStats(r.mesh!).size).toEqual([7, 7, 7]);
  });

  it("exports formats OpenSCAD writes directly", async () => {
    const svg = await engine.exportFormat(src("square([10, 5]);"), "svg");
    expect(svg.ok).toBe(true);
    expect(new TextDecoder().decode(svg.bytes)).toContain("<svg");
    const csg = await engine.exportFormat(src("cube(3);"), "csg");
    expect(csg.ok).toBe(true);
    expect(new TextDecoder().decode(csg.bytes)).toContain("cube(");
    await expect(engine.exportFormat(src("cube(3);"), "pdf")).rejects.toThrow(/cannot export "pdf"/);
    // OpenSCAD dropped AMF in its 2026.09 snapshots.
    await expect(engine.exportFormat(src("cube(3);"), "amf")).rejects.toThrow(/cannot export "amf"/);
  });

  it("validates code, including assert()", async () => {
    expect((await engine.validate(src("cube(1);"))).ok).toBe(true);
    const bad = await engine.validate(src('assert(false, "nope"); cube(1);'));
    expect(bad.ok).toBe(false);
    expect(bad.log.errors[0]).toMatch(/Assertion .* failed: "nope"/);
  });

  it("runs jobs concurrently", async () => {
    const results = await Promise.all([1, 2, 3, 4].map((n) => engine.computeMesh(src(`cube(${n});`))));
    expect(results.map((r) => computeStats(r.mesh!).size[0])).toEqual([1, 2, 3, 4]);
  });

  it("reports the OpenSCAD version", async () => {
    expect(await engine.version()).toMatch(/\d{4}\.\d{2}\.\d{2}/);
  });

  it("enforces a timeout and recovers afterwards", async () => {
    const fast = new WasmEngine({ timeoutMs: 1000, workers: 1 });
    try {
      const slow = await fast.computeMesh(src("function f(n, a = 0) = n == 0 ? a : f(n - 1, a + 1); echo(f(1e9)); cube(1);"));
      expect(slow.ok).toBe(false);
      expect(slow.log.errors[0]).toMatch(/Timed out after 1s/);
      const after = await fast.computeMesh(src("cube(2);"));
      expect(after.ok).toBe(true);
      // validate asks for at most 30 s, but never more than the engine's own timeout.
      const slowCheck = await fast.validate(src("function f(n, a = 0) = n == 0 ? a : f(n - 1, a + 1); echo(f(1e9)); cube(1);"));
      expect(slowCheck.ok).toBe(false);
      expect(slowCheck.log.errors[0]).toMatch(/Timed out after 1s/);
    } finally {
      await fast.dispose();
    }
  });
});
