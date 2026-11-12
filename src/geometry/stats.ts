import { hasExplicitColors, isDefaultColor, triangleCount, type Mesh } from "./mesh.js";

export interface MeshStats {
  triangles: number;
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
  center: [number, number, number];
  /** Enclosed volume in mm³ (signed-tetrahedron sum; exact for closed meshes). */
  volume: number;
  /** Surface area in mm². */
  area: number;
  /** Distinct explicit colours (hex), excluding OpenSCAD's default colour. */
  colors: string[];
}

export function computeStats(mesh: Mesh): MeshStats {
  const { positions: p, indices: idx } = mesh;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = p[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  if (p.length === 0) {
    min.fill(0);
    max.fill(0);
  }

  let vol6 = 0;
  let area2 = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ax = p[a], ay = p[a + 1], az = p[a + 2];
    const bx = p[b], by = p[b + 1], bz = p[b + 2];
    const cx = p[c], cy = p[c + 1], cz = p[c + 2];
    // Signed volume of tetrahedron (origin, a, b, c) * 6
    vol6 += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    area2 += Math.sqrt(nx * nx + ny * ny + nz * nz);
  }

  const colors: string[] = [];
  if (mesh.colors && hasExplicitColors(mesh)) {
    const seen = new Set<string>();
    const c = mesh.colors;
    for (let i = 0; i < c.length && seen.size < 16; i += 4) {
      if (isDefaultColor(c[i], c[i + 1], c[i + 2])) continue;
      const hex = "#" + [c[i], c[i + 1], c[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("");
      if (!seen.has(hex)) {
        seen.add(hex);
        colors.push(hex);
      }
    }
  }

  return {
    triangles: triangleCount(mesh),
    min,
    max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    volume: Math.abs(vol6) / 6,
    area: area2 / 2,
    colors,
  };
}

/** Formats a length in mm with up to 2 decimals, trimming trailing zeros. */
export function fmtMm(v: number): string {
  const r = Math.round(v * 100) / 100;
  return (Object.is(r, -0) ? 0 : r).toString();
}

export function formatStats(stats: MeshStats, opts: { is2D?: boolean } = {}): string {
  const [sx, sy, sz] = stats.size;
  const lines: string[] = [];
  if (opts.is2D) {
    lines.push(`2D design: ${fmtMm(sx)} × ${fmtMm(sy)} mm (X × Y)`);
    lines.push(`Bounds: X ${fmtMm(stats.min[0])} … ${fmtMm(stats.max[0])} · Y ${fmtMm(stats.min[1])} … ${fmtMm(stats.max[1])}`);
    // The preview mesh is a 1 mm extrusion, so volume (mm³) equals area (mm²).
    lines.push(`Area: ${fmtArea(stats.volume)} · preview shown as a 1 mm extrusion`);
  } else {
    lines.push(`Size: ${fmtMm(sx)} × ${fmtMm(sy)} × ${fmtMm(sz)} mm (X × Y × Z)`);
    lines.push(
      `Bounds: X ${fmtMm(stats.min[0])} … ${fmtMm(stats.max[0])} · Y ${fmtMm(stats.min[1])} … ${fmtMm(stats.max[1])} · Z ${fmtMm(stats.min[2])} … ${fmtMm(stats.max[2])}`,
    );
    lines.push(`Volume: ${fmtVolume(stats.volume)} · Surface: ${fmtArea(stats.area)} · ${stats.triangles.toLocaleString("en-US")} triangles`);
  }
  if (stats.colors.length > 0) lines.push(`Colors: ${stats.colors.join(", ")}`);
  return lines.join("\n");
}

function fmtVolume(mm3: number): string {
  return mm3 >= 1000 ? `${(mm3 / 1000).toFixed(2)} cm³` : `${mm3.toFixed(1)} mm³`;
}

function fmtArea(mm2: number): string {
  return mm2 >= 100 ? `${(mm2 / 100).toFixed(2)} cm²` : `${mm2.toFixed(1)} mm²`;
}
