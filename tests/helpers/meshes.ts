import type { Mesh } from "../../src/geometry/mesh.js";

type V3 = [number, number, number];

/** Axis-aligned box as 12 outward-facing triangles, optionally coloured. */
export function box(min: V3, max: V3, color?: [number, number, number]): Mesh {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const positions = Float32Array.from([
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
  ]);
  // Counter-clockwise when seen from outside.
  const indices = Uint32Array.from([
    0, 2, 1, 0, 3, 2, // bottom (-Z)
    4, 5, 6, 4, 6, 7, // top (+Z)
    0, 1, 5, 0, 5, 4, // front (-Y)
    2, 3, 7, 2, 7, 6, // back (+Y)
    1, 2, 6, 1, 6, 5, // right (+X)
    3, 0, 4, 3, 4, 7, // left (-X)
  ]);
  const colors = color ? new Uint8Array(12 * 4).map((_, i) => (i % 4 === 3 ? 255 : color[i % 4])) : undefined;
  return { positions, indices, colors };
}

/** Closed cylinder on z = 0 around the Z axis, with `segments` side facets sharing their vertices. */
export function cylinder(r: number, h: number, segments: number): Mesh {
  const positions: number[] = [0, 0, 0, 0, 0, h];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    positions.push(r * Math.cos(a), r * Math.sin(a), 0, r * Math.cos(a), r * Math.sin(a), h);
  }
  const indices: number[] = [];
  for (let i = 0; i < segments; i++) {
    const b0 = 2 + i * 2, t0 = b0 + 1;
    const b1 = 2 + ((i + 1) % segments) * 2, t1 = b1 + 1;
    indices.push(0, b1, b0, 1, t0, t1, b0, b1, t1, b0, t1, t0);
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

export function merge(...meshes: Mesh[]): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  const anyColor = meshes.some((m) => m.colors);
  for (const m of meshes) {
    const base = positions.length / 3;
    positions.push(...m.positions);
    indices.push(...Array.from(m.indices, (i) => i + base));
    if (anyColor) {
      const n = m.indices.length / 3;
      for (let t = 0; t < n; t++) {
        if (m.colors) colors.push(...m.colors.subarray(t * 4, t * 4 + 4));
        else colors.push(249, 215, 44, 255); // OpenSCAD default colour
      }
    }
  }
  return {
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    colors: anyColor ? Uint8Array.from(colors) : undefined,
  };
}

/**
 * Asymmetric test model: a red bar along +X, a blue 30 mm tower at the +X
 * end, and an uncoloured nub extending along +Y at the -X end.
 */
export function lShape(): Mesh {
  return merge(
    box([0, 0, 0], [30, 10, 5], [255, 0, 0]),
    box([25, 0, 0], [30, 10, 30], [0, 0, 255]),
    box([0, 10, 0], [5, 25, 5]),
  );
}
