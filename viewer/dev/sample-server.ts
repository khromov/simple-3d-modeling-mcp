/**
 * `npm run dev:viewer`: a real ViewerServer seeded with a few sample models, so
 * the UI can be worked on without an MCP client. Loaded by vite.config.ts
 * through Vite's module runner (it imports the server's TypeScript sources).
 */

import type { Mesh } from "../../src/geometry/mesh.js";
import type { ModelSource } from "../../src/viewer/viewer-state.js";
import { computeStats } from "../../src/geometry/stats.js";
import { ViewerServer } from "../../src/viewer/viewer-server.js";
import { box, merge } from "../../tests/helpers/meshes.js";

type RGB = [number, number, number];

/** Closed cylinder standing on z = 0, centred on (cx, cy). */
function cylinder(cx: number, cy: number, r: number, h: number, segments: number, color?: RGB): Mesh {
  const positions: number[] = [cx, cy, 0, cx, cy, h];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    positions.push(x, y, 0, x, y, h);
  }
  const indices: number[] = [];
  for (let i = 0; i < segments; i++) {
    const b0 = 2 + i * 2, t0 = b0 + 1;
    const b1 = 2 + ((i + 1) % segments) * 2, t1 = b1 + 1;
    indices.push(0, b1, b0, 1, t0, t1, b0, b1, t1, b0, t1, t0);
  }
  const triangles = indices.length / 3;
  const colors = color ? new Uint8Array(triangles * 4).map((_, i) => (i % 4 === 3 ? 255 : color[i % 4])) : undefined;
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices), colors };
}

// Sources for the code view; the meshes above are built directly, not from these.
const NAME_TAG = `// Name tag outline, for laser cutting
width = 50; // overridden with -D width=60
height = 20;

square([width, height]);
`;

const SPOOL_HOLDER = `// Spool holder: a base plate with a peg
$fn = 48;

base = [50, 50, 4];
peg_r = 8;
peg_h = 30;

cube(base);
color("steelblue")
  translate([base.x / 2, base.y / 2, 0])
    cylinder(r = peg_r, h = peg_h);
`;

const BRACKET = `/* L-shaped bracket: a red bar, a blue upright
   and a nub that takes the model colour. */
module bracket(bar = [25, 10, 5], post_h = 30) {
  color("red") cube(bar);
  color("blue") translate([bar.x, 0, 0]) cube([5, bar.y, post_h]);
  translate([0, bar.y, 0]) cube([5, 15, bar.z]);
}

bracket();
`;

export async function startSampleServer(): Promise<{ url: string; stop(): Promise<void> }> {
  const viewer = new ViewerServer();
  const url = await viewer.start();
  const add = (mesh: Mesh, title: string, source: ModelSource, is2D = false) =>
    viewer.pushModel({ mesh, stats: computeStats(mesh), title, is2D, key: title, source });

  add(box([0, 0, 0], [60, 20, 1]), "Name tag outline", { code: NAME_TAG, params: ["width=60"] }, true);
  add(merge(box([0, 0, 0], [50, 50, 4]), cylinder(25, 25, 8, 30, 48, [70, 130, 180])), "Spool holder", {
    code: SPOOL_HOLDER,
    file: "spool-holder.scad",
  });
  // Like the tests' lShape(), but the parts touch instead of overlapping: overlapping
  // boxes leave coplanar red and blue faces that flicker (OpenSCAD's own output is a union).
  add(merge(box([0, 0, 0], [25, 10, 5], [255, 0, 0]), box([25, 0, 0], [30, 10, 30], [0, 0, 255]), box([0, 10, 0], [5, 25, 5])), "Bracket", {
    code: BRACKET,
  });

  return { url: url.replace("localhost", "127.0.0.1"), stop: () => viewer.stop() };
}
