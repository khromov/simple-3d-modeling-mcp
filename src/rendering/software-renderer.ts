/**
 * Software mesh renderer that draws every preview image from the model's mesh
 * (the WebAssembly OpenSCAD build has no OpenGL).
 *
 * - OpenSCAD camera conventions (presets, gimbal and vector cameras)
 * - automatic framing, perspective or orthographic projection
 * - per-face colours from color(), two-light shading with a specular highlight
 * - supersampled anti-aliasing, crease/silhouette outlines, axis gizmo, labels
 */

import { isDefaultColor, type Mesh } from "../geometry/mesh.js";
import { drawText, GLYPH_H, GLYPH_W } from "./bitmap-font.js";
import {
  applyMat,
  cameraRotation,
  DEFAULT_FOV,
  gimbalMatrix,
  lookAtMatrix,
  PRESET_VIEWS,
  type CameraSpec,
  type Mat3,
  type Projection,
  type Vec3,
} from "./camera.js";
import { encodePng } from "./png.js";

export type RGB = [number, number, number];

export const THEME = {
  background: [22, 22, 42] as RGB,
  model: [255, 140, 0] as RGB,
  label: [205, 205, 220] as RGB,
  axes: [[229, 83, 75], [87, 171, 90], [83, 155, 245]] as RGB[],
};

export interface RenderOptions {
  width: number;
  height: number;
  /** Default: auto-framed OpenSCAD default view (55, 0, 25). */
  camera?: CameraSpec;
  projection?: Projection;
  /** Supersampling factor for anti-aliasing (1–4, default 2). */
  supersample?: number;
  background?: RGB;
  /** Colour for faces without an explicit color(). */
  modelColor?: RGB;
  /** Draw crease and silhouette outlines (default true). */
  edges?: boolean;
  /** Draw the XYZ axis gizmo (default true). */
  axes?: boolean;
  /** Text drawn in the top-left corner. */
  label?: string;
  /** Frame this bounding sphere instead of fitting tightly (keeps turntable frames steady). */
  sphere?: { center: Vec3; radius: number };
  /** Fraction of the frame the model may fill (default 0.88). */
  margin?: number;
  /**
   * Areas (in output pixels) the model is kept out of, such as a caption drawn
   * over the image afterwards. Only auto-framed views without `sphere` are
   * re-framed, and only when the model would overlap one.
   */
  keepClear?: ClearRect[];
}

export interface ClearRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RenderedImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

const RAD = Math.PI / 180;
/** Smaller images (either side, in pixels) get no axis gizmo: it would cover the model and be too small to read. */
export const GIZMO_MIN_SIZE = 96;
const CREASE_COS = Math.cos(35 * RAD);
/** Planes closer than this to parallel with the view ray (|cos| of the angle) are skipped by the step test. */
const GRAZING_COS = 0.05;
/**
 * Darkest a face colour's brightest channel may be before shading. Darker
 * colours (black, navy) are lifted to it, keeping their hue, so their faces
 * stay distinguishable from each other and from the dark background.
 */
const MIN_FACE_VALUE = 96;
/** Outline pixels darker than this are drawn light, not dark, so edges stay visible on dark parts. */
const DARK_EDGE_VALUE = 72;
const LIGHT_EDGE: RGB = [190, 190, 205];
const L1 = norm3(-0.4, 0.55, 0.75);
const L2 = norm3(0.55, -0.35, 0.45);
const HALF = norm3(L1[0], L1[1], L1[2] + 1);

function norm3(x: number, y: number, z: number): Vec3 {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

export function meshBounds(mesh: Mesh): { min: Vec3; max: Vec3; center: Vec3; radius: number } {
  const p = mesh.positions;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (p[i + k] < min[k]) min[k] = p[i + k];
      if (p[i + k] > max[k]) max[k] = p[i + k];
    }
  }
  if (p.length === 0) return { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], radius: 1 };
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = Math.max(1e-6, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
  return { min, max, center, radius };
}

export function renderMesh(mesh: Mesh, opts: RenderOptions): RenderedImage {
  const S = Math.min(4, Math.max(1, Math.round(opts.supersample ?? 2)));
  const w = Math.max(1, Math.round(opts.width));
  const h = Math.max(1, Math.round(opts.height));
  const W = w * S, H = h * S;
  const aspect = w / h;
  const fovScale = 1 / Math.tan((DEFAULT_FOV * RAD) / 2);
  const margin = opts.margin ?? 0.88;
  const camera: CameraSpec = opts.camera ?? { kind: "fit", rot: [...PRESET_VIEWS.perspective] };
  const ortho = opts.projection === "orthographic";
  const bg = opts.background ?? THEME.background;
  const baseColor = opts.modelColor ?? THEME.model;
  const bounds = meshBounds(mesh);
  const sceneR = opts.sphere?.radius ?? bounds.radius;
  const gizmo = opts.axes !== false ? layoutGizmo(w, h, S, cameraRotation(camera)) : null;

  const P = mesh.positions;
  const nv = P.length / 3;
  const nt = mesh.indices.length / 3;

  // --- Eye space -------------------------------------------------------------
  let R: Mat3;
  let origin: Vec3;
  let dist = 0;
  if (camera.kind === "vector") {
    R = lookAtMatrix(camera.eye, camera.center);
    origin = camera.eye;
  } else {
    R = gimbalMatrix(camera.rot);
    origin = camera.kind === "gimbal" ? camera.translate : opts.sphere?.center ?? bounds.center;
    if (camera.kind === "gimbal") dist = camera.distance;
  }
  const ex = new Float64Array(nv), ey = new Float64Array(nv), ez = new Float64Array(nv);
  for (let v = 0; v < nv; v++) {
    const [x, y, z] = applyMat(R, P[v * 3] - origin[0], P[v * 3 + 1] - origin[1], P[v * 3 + 2] - origin[2]);
    ex[v] = x;
    ey[v] = y;
    ez[v] = z;
  }

  // Projection parameters: ndcX = (ex·kx + bx) / (ortho ? 1 : w), …
  let orthoK = 1, cx = 0, cy = 0;
  let post = { sx: 1, sy: 1, ox: 0, oy: 0 }; // affine applied after projection (tight perspective fit)
  if (camera.kind === "fit") {
    const t = Math.min(1, aspect) / fovScale; // tan of the limiting half-angle
    if (ortho) {
      if (opts.sphere) {
        orthoK = (margin * Math.min(1, aspect)) / sceneR;
      } else {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let v = 0; v < nv; v++) {
          minX = Math.min(minX, ex[v]); maxX = Math.max(maxX, ex[v]);
          minY = Math.min(minY, ey[v]); maxY = Math.max(maxY, ey[v]);
        }
        cx = (minX + maxX) / 2;
        cy = (minY + maxY) / 2;
        orthoK = margin / Math.max((maxX - minX) / 2 / aspect, (maxY - minY) / 2, 1e-9);
      }
    } else if (opts.sphere) {
      dist = sceneR * Math.sqrt(1 + 1 / (margin * t) ** 2);
    } else {
      let maxZ = -Infinity;
      for (let v = 0; v < nv; v++) {
        const dx = ez[v] + (Math.abs(ex[v]) * fovScale) / (aspect * margin);
        const dy = ez[v] + (Math.abs(ey[v]) * fovScale) / margin;
        dist = Math.max(dist, dx, dy);
        maxZ = Math.max(maxZ, ez[v]);
      }
      dist = Math.max(dist, maxZ + sceneR * 0.05);
      // Re-centre and zoom on the projected extents.
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let v = 0; v < nv; v++) {
        const wv = dist - ez[v];
        const px = (ex[v] * fovScale) / (aspect * wv), py = (ey[v] * fovScale) / wv;
        minX = Math.min(minX, px); maxX = Math.max(maxX, px);
        minY = Math.min(minY, py); maxY = Math.max(maxY, py);
      }
      const half = Math.max((maxX - minX) / 2, (maxY - minY) / 2, 1e-9);
      const zoom = margin / half;
      post = { sx: zoom, sy: zoom, ox: -((minX + maxX) / 2) * zoom, oy: -((minY + maxY) / 2) * zoom };
    }
  } else if (ortho) {
    const ref = camera.kind === "gimbal" ? camera.distance : Math.hypot(...(sub(camera.center, camera.eye)));
    orthoK = fovScale / Math.max(ref, 1e-9);
  }

  // Screen coordinates (supersampled pixels) and depth keys (greater = closer).
  const sx = new Float64Array(nv), sy = new Float64Array(nv), dk = new Float64Array(nv);
  const valid = new Uint8Array(nv);
  const near = sceneR * 1e-4;
  for (let v = 0; v < nv; v++) {
    const zEye = ez[v] - dist;
    let nx: number, ny: number;
    if (ortho) {
      nx = ((ex[v] - cx) * orthoK) / aspect;
      ny = (ey[v] - cy) * orthoK;
      dk[v] = zEye;
      valid[v] = 1;
    } else {
      const wv = -zEye;
      if (wv <= near) continue;
      nx = (ex[v] * fovScale) / (aspect * wv);
      ny = (ey[v] * fovScale) / wv;
      dk[v] = 1 / wv;
      valid[v] = 1;
    }
    nx = nx * post.sx + post.ox;
    ny = ny * post.sy + post.oy;
    sx[v] = (nx + 1) * 0.5 * W;
    sy[v] = (1 - ny) * 0.5 * H;
  }

  // --- Keep the model clear of the gizmo and reserved areas -------------------
  if (camera.kind === "fit" && !opts.sphere) {
    const rects: Rect[] = gizmo ? [gizmo.box] : [];
    for (const r of opts.keepClear ?? []) rects.push({ x0: r.x * S, y0: r.y * S, x1: (r.x + r.width) * S, y1: (r.y + r.height) * S });
    const move = placeClear(sx, sy, valid, mesh.indices, W, H, rects, Math.round(Math.min(W, H) * 0.03));
    if (move) {
      // Screen x' = a·x + b, y' = a·y + c, folded into `post` as well so the outline test's inverse stays right.
      const { a, b, c } = move;
      for (let v = 0; v < nv; v++) {
        sx[v] = a * sx[v] + b;
        sy[v] = a * sy[v] + c;
      }
      post = { sx: a * post.sx, ox: a * post.ox + a - 1 + (2 * b) / W, sy: a * post.sy, oy: a * post.oy + 1 - a - (2 * c) / H };
    }
  }

  // --- Per-face normals and shading -----------------------------------------
  const idx = mesh.indices;
  const fnx = new Float32Array(nt), fny = new Float32Array(nt), fnz = new Float32Array(nt), fd = new Float32Array(nt);
  const shade = new Uint8Array(nt * 3);
  const colors = mesh.colors;
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    const ax = ex[a], ay = ey[a], az = ez[a] - dist;
    const ux = ex[b] - ax, uy = ey[b] - ay, uz = ez[b] - dist - az;
    const vx = ex[c] - ax, vy = ey[c] - ay, vz = ez[c] - dist - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    // Two-sided lighting: flip normals that face away from the camera.
    const facing = ortho ? nz : -(nx * ax + ny * ay + nz * az);
    if (facing < 0) { nx = -nx; ny = -ny; nz = -nz; }
    fnx[t] = nx; fny[t] = ny; fnz[t] = nz;
    fd[t] = nx * ax + ny * ay + nz * az;

    let r = baseColor[0], g = baseColor[1], bl = baseColor[2];
    if (colors && !isDefaultColor(colors[t * 4], colors[t * 4 + 1], colors[t * 4 + 2])) {
      r = colors[t * 4]; g = colors[t * 4 + 1]; bl = colors[t * 4 + 2];
    }
    const lift = MIN_FACE_VALUE - Math.max(r, g, bl);
    if (lift > 0) { r += lift; g += lift; bl += lift; }
    const d1 = Math.max(0, nx * L1[0] + ny * L1[1] + nz * L1[2]);
    const d2 = Math.max(0, nx * L2[0] + ny * L2[1] + nz * L2[2]);
    const sp = 0.22 * Math.pow(Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]), 32) * 255;
    const k = 0.3 + 0.62 * d1 + 0.18 * d2;
    shade[t * 3] = Math.min(255, r * k + sp);
    shade[t * 3 + 1] = Math.min(255, g * k + sp);
    shade[t * 3 + 2] = Math.min(255, bl * k + sp);
  }

  // --- Rasterise --------------------------------------------------------------
  const zbuf = new Float32Array(W * H).fill(-Infinity);
  const fid = new Int32Array(W * H).fill(-1);
  /**
   * Fills a screen-space triangle of face t, keeping the nearest face per
   * pixel. Each row visits only the columns between the triangle's edges, not
   * its whole bounding box, which long thin triangles (fine cylinder caps)
   * would make many times larger than the triangle.
   */
  const fill = (t: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => {
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-12) return;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
    if (minX > maxX || minY > maxY) return;
    const inv = 1 / area;
    const dw0 = (y1 - y2) * inv, dw1 = (y2 - y0) * inv, dw2 = -dw0 - dw1;
    const eps = -1e-7;
    for (let py = minY; py <= maxY; py++) {
      const pyc = py + 0.5;
      const pxc = minX + 0.5;
      // Barycentrics at the row's first column; each grows by dw per column.
      const a0 = ((x1 - pxc) * (y2 - pyc) - (x2 - pxc) * (y1 - pyc)) * inv;
      const a1 = ((x2 - pxc) * (y0 - pyc) - (x0 - pxc) * (y2 - pyc)) * inv;
      // Columns where each is ≥ eps, widened by one for rounding; the test below still decides.
      const a2 = 1 - a0 - a1;
      let lo = 0, hi = maxX - minX;
      if (dw0 > 0) lo = Math.max(lo, Math.ceil((eps - a0) / dw0) - 1);
      else if (dw0 < 0) hi = Math.min(hi, Math.floor((eps - a0) / dw0) + 1);
      else if (a0 < eps) continue;
      if (dw1 > 0) lo = Math.max(lo, Math.ceil((eps - a1) / dw1) - 1);
      else if (dw1 < 0) hi = Math.min(hi, Math.floor((eps - a1) / dw1) + 1);
      else if (a1 < eps) continue;
      if (dw2 > 0) lo = Math.max(lo, Math.ceil((eps - a2) / dw2) - 1);
      else if (dw2 < 0) hi = Math.min(hi, Math.floor((eps - a2) / dw2) + 1);
      else if (a2 < eps) continue;
      for (let u = lo, row = py * W + minX + lo; u <= hi; u++, row++) {
        const w0 = a0 + u * dw0, w1 = a1 + u * dw1, w2 = 1 - w0 - w1;
        if (w0 < eps || w1 < eps || w2 < eps) continue;
        const z = w0 * z0 + w1 * z1 + w2 * z2;
        if (z > zbuf[row]) {
          zbuf[row] = z;
          fid[row] = t;
        }
      }
    }
  };
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    if (!valid[a] || !valid[b] || !valid[c]) continue;
    fill(t, sx[a], sy[a], dk[a], sx[b], sy[b], dk[b], sx[c], sy[c], dk[c]);
  }

  // --- Colour + outlines ------------------------------------------------------
  const rgb = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    const f = fid[i];
    const o = i * 3;
    if (f < 0) {
      rgb[o] = bg[0]; rgb[o + 1] = bg[1]; rgb[o + 2] = bg[2];
    } else {
      rgb[o] = shade[f * 3]; rgb[o + 1] = shade[f * 3 + 1]; rgb[o + 2] = shade[f * 3 + 2];
    }
  }

  if (opts.edges !== false && nt > 0) {
    const mask = new Uint8Array(W * H);
    const lin = (i: number) => (ortho ? -zbuf[i] : 1 / zbuf[i]);
    const depthTol = sceneR * 0.04;
    const planeTol = sceneR * 0.002;
    // Depth (along the view axis) where the ray through supersampled pixel
    // (px, py) meets face t's plane; NaN when the plane nearly contains the ray.
    const planeDepth = (t: number, px: number, py: number): number => {
      const qx = ((2 * (px + 0.5)) / W - 1 - post.ox) / post.sx;
      const qy = (1 - (2 * (py + 0.5)) / H - post.oy) / post.sy;
      if (ortho) {
        if (Math.abs(fnz[t]) < GRAZING_COS) return NaN;
        const x = (qx * aspect) / orthoK + cx, y = qy / orthoK + cy;
        return (fnx[t] * x + fny[t] * y - fd[t]) / fnz[t];
      }
      const dx = (qx * aspect) / fovScale, dy = qy / fovScale;
      const den = fnx[t] * dx + fny[t] * dy - fnz[t];
      if (Math.abs(den) < GRAZING_COS * Math.hypot(dx, dy, 1)) return NaN;
      return fd[t] / den;
    };
    // A step between faces f and g that the coarse depth test misses: their
    // planes don't cross between the two pixel centres, and stay further apart
    // than planeTol. Neighbouring faces of a curved surface always cross at
    // their shared edge, however fine the tessellation, so they never count.
    const step = (f: number, g: number, ax: number, ay: number, bx: number, by: number): boolean => {
      const da = planeDepth(f, ax, ay) - planeDepth(g, ax, ay);
      const db = planeDepth(f, bx, by) - planeDepth(g, bx, by);
      if (!Number.isFinite(da) || !Number.isFinite(db) || Math.sign(da) !== Math.sign(db)) return false;
      return Math.min(Math.abs(da), Math.abs(db)) > planeTol;
    };
    const check = (i: number, j: number, ax: number, ay: number, bx: number, by: number) => {
      const f = fid[i], g = fid[j];
      if (f === g) return;
      if (f < 0 || g < 0) {
        mask[f < 0 ? j : i] = 1; // silhouette: darken the model side
        return;
      }
      const dot = fnx[f] * fnx[g] + fny[f] * fny[g] + fnz[f] * fnz[g];
      if (dot < CREASE_COS || Math.abs(lin(i) - lin(j)) > depthTol || step(f, g, ax, ay, bx, by)) {
        mask[i] = 1;
        mask[j] = 1;
      }
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (x + 1 < W) check(i, i + 1, x, y, x + 1, y);
        if (y + 1 < H) check(i, i + W, x, y, x, y + 1);
      }
    }
    for (let i = 0; i < W * H; i++) {
      if (!mask[i]) continue;
      const o = i * 3;
      if (Math.max(rgb[o], rgb[o + 1], rgb[o + 2]) < DARK_EDGE_VALUE) {
        for (let k = 0; k < 3; k++) rgb[o + k] = (rgb[o + k] + LIGHT_EDGE[k]) / 2;
      } else {
        rgb[o] = rgb[o] * 0.4; rgb[o + 1] = rgb[o + 1] * 0.4; rgb[o + 2] = rgb[o + 2] * 0.4;
      }
    }
  }

  // --- Overlays (drawn supersampled, so they get anti-aliased too) ----------
  if (gizmo) drawAxes(rgb, W, H, gizmo);
  if (opts.label) drawText(rgb, W, H, 3, 8 * S, 8 * S, opts.label, 2 * S, THEME.label);

  // --- Downsample -------------------------------------------------------------
  const out = new Uint8Array(w * h * 4);
  const n = S * S;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy2 = 0; sy2 < S; sy2++) {
        let o = ((y * S + sy2) * W + x * S) * 3;
        for (let sx2 = 0; sx2 < S; sx2++, o += 3) {
          r += rgb[o]; g += rgb[o + 1]; b += rgb[o + 2];
        }
      }
      const d = (y * w + x) * 4;
      out[d] = Math.round(r / n);
      out[d + 1] = Math.round(g / n);
      out[d + 2] = Math.round(b / n);
      out[d + 3] = 255;
    }
  }
  return { width: w, height: h, rgba: out };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** A rectangle in supersampled pixels. */
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface GizmoLayout {
  ox: number;
  oy: number;
  len: number;
  thick: number;
  S: number;
  /** Axis letters, only where they are big enough to read. */
  letters: boolean;
  axes: { k: number; v: Vec3 }[];
  /** Everything the gizmo draws, for keeping the model clear of it. */
  box: Rect;
}

/**
 * The axis gizmo in the bottom-left corner, sized to the image (none below
 * GIZMO_MIN_SIZE) and moved in just enough that no arm or letter is cut off.
 */
function layoutGizmo(w: number, h: number, S: number, R: Mat3): GizmoLayout | null {
  const size = Math.min(w, h);
  if (size < GIZMO_MIN_SIZE) return null;
  const len = Math.max(6 * S, Math.round(size * S * 0.07));
  const pad = Math.min(10, Math.max(4, Math.round(size * 0.04))) * S;
  const thick = Math.max(1, Math.round(1.3 * S));
  const letters = len >= 12 * S;
  const axes = [0, 1, 2]
    .map((k) => ({ k, v: applyMat(R, k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0) }))
    .sort((a, b) => a.v[2] - b.v[2]); // far axes first
  // Extent around the origin: arm tips, and letter boxes beyond them.
  let minX = -thick, maxX = thick, minY = -thick, maxY = thick;
  for (const { v } of axes) {
    minX = Math.min(minX, v[0] * len - thick); maxX = Math.max(maxX, v[0] * len + thick);
    minY = Math.min(minY, -v[1] * len - thick); maxY = Math.max(maxY, -v[1] * len + thick);
    if (letters) {
      const lx = v[0] * (len + 7 * S) - 2.5 * S, ly = -v[1] * (len + 7 * S) - 3.5 * S;
      minX = Math.min(minX, lx); maxX = Math.max(maxX, lx + GLYPH_W * S);
      minY = Math.min(minY, ly); maxY = Math.max(maxY, ly + GLYPH_H * S);
    }
  }
  let ox = pad + len, oy = h * S - pad - len;
  ox += Math.max(0, pad - (ox + minX));
  oy -= Math.max(0, oy + maxY - (h * S - pad));
  return { ox, oy, len, thick, S, letters, axes, box: { x0: ox + minX, y0: oy + minY, x1: ox + maxX, y1: oy + maxY } };
}

function drawAxes(rgb: Uint8Array, W: number, H: number, g: GizmoLayout): void {
  const { ox, oy, len, thick, S } = g;
  for (const { k, v } of g.axes) {
    drawLine(rgb, W, H, ox, oy, ox + v[0] * len, oy - v[1] * len, thick, THEME.axes[k]);
    if (!g.letters) continue;
    const lx = ox + v[0] * (len + 7 * S) - 2.5 * S;
    const ly = oy - v[1] * (len + 7 * S) - 3.5 * S;
    drawText(rgb, W, H, 3, lx, ly, "XYZ"[k], S, THEME.axes[k]);
  }
}

/** True when the triangle overlaps the rectangle (separating-axis test). */
function triangleHitsRect(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, r: Rect): boolean {
  if (Math.max(x0, x1, x2) < r.x0 || Math.min(x0, x1, x2) > r.x1 || Math.max(y0, y1, y2) < r.y0 || Math.min(y0, y1, y2) > r.y1) return false;
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (area === 0) return false;
  const corners = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
  const tri = [[x0, y0], [x1, y1], [x2, y2]];
  for (let e = 0; e < 3; e++) {
    const [ax, ay] = tri[e], [bx, by] = tri[(e + 1) % 3];
    // Every corner on the outer side of this edge: separated.
    if (corners.every(([px, py]) => ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) * area < 0)) return false;
  }
  return true;
}

/**
 * If the projected model overlaps any of `rects`, the screen transform
 * (x' = a·x + b, y' = a·y + c, a ≤ 1) that fits it, with `pad` to spare, into
 * the largest part of the frame clear of them; otherwise null. Each rect is
 * cleared by giving up the band on one of its sides, whichever leaves the most
 * room.
 */
function placeClear(
  sx: Float64Array, sy: Float64Array, valid: Uint8Array, idx: Uint32Array, W: number, H: number, rects: Rect[], pad: number,
): { a: number; b: number; c: number } | null {
  const hits = (r: Rect, a: number, b: number, c: number) => {
    for (let t = 0; t < idx.length; t += 3) {
      const p = idx[t], q = idx[t + 1], s = idx[t + 2];
      if (!valid[p] || !valid[q] || !valid[s]) continue;
      if (triangleHitsRect(a * sx[p] + b, a * sy[p] + c, a * sx[q] + b, a * sy[q] + c, a * sx[s] + b, a * sy[s] + c, r)) return true;
    }
    return false;
  };
  const avoid = rects.filter((r) => hits(r, 1, 0, 0));
  if (avoid.length === 0) return null;

  let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
  for (let v = 0; v < sx.length; v++) {
    if (!valid[v]) continue;
    bx0 = Math.min(bx0, sx[v]); bx1 = Math.max(bx1, sx[v]);
    by0 = Math.min(by0, sy[v]); by1 = Math.max(by1, sy[v]);
  }
  const bw = Math.max(bx1 - bx0, 1e-9), bh = Math.max(by1 - by0, 1e-9);

  let best: { a: number; b: number; c: number } | null = null;
  for (let round = 0; round < rects.length; round++) {
    best = null;
    // Try every choice of side for every rect to avoid.
    for (let choice = 0; choice < 4 ** avoid.length; choice++) {
      let x0 = 0, x1 = W, y0 = 0, y1 = H;
      for (let i = 0, rest = choice; i < avoid.length; i++, rest = Math.floor(rest / 4)) {
        const r = avoid[i];
        if (rest % 4 === 0) x0 = Math.max(x0, r.x1);
        else if (rest % 4 === 1) x1 = Math.min(x1, r.x0);
        else if (rest % 4 === 2) y0 = Math.max(y0, r.y1);
        else y1 = Math.min(y1, r.y0);
      }
      const a = Math.min(1, (x1 - x0 - 2 * pad) / bw, (y1 - y0 - 2 * pad) / bh);
      if (a <= 0 || (best && a <= best.a)) continue;
      best = { a, b: (x0 + x1) / 2 - a * (bx0 + bx1) / 2, c: (y0 + y1) / 2 - a * (by0 + by1) / 2 };
    }
    if (!best) return null;
    const found = best;
    const more = rects.filter((r) => !avoid.includes(r) && hits(r, found.a, found.b, found.c));
    if (more.length === 0) return best;
    avoid.push(...more);
  }
  return best;
}

function drawLine(rgb: Uint8Array, W: number, H: number, x0: number, y0: number, x1: number, y1: number, thick: number, color: RGB): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  const r = thick / 2;
  for (let s = 0; s <= steps; s++) {
    const x = x0 + ((x1 - x0) * s) / steps, y = y0 + ((y1 - y0) * s) / steps;
    for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) {
      if (yy < 0 || yy >= H) continue;
      for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
        if (xx < 0 || xx >= W || (xx - x) ** 2 + (yy - y) ** 2 > r * r + 0.25) continue;
        const o = (yy * W + xx) * 3;
        rgb[o] = color[0]; rgb[o + 1] = color[1]; rgb[o + 2] = color[2];
      }
    }
  }
}

export function renderMeshPng(mesh: Mesh, opts: RenderOptions): Uint8Array {
  const img = renderMesh(mesh, opts);
  return encodePng(img.rgba, img.width, img.height);
}
