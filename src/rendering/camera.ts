/**
 * Camera conventions, matching OpenSCAD's `--camera` / $vpr semantics.
 *
 * OpenSCAD's gimbal camera maps model coordinates to eye coordinates as
 *   eye = Rx(-rx) · Ry(-ry) · Rz(-rz) · (p - translate) - (0, 0, distance)
 * with the camera at the origin looking down -Z, +Y up on screen.
 */

import { UserError } from "../errors.js";

export type Vec3 = [number, number, number];
/** Row-major 3×3 matrix. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];
export type Projection = "perspective" | "orthographic";

export type CameraSpec =
  /** Rotation only; the renderer frames the model automatically. */
  | { kind: "fit"; rot: Vec3 }
  /** OpenSCAD gimbal camera: look-at point, rotation, distance. */
  | { kind: "gimbal"; translate: Vec3; rot: Vec3; distance: number }
  /** OpenSCAD vector camera: eye position and look-at point. */
  | { kind: "vector"; eye: Vec3; center: Vec3 };

export const PRESET_VIEWS = {
  front: [90, 0, 0],
  back: [90, 0, 180],
  right: [90, 0, 90],
  left: [90, 0, 270],
  top: [0, 0, 0],
  bottom: [180, 0, 0],
  perspective: [55, 0, 25],
} as const satisfies Record<string, Readonly<Vec3>>;

export type PresetView = keyof typeof PRESET_VIEWS;
export const VIEW_NAMES = Object.keys(PRESET_VIEWS) as PresetView[];

const ALIASES: Record<string, PresetView> = {
  iso: "perspective",
  isometric: "perspective",
  default: "perspective",
  "3d": "perspective",
};

/** OpenSCAD's default field of view (degrees). */
export const DEFAULT_FOV = 22.5;

export function resolvePreset(name: string): PresetView | undefined {
  const key = name.trim().toLowerCase();
  if (key in PRESET_VIEWS) return key as PresetView;
  return ALIASES[key];
}

/** Default projection for a preset: orthographic for axis-aligned views. */
export function defaultProjection(view: PresetView): Projection {
  return view === "perspective" ? "perspective" : "orthographic";
}

export const VIEW_HELP =
  `a preset (${VIEW_NAMES.join(", ")}, iso), three rotation angles "rx,ry,rz" (auto-framed), ` +
  `an OpenSCAD gimbal camera "tx,ty,tz,rx,ry,rz,distance", or a vector camera "eyeX,eyeY,eyeZ,centerX,centerY,centerZ"`;

export function parseView(view?: string): CameraSpec {
  if (!view || !view.trim()) return { kind: "fit", rot: [...PRESET_VIEWS.perspective] };
  const preset = resolvePreset(view);
  if (preset) return { kind: "fit", rot: [...PRESET_VIEWS[preset]] };

  const nums = view.split(",").map((s) => Number(s.trim()));
  if (nums.some((n) => !Number.isFinite(n))) throw new UserError(`Invalid view "${view}". Use ${VIEW_HELP}.`);
  switch (nums.length) {
    case 3:
      return { kind: "fit", rot: [nums[0], nums[1], nums[2]] };
    case 6:
      if (Math.hypot(nums[3] - nums[0], nums[4] - nums[1], nums[5] - nums[2]) < 1e-9) {
        throw new UserError(`Invalid view "${view}": the eye and the center are the same point, so the camera has no direction.`);
      }
      return { kind: "vector", eye: [nums[0], nums[1], nums[2]], center: [nums[3], nums[4], nums[5]] };
    case 7:
      if (nums[6] <= 0) throw new UserError(`Invalid view "${view}": the distance (the last number) must be positive.`);
      return { kind: "gimbal", translate: [nums[0], nums[1], nums[2]], rot: [nums[3], nums[4], nums[5]], distance: nums[6] };
    default:
      throw new UserError(`Invalid view "${view}" (${nums.length} numbers). Use ${VIEW_HELP}.`);
  }
}

const RAD = Math.PI / 180;

function mul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

/** Model → eye rotation for OpenSCAD gimbal angles (degrees). */
export function gimbalMatrix(rot: Readonly<Vec3>): Mat3 {
  const [ax, ay, az] = [-rot[0] * RAD, -rot[1] * RAD, -rot[2] * RAD];
  const rx: Mat3 = [1, 0, 0, 0, Math.cos(ax), -Math.sin(ax), 0, Math.sin(ax), Math.cos(ax)];
  const ry: Mat3 = [Math.cos(ay), 0, Math.sin(ay), 0, 1, 0, -Math.sin(ay), 0, Math.cos(ay)];
  const rz: Mat3 = [Math.cos(az), -Math.sin(az), 0, Math.sin(az), Math.cos(az), 0, 0, 0, 1];
  return mul(rx, mul(ry, rz));
}

/** Model → eye rotation for a camera at `eye` looking at `center`, Z up. */
export function lookAtMatrix(eye: Readonly<Vec3>, center: Readonly<Vec3>): Mat3 {
  const f = normalize([center[0] - eye[0], center[1] - eye[1], center[2] - eye[2]]);
  // +Z stays up however close to vertical the view is, as in OpenSCAD's own
  // look-at, so the image never flips as the eye moves. Only an exactly
  // vertical view needs another up vector: +Y, as in the top view.
  const up: Vec3 = Math.hypot(f[0], f[1]) < 1e-12 ? [0, 1, 0] : [0, 0, 1];
  const r = normalize(cross(f, up));
  const u = cross(r, f);
  return [r[0], r[1], r[2], u[0], u[1], u[2], -f[0], -f[1], -f[2]];
}

export function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function applyMat(m: Mat3, x: number, y: number, z: number): Vec3 {
  return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
}

/** Rotation part of a camera (used for the axis gizmo). */
export function cameraRotation(camera: CameraSpec): Mat3 {
  return camera.kind === "vector" ? lookAtMatrix(camera.eye, camera.center) : gimbalMatrix(camera.rot);
}

/** Cameras for a turntable: constant elevation, full revolution around Z. */
export function turntableAngles(frames: number, elevation = 55): Vec3[] {
  return Array.from({ length: frames }, (_, i) => [elevation, 0, (360 / frames) * i] as Vec3);
}
