/**
 * Real-time in-browser object detection with YOLOv10n (ONNX Runtime Web).
 * Runs locally on every video frame: no network round-trip, so boxes stay glued to people
 * while the cloud vision model only judges the prompt rules.
 *
 * YOLOv10 is NMS-free: output0 is [1, 300, 6] = (x1, y1, x2, y2, score, classId) in 640x640 letterbox pixels.
 */

import type { BoundingBox } from '../types';
import { getOrt, runExclusive } from './ortRuntime';

export const YOLO_INPUT_SIZE = 640;
export const YOLO_MODEL_URL = '/models/yolov10n.onnx';

export const COCO_CLASSES = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat', 'traffic light',
  'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow',
  'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
  'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard',
  'tennis racket', 'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
  'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
  'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote', 'keyboard',
  'cell phone', 'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book', 'clock', 'vase',
  'scissors', 'teddy bear', 'hair drier', 'toothbrush',
];

export interface YoloDetection {
  box: BoundingBox; // normalized 0-1000 in source-frame space
  score: number; // 0-1
  classId: number;
  label: string;
}

export interface LetterboxMeta {
  scale: number;
  padX: number;
  padY: number;
  srcW: number;
  srcH: number;
}

export function computeLetterbox(srcW: number, srcH: number, size: number = YOLO_INPUT_SIZE): LetterboxMeta {
  const scale = Math.min(size / srcW, size / srcH);
  return {
    scale,
    padX: (size - srcW * scale) / 2,
    padY: (size - srcH * scale) / 2,
    srcW,
    srcH,
  };
}

/** RGBA pixels (size x size) -> planar RGB float32 in [0, 1] (NCHW). */
export function rgbaToChw(rgba: Uint8ClampedArray | Uint8Array, size: number = YOLO_INPUT_SIZE): Float32Array {
  const plane = size * size;
  const out = new Float32Array(3 * plane);
  for (let i = 0, p = 0; i < plane; i++, p += 4) {
    out[i] = rgba[p] / 255;
    out[plane + i] = rgba[p + 1] / 255;
    out[2 * plane + i] = rgba[p + 2] / 255;
  }
  return out;
}

/** Decode YOLOv10 output [300 x 6] back into normalized 0-1000 boxes of the original frame. */
export function decodeYolov10(
  data: Float32Array,
  meta: LetterboxMeta,
  minScore: number,
  classFilter?: Set<number>
): YoloDetection[] {
  const dets: YoloDetection[] = [];
  const rows = data.length / 6;
  for (let r = 0; r < rows; r++) {
    const o = r * 6;
    const score = data[o + 4];
    if (score < minScore) continue;
    const classId = Math.round(data[o + 5]);
    if (classFilter && !classFilter.has(classId)) continue;

    const x1 = (data[o] - meta.padX) / meta.scale;
    const y1 = (data[o + 1] - meta.padY) / meta.scale;
    const x2 = (data[o + 2] - meta.padX) / meta.scale;
    const y2 = (data[o + 3] - meta.padY) / meta.scale;

    const clamp = (n: number) => Math.max(0, Math.min(1000, n));
    const box: BoundingBox = {
      xmin: clamp((x1 / meta.srcW) * 1000),
      ymin: clamp((y1 / meta.srcH) * 1000),
      xmax: clamp((x2 / meta.srcW) * 1000),
      ymax: clamp((y2 / meta.srcH) * 1000),
    };
    if (box.xmax - box.xmin < 5 || box.ymax - box.ymin < 5) continue;

    const label = COCO_CLASSES[classId] || `class ${classId}`;
    box.label = label;
    dets.push({ box, score, classId, label });
  }
  return dets;
}

// -----------------------------------------------------------------------------
// Browser runtime
// -----------------------------------------------------------------------------

type OrtModule = typeof import('onnxruntime-web');

let sessionPromise: Promise<{ ort: OrtModule; session: any; provider: string }> | null = null;
let scratchCanvas: HTMLCanvasElement | null = null;

/** Lazily creates the inference session on the shared runtime (WebGPU when available, else WASM). */
export function loadYolo(): Promise<{ ort: OrtModule; session: any; provider: string }> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const { ort, backend } = await getOrt();
      const session = await runExclusive<any>(() =>
        ort.InferenceSession.create(YOLO_MODEL_URL, {
          executionProviders: [backend],
          graphOptimizationLevel: 'all',
        })
      );
      return { ort, session, provider: backend };
    })();
    sessionPromise.catch(() => {
      sessionPromise = null; // allow retry
    });
  }
  return sessionPromise;
}

export interface DetectOptions {
  minScore?: number;
  classFilter?: Set<number>;
}

/** Runs YOLOv10n on the current frame of a <video>. Boxes are returned in the video's own 0-1000 space. */
export async function detectFromVideo(
  video: HTMLVideoElement,
  { minScore = 0.35, classFilter }: DetectOptions = {}
): Promise<YoloDetection[]> {
  const srcW = video.videoWidth;
  const srcH = video.videoHeight;
  if (!srcW || !srcH) return [];

  const { ort, session } = await loadYolo();

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

  return decodeYolov10(output.data as Float32Array, meta, minScore, classFilter);
}
