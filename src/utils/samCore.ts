/**
 * SAM 2.1 pre/post-processing shared by the segmentation worker and the main thread.
 * Pure functions only: no DOM, no ONNX Runtime.
 */

import type { BoundingBox } from '../types';

export const SAM_INPUT_SIZE = 1024;
export const SAM_MASK_SIZE = 256;

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

export interface SegmentedTarget {
  /** 256x256 binary mask (1 = object) over the whole frame, row-major */
  mask: Uint8Array;
  iou: number;
  /** Tight box around the mask, normalized 0-1000 in frame space */
  box: BoundingBox;
  /** Fraction of the mask's frame area covered (0-1) */
  areaRatio: number;
}

/** RGBA pixels (1024x1024, whole frame squashed) -> normalized planar RGB float32. */
export function rgbaToSamInput(rgba: Uint8ClampedArray | Uint8Array): Float32Array {
  const n = SAM_INPUT_SIZE * SAM_INPUT_SIZE;
  const out = new Float32Array(3 * n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    out[i] = (rgba[p] / 255 - MEAN[0]) / STD[0];
    out[n + i] = (rgba[p + 1] / 255 - MEAN[1]) / STD[1];
    out[2 * n + i] = (rgba[p + 2] / 255 - MEAN[2]) / STD[2];
  }
  return out;
}

/** Normalized 0-1000 box -> SAM's 1024 input space [x1, y1, x2, y2]. */
export function boxToSamPrompt(b: BoundingBox): [number, number, number, number] {
  const k = SAM_INPUT_SIZE / 1000;
  return [b.xmin * k, b.ymin * k, b.xmax * k, b.ymax * k];
}

/** Pick the best of the decoder's candidate masks and binarize it (logit > 0). */
export function pickBestMask(
  predMasks: Float32Array, // [numMasks, 256, 256] for one prompt
  iouScores: Float32Array, // [numMasks]
  numMasks: number
): { mask: Uint8Array; iou: number } {
  let best = 0;
  for (let i = 1; i < numMasks; i++) if (iouScores[i] > iouScores[best]) best = i;
  const size = SAM_MASK_SIZE * SAM_MASK_SIZE;
  const mask = new Uint8Array(size);
  const offset = best * size;
  for (let i = 0; i < size; i++) mask[i] = predMasks[offset + i] > 0 ? 1 : 0;
  return { mask, iou: iouScores[best] };
}

export function maskToBox(mask: Uint8Array): { box: BoundingBox; areaRatio: number } | null {
  let minX = SAM_MASK_SIZE, minY = SAM_MASK_SIZE, maxX = -1, maxY = -1, area = 0;
  for (let y = 0; y < SAM_MASK_SIZE; y++) {
    for (let x = 0; x < SAM_MASK_SIZE; x++) {
      if (mask[y * SAM_MASK_SIZE + x]) {
        area++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (area === 0) return null;
  const k = 1000 / SAM_MASK_SIZE;
  return {
    box: { xmin: minX * k, ymin: minY * k, xmax: (maxX + 1) * k, ymax: (maxY + 1) * k },
    areaRatio: area / (SAM_MASK_SIZE * SAM_MASK_SIZE),
  };
}

