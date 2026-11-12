/**
 * `npm run dev:viewer`: a real ViewerServer seeded with a few sample models, so
 * the UI can be worked on without an MCP client. Loaded by vite.config.ts
 * through Vite's module runner (it imports the server's TypeScript sources).
 */

import type { Mesh } from "../../src/geometry/mesh.js";
import { computeStats } from "../../src/geometry/stats.js";
import { ViewerServer } from "../../src/viewer/viewer-server.js";
import { box, lShape, merge } from "../../tests/helpers/meshes.js";

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

export async function startSampleServer(): Promise<{ url: string; stop(): Promise<void> }> {
  const viewer = new ViewerServer();
  const url = await viewer.start();
  const add = (mesh: Mesh, title: string, is2D = false) =>
    viewer.pushModel({ mesh, stats: computeStats(mesh), title, is2D, key: title });

  add(box([0, 0, 0], [60, 20, 1]), "Name tag outline", true);
  add(merge(box([0, 0, 0], [50, 50, 4]), cylinder(25, 25, 8, 30, 48, [70, 130, 180])), "Spool holder");
  add(lShape(), "Bracket");

  return { url: url.replace("localhost", "127.0.0.1"), stop: () => viewer.stop() };
}
