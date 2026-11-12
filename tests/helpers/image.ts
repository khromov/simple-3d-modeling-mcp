import type { RenderedImage } from "../../src/rendering/software-renderer.js";

export type Pred = (r: number, g: number, b: number) => boolean;

export const isRedish: Pred = (r, g, b) => r > 120 && g < 70 && b < 70;
export const isBlueish: Pred = (r, g, b) => b > 120 && r < 70 && g < 100;

/** Bounding box (in pixels) of pixels matching a predicate. */
export function bboxOf(img: RenderedImage, pred: Pred): { minX: number; maxX: number; minY: number; maxY: number; count: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, count = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      if (!pred(img.rgba[i], img.rgba[i + 1], img.rgba[i + 2])) continue;
      count++;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  return { minX, maxX, minY, maxY, count };
}

export function centroid(img: RenderedImage, pred: Pred): { x: number; y: number; count: number } {
  let sx = 0, sy = 0, count = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      if (!pred(img.rgba[i], img.rgba[i + 1], img.rgba[i + 2])) continue;
      sx += x; sy += y; count++;
    }
  }
  return { x: sx / count, y: sy / count, count };
}
