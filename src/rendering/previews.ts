/**
 * Composite previews built from a model's mesh with the software renderer:
 * labelled multi-view grid and turntable animation. Single views are
 * renderMeshPng() in software-renderer.ts.
 */

import type { Mesh } from "../geometry/mesh.js";
import { drawText } from "./bitmap-font.js";
import { defaultProjection, PRESET_VIEWS, turntableAngles, type PresetView, type Projection } from "./camera.js";
import { encodeApng, encodePng } from "./png.js";
import { meshBounds, renderMesh, THEME, type RenderedImage } from "./software-renderer.js";

export function gridColumns(n: number): number {
  return n <= 1 ? 1 : n <= 4 ? 2 : 3;
}

/** Lays out cells in a grid with a label in each cell's top-left corner. */
export function composeGrid(cells: RenderedImage[], labels: string[], cellW: number, cellH: number): Uint8Array {
  const cols = gridColumns(cells.length);
  const rows = Math.ceil(cells.length / cols);
  const gap = 2;
  const W = cols * cellW + (cols - 1) * gap;
  const H = rows * cellH + (rows - 1) * gap;
  const out = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    out[i * 4] = 60; out[i * 4 + 1] = 60; out[i * 4 + 2] = 90; out[i * 4 + 3] = 255; // separator colour
  }
  cells.forEach((cell, i) => {
    const ox = (i % cols) * (cellW + gap);
    const oy = Math.floor(i / cols) * (cellH + gap);
    for (let y = 0; y < cellH; y++) {
      for (let x = 0; x < cellW; x++) {
        const s = (Math.min(y, cell.height - 1) * cell.width + Math.min(x, cell.width - 1)) * 4;
        const d = ((oy + y) * W + ox + x) * 4;
        out[d] = cell.rgba[s]; out[d + 1] = cell.rgba[s + 1]; out[d + 2] = cell.rgba[s + 2]; out[d + 3] = 255;
      }
    }
    const scale = cellW >= 384 ? 2 : 1;
    drawText(out, W, H, 4, ox + 8, oy + 8, labels[i], scale, THEME.label);
  });
  return encodePng(out, W, H);
}

export interface MultiViewOptions {
  views: PresetView[];
  cellWidth: number;
  cellHeight: number;
  /** "auto": orthographic for axis views, perspective for the 3D view. */
  projection?: Projection | "auto";
}

export function renderMultiView(mesh: Mesh, opts: MultiViewOptions): { png: Uint8Array; layout: string } {
  const cells = opts.views.map((view) => {
    const projection = !opts.projection || opts.projection === "auto" ? defaultProjection(view) : opts.projection;
    const image = renderMesh(mesh, { width: opts.cellWidth, height: opts.cellHeight, camera: { kind: "fit", rot: [...PRESET_VIEWS[view]] }, projection });
    return { image, view, projection };
  });
  const labels = cells.map((c) => `${c.view}${c.projection === "orthographic" ? " (ortho)" : ""}`);
  const png = composeGrid(cells.map((c) => c.image), labels, opts.cellWidth, opts.cellHeight);
  const cols = gridColumns(cells.length);
  const layout = cells
    .map((c, i) => `${["row", Math.floor(i / cols) + 1, "col", (i % cols) + 1].join(" ")}: ${labels[i]}`)
    .join("; ");
  return { png, layout };
}

export interface TurntableOptions {
  frames: number;
  width: number;
  height: number;
  elevation?: number;
  /** Duration of one revolution in ms (default 2400). */
  durationMs?: number;
}

/** Turntable APNG rendered from the mesh (constant framing across frames). */
export function renderTurntable(mesh: Mesh, opts: TurntableOptions): Uint8Array {
  const { center, radius } = meshBounds(mesh);
  const frames = turntableAngles(opts.frames, opts.elevation ?? 55).map(
    (rot) => renderMesh(mesh, { width: opts.width, height: opts.height, camera: { kind: "fit", rot }, sphere: { center, radius }, margin: 0.92 }).rgba,
  );
  return encodeApng(frames, opts.width, opts.height, (opts.durationMs ?? 2400) / opts.frames);
}
