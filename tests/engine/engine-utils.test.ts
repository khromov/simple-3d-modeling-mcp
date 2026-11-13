import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { UserError } from "../../src/errors.js";
import { formatLog, parseLog, rewritePaths } from "../../src/engine/output.js";
import { paramArgs, stableParams } from "../../src/engine/params.js";
import { collectDependencies, prepareSource, resolveScadPath } from "../../src/engine/source.js";
import { toVfsPath } from "../../src/engine/wasm-engine.js";

describe("parseLog", () => {
  it("classifies errors, warnings, echo and drops noise", () => {
    const log = parseLog([
      "Could not initialize localization (application path is '/').",
      "ECHO: \"width\", 42",
      "WARNING: Ignoring unknown variable \"w\" in file input.scad, line 1",
      "ERROR: Assertion '(1 == 2)' failed in file input.scad, line 2",
      "TRACE: called by 'assert' in file input.scad, line 2",
      "Current top level object is empty.",
      "Geometries in cache: 1",
      "   Status:     NoError",
      "Top level object is a 3D object (manifold):",
      "",
    ]);
    expect(log.echo).toEqual(['"width", 42']);
    expect(log.warnings).toHaveLength(1);
    expect(log.errors).toEqual([
      "ERROR: Assertion '(1 == 2)' failed in file input.scad, line 2",
      "TRACE: called by 'assert' in file input.scad, line 2",
      "Current top level object is empty.",
    ]);
  });

  it("keeps echoed strings that span several lines together", () => {
    const log = parseLog([
      'ECHO: "first',
      "",
      '  second", 5',
      'ECHO: "say \\"hi',
      'there\\""',
      "WARNING: after the echo",
    ]);
    expect(log.echo).toEqual(['"first\n\n  second", 5', '"say \\"hi\nthere\\""']);
    expect(log.warnings).toEqual(["WARNING: after the echo"]);
  });

  it("never lets an unclosed echo string swallow the next log entry", () => {
    const log = parseLog(['ECHO: "unterminated', "ERROR: Assertion failed in file input.scad, line 3", "ECHO: 2"]);
    expect(log.echo).toEqual(['"unterminated', "2"]);
    expect(log.errors).toEqual(["ERROR: Assertion failed in file input.scad, line 3"]);
  });

  it("treats parser errors and the 2D/3D mismatch as errors", () => {
    const log = parseLog(["ERROR: Parser error: syntax error in file x.scad, line 1", "Current top level object is not a 3D object."]);
    expect(log.errors).toHaveLength(2);
  });

  it("formats and rewrites", () => {
    const log = rewritePaths({ errors: ["in /work/input.scad, line 1"], warnings: [], echo: ["1"] }, [["/work/input.scad", "input.scad"]]);
    expect(log.errors[0]).toBe("in input.scad, line 1");
    expect(formatLog(log)).toBe("Errors:\nin input.scad, line 1\n\nECHO output:\n1");
  });
});

describe("paramArgs", () => {
  it("formats numbers, booleans, strings and nested lists", () => {
    expect(paramArgs({ w: 40, on: true, label: 'say "hi"\\', size: [1, 2, [3, 4]] })).toEqual([
      "-D", "w=40",
      "-D", "on=true",
      "-D", 'label="say \\"hi\\"\\\\"',
      "-D", "size=[1,2,[3,4]]",
    ]);
  });

  it("rejects names that are not identifiers and non-finite numbers", () => {
    expect(() => paramArgs({ "x=1;cube(9)": 1 })).toThrow(/Invalid parameter name/);
    expect(() => paramArgs({ x: Infinity })).toThrow(/finite/);
    // Bad params are the caller's mistake: the tools show UserError messages as-is.
    expect(() => paramArgs({ "bad-name": 1 })).toThrow(UserError);
    expect(() => paramArgs({ x: NaN })).toThrow(UserError);
    expect(paramArgs({ $fn: 64 })).toEqual(["-D", "$fn=64"]);
  });

  it("serialises params deterministically", () => {
    expect(stableParams({ b: 1, a: 2 })).toBe(stableParams({ a: 2, b: 1 }));
  });
});

describe("prepareSource", () => {
  const dir = mkdtempSync(join(tmpdir(), "s3d-src-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("requires exactly one of code or file", () => {
    expect(() => prepareSource({})).toThrow(/Provide OpenSCAD source/);
    expect(() => prepareSource({ code: "cube(1);", file: "/x.scad" })).toThrow(/not both/);
  });

  it("validates file paths", () => {
    expect(() => resolveScadPath("relative.scad")).toThrow(/absolute/);
    expect(() => resolveScadPath("/etc/hosts")).toThrow(/not a .scad/);
    expect(() => prepareSource({ file: join(dir, "missing.scad") })).toThrow(/not found/);
  });

  it("collects include/use/import dependencies recursively and hashes their contents", () => {
    mkdirSync(join(dir, "parts", "sub"), { recursive: true });
    writeFileSync(join(dir, "main.scad"), 'include <parts/a.scad>\nuse <BOSL2/std.scad>\nimport("mesh.stl");\nsurface(file = "h.dat");\n');
    writeFileSync(join(dir, "parts", "a.scad"), "use <sub/b.scad>\n");
    writeFileSync(join(dir, "parts", "sub", "b.scad"), "module b() cube(1);\n");
    writeFileSync(join(dir, "mesh.stl"), "solid x\nendsolid x\n");
    writeFileSync(join(dir, "h.dat"), "1 2\n3 4\n");

    const src = prepareSource({ file: join(dir, "main.scad") });
    expect(src.path).toBe(join(dir, "main.scad"));
    expect(src.deps.map((d) => d.path).sort()).toEqual(
      [join(dir, "parts", "a.scad"), join(dir, "parts", "sub", "b.scad"), join(dir, "mesh.stl"), join(dir, "h.dat")].sort(),
    );

    const before = src.hash;
    writeFileSync(join(dir, "parts", "sub", "b.scad"), "module b() cube(2);\n");
    expect(prepareSource({ file: join(dir, "main.scad") }).hash).not.toBe(before);
  });

  it("only resolves absolute references for inline code", () => {
    expect(collectDependencies('include <parts/a.scad>\n')).toEqual([]);
    expect(collectDependencies(`include <${join(dir, "parts", "a.scad")}>\n`).length).toBeGreaterThan(0);
  });
});

describe("toVfsPath", () => {
  it("keeps POSIX paths and maps Windows drives", () => {
    expect(toVfsPath("/home/u/a.scad", "linux")).toBe("/home/u/a.scad");
    expect(toVfsPath("C:\\Users\\u\\a.scad", "win32")).toBe("/C/Users/u/a.scad");
  });
});
