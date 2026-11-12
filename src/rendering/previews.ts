/**
 * Preview images built from a model: single view, labelled multi-view grid,
 * and turntable animation. Uses OpenSCAD's own renderer when the engine has
 * one (native), otherwise the software renderer.
 */

import type { Engine, Params, PreparedSource } from "../engine/types.js";
import type { Mesh } from "../geometry/mesh.js";
import { drawText } from "./bitmap-font.js";
import {
  defaultProjection,
  PRESET_VIEWS,
  turntableAngles,
  type CameraSpec,
  type PresetView,
  type Projection,
} from "./camera.js";
import { decodePng, encodeApng, encodePng } from "./png.js";
import { meshBounds, renderMesh, THEME, type RenderedImage } from "./software-renderer.js";

export interface PreviewContext {
  engine: Engine;
  src: PreparedSource;
  params?: Params;
  mesh: Mesh;
  /** Native-only: OpenSCAD colour scheme. */
  colorscheme?: string;
  /** Skip OpenSCAD PNG rendering (e.g. after it failed for lack of OpenGL). */
  softwareOnly?: boolean;
}

export interface PreviewResult {
  png: Uint8Array;
  renderer: "openscad" | "software";
  /** Set when OpenSCAD's renderer was tried and failed. */
  openscadFailed?: boolean;
}

async function renderCell(
  ctx: PreviewContext,
  camera: CameraSpec,
  projection: Projection,
  width: number,
  height: number,
): Promise<{ image: RenderedImage; renderer: "openscad" | "software"; openscadFailed?: boolean }> {
  let openscadFailed = false;
  if (!ctx.softwareOnly && ctx.engine.capabilities.png && ctx.engine.renderPng) {
    const r = await ctx.engine.renderPng(ctx.src, { camera, projection, width, height, colorscheme: ctx.colorscheme, params: ctx.params });
    if (r.ok && r.output) {
      try {
        const img = decodePng(r.output);
        return { image: img, renderer: "openscad" };
      } catch {
        // fall through to software rendering
      }
    }
    openscadFailed = true;
  }
  return { image: renderMesh(ctx.mesh, { width, height, camera, projection }), renderer: "software", openscadFailed };
}

export async function renderPreview(
  ctx: PreviewContext,
  opts: { camera: CameraSpec; projection: Projection; width: number; height: number },
): Promise<PreviewResult> {
  const cell = await renderCell(ctx, opts.camera, opts.projection, opts.width, opts.height);
  return { png: encodePng(cell.image.rgba, cell.image.width, cell.image.height), renderer: cell.renderer, openscadFailed: cell.openscadFailed };
}

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

export async function renderMultiView(ctx: PreviewContext, opts: MultiViewOptions): Promise<PreviewResult & { layout: string }> {
  const cells = await Promise.all(
    opts.views.map((view) => {
      const projection = !opts.projection || opts.projection === "auto" ? defaultProjection(view) : opts.projection;
      return renderCell(ctx, { kind: "fit", rot: [...PRESET_VIEWS[view]] }, projection, opts.cellWidth, opts.cellHeight).then((c) => ({ ...c, view, projection }));
    }),
  );
  const labels = cells.map((c) => `${c.view}${c.projection === "orthographic" ? " (ortho)" : ""}`);
  const png = composeGrid(cells.map((c) => c.image), labels, opts.cellWidth, opts.cellHeight);
  const cols = gridColumns(cells.length);
  const layout = cells
    .map((c, i) => `${["row", Math.floor(i / cols) + 1, "col", (i % cols) + 1].join(" ")}: ${labels[i]}`)
    .join("; ");
  return {
    png,
    renderer: cells.every((c) => c.renderer === "openscad") ? "openscad" : "software",
    openscadFailed: cells.some((c) => c.openscadFailed),
    layout,
  };
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
