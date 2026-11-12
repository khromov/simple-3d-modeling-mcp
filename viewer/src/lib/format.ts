import type { ModelUpdate } from "./protocol.js";

/** A length in mm, rounded to 0.01; the sidebar shows the unit once, in the heading. */
export function formatLength(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/** 2D models are extruded 1 mm thick, so their "volume" in mm³ is the area in mm². */
export function formatVolume(volume: number, is2D: boolean): string {
  return is2D ? `${(volume / 100).toFixed(2)} cm²` : `${(volume / 1000).toFixed(2)} cm³`;
}

export function modelTitle(model: Pick<ModelUpdate, "title" | "is2D">): string {
  return model.title + (model.is2D ? " (2D, shown 1 mm thick)" : "");
}

export function timeAgo(timestamp: number, now: number): string {
  const s = Math.round((now - timestamp) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
}
