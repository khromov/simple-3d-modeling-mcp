/**
 * Native engine tests against a fake `openscad` executable (a Node script),
 * so they run without OpenSCAD installed. Skipped on Windows, where a shebang
 * script cannot be executed directly.
 */

import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createEngine } from "../../src/engine/engine-factory.js";
import { findOpenScadCandidates, NativeEngine, probeOpenScad } from "../../src/engine/native-engine.js";
import { prepareSource } from "../../src/engine/source.js";
import { computeStats } from "../../src/geometry/stats.js";
import { decodePng, encodePng } from "../../src/rendering/png.js";

const TINY_PNG = Buffer.from(encodePng(new Uint8Array(4 * 4 * 4).fill(200), 4, 4)).toString("base64");

function fakeOpenScad(manifold: boolean): string {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "--version") { console.error("OpenSCAD version 2099.01.01"); process.exit(0); }
if (args[0] === "--help") { console.log("Usage: openscad ${manifold ? "--backend arg" : ""} -o file"); process.exit(0); }
if (process.env.FAKE_OPENSCAD_LOG) fs.appendFileSync(process.env.FAKE_OPENSCAD_LOG, JSON.stringify({ args, cwd: process.cwd(), openscadpath: process.env.OPENSCADPATH }) + "\\n");
const out = args[args.indexOf("-o") + 1];
const input = fs.readFileSync(args[args.length - 1], "utf8");
console.error('ECHO: "hello"');
if (input.includes("FAIL")) { console.error("ERROR: Parser error: syntax error in file " + args[args.length - 1] + ", line 1"); process.exit(1); }
if (input.includes("SLEEP")) { setTimeout(() => {}, 10000); return; }
if (out.endsWith(".off")) fs.writeFileSync(out, "OFF 3 1 0\\n0 0 0\\n4 0 0\\n0 3 0\\n3 0 1 2 255 0 0\\n");
else if (out.endsWith(".png")) fs.writeFileSync(out, Buffer.from("${TINY_PNG}", "base64"));
else fs.writeFileSync(out, "data");
`;
}

describe.skipIf(process.platform === "win32")("NativeEngine (fake OpenSCAD)", () => {
  const dir = mkdtempSync(join(tmpdir(), "s3d-native-"));
  const manifoldBin = join(dir, "openscad");
  const legacyBin = join(dir, "openscad-legacy");
  const logFile = join(dir, "calls.log");
  const workDir = join(dir, "work");
  let engine: NativeEngine;

  beforeAll(async () => {
    writeFileSync(manifoldBin, fakeOpenScad(true));
    writeFileSync(legacyBin, fakeOpenScad(false));
    chmodSync(manifoldBin, 0o755);
    chmodSync(legacyBin, 0o755);
    process.env.FAKE_OPENSCAD_LOG = logFile;
    engine = await NativeEngine.create(manifoldBin, { workDir, timeoutMs: 2000 });
  });
  afterAll(() => {
    delete process.env.FAKE_OPENSCAD_LOG;
    rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(() => writeFileSync(logFile, ""));
  const calls = () => readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

  it("probes version and Manifold support", async () => {
    expect(await probeOpenScad(manifoldBin)).toMatchObject({ version: "OpenSCAD version 2099.01.01", manifold: true });
    expect((await probeOpenScad(legacyBin)).manifold).toBe(false);
    await expect(probeOpenScad(join(dir, "nope"))).rejects.toThrow(/not found/);
  });

  it("computes meshes via coloured OFF with the Manifold backend, and cleans up temp files", async () => {
    const r = await engine.computeMesh(prepareSource({ code: "cube(1);" }), { w: 3, name: "a\"b" });
    expect(r.ok).toBe(true);
    expect(computeStats(r.mesh!).colors).toEqual(["#ff0000"]);
    expect(r.log.echo).toEqual(['"hello"']);
    const [call] = calls();
    expect(call.args).toContain("--backend=manifold");
    expect(call.args).toEqual(expect.arrayContaining(["-D", "w=3", "-D", 'name="a\\"b"']));
    expect(call.args.at(-1)).toMatch(/input\.scad$/);
    expect(readdirSync(workDir)).toEqual([]); // per-job temp dir removed
  });

  it("falls back to binary STL without Manifold", async () => {
    const legacy = await NativeEngine.create(legacyBin, { workDir });
    await legacy.computeMesh(prepareSource({ code: "cube(1);" }));
    expect(calls()[0].args).toContain("--export-format=binstl");
    expect(calls()[0].args).not.toContain("--backend=manifold");
  });

  it("renders files in place so relative includes resolve", async () => {
    const file = join(dir, "model.scad");
    writeFileSync(file, "cube(1);");
    await engine.computeMesh(prepareSource({ file }));
    const [call] = calls();
    expect(call.args.at(-1)).toBe(file);
    expect(realpathSync(call.cwd)).toBe(realpathSync(dir));
  });

  it("renders PNG previews with auto-framing and projection", async () => {
    const r = await engine.renderPng!(prepareSource({ code: "cube(1);" }), {
      camera: { kind: "fit", rot: [90, 0, 0] },
      projection: "orthographic",
      width: 320,
      height: 200,
    });
    expect(r.ok).toBe(true);
    expect(decodePng(r.output!).width).toBe(4);
    const args = calls()[0].args;
    expect(args).toEqual(expect.arrayContaining(["--camera=0,0,0,90,0,0,100", "--autocenter", "--viewall", "--projection=ortho", "--imgsize=320,200"]));
    expect(args).not.toContain("--render");
  });

  it("surfaces errors and rewrites temp paths", async () => {
    const r = await engine.computeMesh(prepareSource({ code: "FAIL" }));
    expect(r.ok).toBe(false);
    expect(r.log.errors[0]).toBe("ERROR: Parser error: syntax error in file input.scad, line 1");
  });

  it("times out", async () => {
    const r = await engine.computeMesh(prepareSource({ code: "SLEEP" }));
    expect(r.ok).toBe(false);
    expect(r.log.errors.join("\n")).toMatch(/Timed out after 2s/);
  });

  it("adds bundled libraries to OPENSCADPATH", async () => {
    await engine.validate(prepareSource({ code: "cube(1);" }));
    expect(calls()[0].openscadpath).toMatch(/assets[\\/]libraries/);
  });

  it("finds candidates on PATH", () => {
    const found = findOpenScadCandidates({ PATH: dir }, "linux");
    expect(found[0]).toBe(manifoldBin);
  });

  describe("createEngine", () => {
    it("uses native for an explicit OPENSCAD_PATH", async () => {
      const e = await createEngine({ executablePath: legacyBin, workDir });
      expect(e.name).toBe("native");
    });

    it("falls back to WASM when OPENSCAD_PATH is broken", async () => {
      const notes: string[] = [];
      const e = await createEngine({ executablePath: join(dir, "missing"), log: (m) => notes.push(m) });
      expect(e.name).toBe("wasm");
      expect(notes[0]).toMatch(/OPENSCAD_PATH is not usable/);
      await e.dispose();
    });

    it("auto-selects only a Manifold-capable OpenSCAD", async () => {
      const auto = await createEngine({ candidates: [manifoldBin] });
      expect(auto.name).toBe("native");
      const notes: string[] = [];
      const old = await createEngine({ candidates: [legacyBin], log: (m) => notes.push(m) });
      expect(old.name).toBe("wasm");
      expect(notes[0]).toMatch(/lacks the Manifold backend/);
      await old.dispose();
      expect((await createEngine({ mode: "native", candidates: [legacyBin] })).name).toBe("native");
    });

    it("honours mode=wasm", async () => {
      const e = await createEngine({ mode: "wasm", candidates: [manifoldBin] });
      expect(e.name).toBe("wasm");
      await e.dispose();
    });
  });

  it("leaves no temp directories behind", () => {
    expect(existsSync(workDir) ? readdirSync(workDir) : []).toEqual([]);
  });
});
