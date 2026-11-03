/**
 * SAM 3 (tracker) pre/post-processing shared by the segmentation worker and the main thread.
 * Pure functions only: no DOM, no ONNX Runtime.
 */

import type { BoundingBox } from '../types';

export const SAM_INPUT_SIZE = 1008;
export const SAM_MASK_SIZE = 288;

const MEAN = [0.5, 0.5, 0.5];
const STD = [0.5, 0.5, 0.5];

/** A SAM prompt: the person's box plus optional click points (label 1 = on the person, 0 = on someone else). */
export interface SamPrompt {
  box: BoundingBox;
  /** Normalized 0-1000 frame space */
  points?: Array<{ x: number; y: number; label: 0 | 1 }>;
}

export interface SegmentedTarget {
  /** 288x288 binary mask (1 = object) over the whole frame, row-major */
  mask: Uint8Array;
  iou: number;
  /** Tight box around the mask, normalized 0-1000 in frame space */
  box: BoundingBox;
  /** Fraction of the mask's frame area covered (0-1) */
  areaRatio: number;
}

/** RGBA pixels (1008x1008, whole frame squashed) -> normalized planar RGB float32. */
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

/** Normalized 0-1000 box -> SAM's 1008 input space [x1, y1, x2, y2]. */
export function boxToSamPrompt(b: BoundingBox): [number, number, number, number] {
  const k = SAM_INPUT_SIZE / 1000;
  return [b.xmin * k, b.ymin * k, b.xmax * k, b.ymax * k];
}

/** Normalized 0-1000 point -> SAM's 1008 input space. */
export function pointToSamPrompt(p: { x: number; y: number }): [number, number] {
  const k = SAM_INPUT_SIZE / 1000;
  return [p.x * k, p.y * k];
}

const CONF = 0.5;
const kpOf = (kps: Array<{ id: number; x: number; y: number; score: number }>, id: number) => {
  const k = kps.find((q) => q.id === id);
  return k && k.score >= CONF ? k : undefined;
};

/**
 * Click points that disambiguate a person in a crowd, derived from real pose keypoints:
 *  - positives on the nose, shoulders and hips of this person
 *  - negatives on the torso centre of every other person whose torso falls inside this person's box
 */
export function buildPosePoints(
  self: Array<{ id: number; x: number; y: number; score: number }>,
  box: BoundingBox,
  others: Array<Array<{ id: number; x: number; y: number; score: number }>>
): Array<{ x: number; y: number; label: 0 | 1 }> {
  const points: Array<{ x: number; y: number; label: 0 | 1 }> = [];
  for (const id of [0, 5, 6, 11, 12]) {
    const k = kpOf(self, id);
    if (k) points.push({ x: k.x, y: k.y, label: 1 });
  }
  for (const other of others) {
    const ls = kpOf(other, 5), rs = kpOf(other, 6), lh = kpOf(other, 11), rh = kpOf(other, 12);
    const torso = [ls, rs, lh, rh].filter((q): q is NonNullable<typeof q> => !!q);
    if (torso.length < 2) continue;
    const x = torso.reduce((a, q) => a + q.x, 0) / torso.length;
    const y = torso.reduce((a, q) => a + q.y, 0) / torso.length;
    if (x > box.xmin && x < box.xmax && y > box.ymin && y < box.ymax) points.push({ x, y, label: 0 });
  }
  return points.slice(0, 8);
}

/** Pick the best of the decoder's candidate masks and binarize it (logit > 0). */
export function pickBestMask(
  predMasks: Float32Array, // [numMasks, 288, 288] for one prompt
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

