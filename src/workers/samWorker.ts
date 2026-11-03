/**
 * SAM 3 (tracker) segmentation worker. Owns its own ONNX Runtime instance on the CPU (WASM, multi-threaded when the
 * page is cross-origin isolated) so the heavy image encoder never competes with the YOLO detector on the GPU.
 */

import * as ort from 'onnxruntime-web';
import {
  SAM_INPUT_SIZE,
  boxToSamPrompt,
  pointToSamPrompt,
  maskToBox,
  pickBestMask,
  rgbaToSamInput,
} from '../utils/samCore';
import type { SamPrompt, SegmentedTarget } from '../utils/samCore';

const SAM_DIR = '/models/sam3/';
// int8 runs on the CPU (WASM); q4f16 is the compact fp16 build that fits WebGPU
const MODEL_SUFFIX: Record<'cpu' | 'webgpu', string> = { cpu: 'int8', webgpu: 'q4f16' };

export type SamWorkerRequest =
  | { type: 'init'; id: number; backend: 'cpu' | 'webgpu' }
  | { type: 'segment'; id: number; pixels: ArrayBuffer; prompts: SamPrompt[] };

export type SamBackend = 'cpu' | 'webgpu';

export type SamWorkerResponse =
  | { type: 'ready'; id: number; provider: string }
  | { type: 'result'; id: number; targets: (SegmentedTarget | null)[] }
  | { type: 'error'; id: number; message: string };

let sessions: Promise<{ encoder: ort.InferenceSession; decoder: ort.InferenceSession; provider: string }> | null = null;

function init(backend: SamBackend = 'cpu') {
  if (!sessions) {
    sessions = (async () => {
      const threads = self.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;
      // The bundled runtime embeds its JS glue; only the .wasm binary is fetched (same-origin, from public/ort).
      ort.env.wasm.wasmPaths = { wasm: '/ort/ort-wasm-simd-threaded.jsep.wasm' } as any;
      ort.env.wasm.numThreads = threads;
      ort.env.wasm.proxy = false; // already off the main thread

      const create = (model: string) =>
        ort.InferenceSession.create(SAM_DIR + model, {
          executionProviders: [backend === 'webgpu' ? 'webgpu' : 'wasm'],
          externalData: [{ path: `${model}_data`, data: `${SAM_DIR}${model}_data` }],
          graphOptimizationLevel: 'all',
        });
      const suffix = MODEL_SUFFIX[backend];
      const encoder = await create(`vision_encoder_${suffix}.onnx`);
      const decoder = await create(`prompt_encoder_mask_decoder_${suffix}.onnx`);
      return { encoder, decoder, provider: backend === 'webgpu' ? 'gpu' : `cpu×${threads}` };
    })();
    sessions.catch(() => {
      sessions = null;
    });
  }
  return sessions;
}

async function segment(pixels: ArrayBuffer, prompts: SamPrompt[]): Promise<(SegmentedTarget | null)[]> {
  const { encoder, decoder } = await init();
  const rgba = new Uint8Array(pixels);
  const enc = await encoder.run({
    pixel_values: new ort.Tensor('float32', rgbaToSamInput(rgba), [1, 3, SAM_INPUT_SIZE, SAM_INPUT_SIZE]),
  });

  // Index-aligned with `prompts`; null where SAM produced no mask for that prompt
  const out: (SegmentedTarget | null)[] = [];
  for (const { box: b, points } of prompts) {
    // With no click points, one padding point (label -1 = ignore) keeps the decoder inputs well-formed
    const pts = points && points.length > 0 ? points : [{ x: 0, y: 0, label: -1 as const }];
    const coords = new Float32Array(pts.length * 2);
    pts.forEach((p, i) => {
      const [px, py] = p.label === -1 ? [0, 0] : pointToSamPrompt(p);
      coords[i * 2] = px;
      coords[i * 2 + 1] = py;
    });
    const dec = await decoder.run({
      input_points: new ort.Tensor('float32', coords, [1, 1, pts.length, 2]),
      input_labels: new ort.Tensor('int64', BigInt64Array.from(pts.map((p) => BigInt(p.label))), [1, 1, pts.length]),
      input_boxes: new ort.Tensor('float32', Float32Array.from(boxToSamPrompt(b)), [1, 1, 4]),
      'image_embeddings.0': enc['image_embeddings.0'],
      'image_embeddings.1': enc['image_embeddings.1'],
      'image_embeddings.2': enc['image_embeddings.2'],
    });
    const masks = dec.pred_masks; // [1, 1, M, 288, 288]
    const { mask, iou } = pickBestMask(masks.data as Float32Array, dec.iou_scores.data as Float32Array, masks.dims[2]);
    const tight = maskToBox(mask);
    out.push(tight ? { mask, iou, box: tight.box, areaRatio: tight.areaRatio } : null);
  }
  return out;
}

// Requests can arrive from several cameras at once; an ONNX session must only run one inference at a time
let queue: Promise<void> = Promise.resolve();

self.onmessage = (e: MessageEvent<SamWorkerRequest>) => {
  queue = queue.then(() => handle(e.data));
};

async function handle(req: SamWorkerRequest): Promise<void> {
  try {
    if (req.type === 'init') {
      const { provider } = await init(req.backend);
      (self as unknown as Worker).postMessage({ type: 'ready', id: req.id, provider } satisfies SamWorkerResponse);
    } else {
      const targets = await segment(req.pixels, req.prompts);
      const transfer = targets.filter((t): t is SegmentedTarget => !!t).map((t) => t.mask.buffer);
      (self as unknown as Worker).postMessage({ type: 'result', id: req.id, targets } satisfies SamWorkerResponse, transfer);
    }
  } catch (err: any) {
    (self as unknown as Worker).postMessage({
      type: 'error',
      id: req.id,
      message: String(err?.message || err),
    } satisfies SamWorkerResponse);
  }
}
