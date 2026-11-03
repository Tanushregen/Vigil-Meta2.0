/**
 * Real multi-person pose estimation with YOLOv8n-pose (ONNX Runtime Web).
 * Each detection carries a person box plus 17 COCO keypoints predicted by the network, so shoulders, elbows, hips
 * etc. follow the actual body instead of being laid out from fixed box proportions.
 *
 * Output layout of the ONNX export: output0 = [1, 56, 8400], channel-major.
 *   channels 0-3: box centre x, centre y, width, height (640x640 letterbox pixels)
 *   channel  4  : person score
 *   channels 5+ : 17 x (x, y, visibility) keypoints
 * This head is not NMS-free, so overlapping anchors are suppressed here.
 */

import type { BoundingBox, PoseKeypoint, PoseSkeleton } from '../types';
import { COCO_KEYPOINTS, analyzePosture } from './yoloPose';
import { YOLO_INPUT_SIZE, computeLetterbox, rgbaToChw } from './yoloDetector';
import type { LetterboxMeta } from './yoloDetector';
import { getOrt, runExclusive } from './ortRuntime';

export const POSE_MODEL_URL = '/models/yolov8n-pose.onnx';
const NUM_KEYPOINTS = 17;
const NUM_CHANNELS = 5 + NUM_KEYPOINTS * 3; // 56

export interface PoseDetection {
  box: BoundingBox; // normalized 0-1000 in source-frame space
  score: number; // 0-1
  pose: PoseSkeleton;
}

function iou(a: BoundingBox, b: BoundingBox): number {
  const ix = Math.max(0, Math.min(a.xmax, b.xmax) - Math.max(a.xmin, b.xmin));
  const iy = Math.max(0, Math.min(a.ymax, b.ymax) - Math.max(a.ymin, b.ymin));
  const inter = ix * iy;
  const union = (a.xmax - a.xmin) * (a.ymax - a.ymin) + (b.xmax - b.xmin) * (b.ymax - b.ymin) - inter;
  return union > 0 ? inter / union : 0;
}

/** Decode YOLOv8-pose output into people with keypoints in normalized 0-1000 frame space. */
export function decodeYolov8Pose(
  data: Float32Array,
  meta: LetterboxMeta,
  minScore: number = 0.3,
  iouThreshold: number = 0.5,
  numAnchors: number = data.length / NUM_CHANNELS
): PoseDetection[] {
  const clamp = (n: number) => Math.max(0, Math.min(1000, n));
  const toX = (px: number) => clamp(((px - meta.padX) / meta.scale / meta.srcW) * 1000);
  const toY = (py: number) => clamp(((py - meta.padY) / meta.scale / meta.srcH) * 1000);

  const candidates: Array<{ i: number; score: number; box: BoundingBox }> = [];
  for (let i = 0; i < numAnchors; i++) {
    const score = data[4 * numAnchors + i];
    if (score < minScore) continue;
    const cx = data[i];
    const cy = data[numAnchors + i];
    const w = data[2 * numAnchors + i];
    const h = data[3 * numAnchors + i];
    const box: BoundingBox = {
      xmin: toX(cx - w / 2),
      ymin: toY(cy - h / 2),
      xmax: toX(cx + w / 2),
      ymax: toY(cy + h / 2),
      label: 'person',
    };
    if (box.xmax - box.xmin < 5 || box.ymax - box.ymin < 10) continue;
    candidates.push({ i, score, box });
  }

  // Greedy NMS, highest score first
  candidates.sort((a, b) => b.score - a.score);
  const kept: typeof candidates = [];
  for (const c of candidates) {
    if (kept.every((k) => iou(k.box, c.box) < iouThreshold)) kept.push(c);
  }

  return kept.map(({ i, score, box }) => {
    const keypoints: PoseKeypoint[] = [];
    for (let k = 0; k < NUM_KEYPOINTS; k++) {
      const base = 5 + k * 3;
      keypoints.push({
        id: k,
        name: COCO_KEYPOINTS[k],
        x: toX(data[base * numAnchors + i]),
        y: toY(data[(base + 1) * numAnchors + i]),
        score: data[(base + 2) * numAnchors + i],
      });
    }
    const analysis = analyzePosture(keypoints, box);
    return {
      box,
      score,
      pose: {
        keypoints,
        posture: analysis.posture,
        postureConfidence: analysis.postureConfidence,
        spineAngleDeg: analysis.spineAngleDeg,
        isFallDetected: analysis.isFallDetected,
        reachExceeded: analysis.reachExceeded,
      },
    };
  });
}

// -----------------------------------------------------------------------------
// Browser runtime
// -----------------------------------------------------------------------------

let sessionPromise: Promise<{ ort: any; session: any; provider: string }> | null = null;
let scratchCanvas: HTMLCanvasElement | null = null;

export function loadPoseModel(): Promise<{ ort: any; session: any; provider: string }> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const { ort, backend } = await getOrt();
      const session = await runExclusive<any>(() =>
        ort.InferenceSession.create(POSE_MODEL_URL, {
          executionProviders: [backend],
          graphOptimizationLevel: 'all',
        })
      );
      return { ort, session, provider: backend };
    })();
    sessionPromise.catch(() => {
      sessionPromise = null;
    });
  }
  return sessionPromise;
}

/** Runs YOLOv8n-pose on the current frame of a <video>. */
export async function detectPoses(video: HTMLVideoElement, minScore: number = 0.3): Promise<PoseDetection[]> {
  const srcW = video.videoWidth;
  const srcH = video.videoHeight;
  if (!srcW || !srcH) return [];

  const { ort, session } = await loadPoseModel();

  if (!scratchCanvas) {
    scratchCanvas = document.createElement('canvas');
    scratchCanvas.width = YOLO_INPUT_SIZE;
    scratchCanvas.height = YOLO_INPUT_SIZE;
  }
  const ctx = scratchCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  const meta = computeLetterbox(srcW, srcH);
  ctx.fillStyle = 'rgb(114,114,114)';
  ctx.fillRect(0, 0, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE);
  ctx.drawImage(video, meta.padX, meta.padY, srcW * meta.scale, srcH * meta.scale);

  const pixels = ctx.getImageData(0, 0, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE).data;
  const input = new ort.Tensor('float32', rgbaToChw(pixels), [1, 3, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE]);
  const results = await runExclusive<any>(() => session.run({ [session.inputNames[0]]: input }));
  const output = results[session.outputNames[0]];

  return decodeYolov8Pose(output.data as Float32Array, meta, minScore, 0.5, output.dims[2]);
}
