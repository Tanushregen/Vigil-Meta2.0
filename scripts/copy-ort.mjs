// Copies the onnxruntime-web WASM runtime into public/ort so the YOLO detector loads it from the same origin.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const dest = join(root, 'public', 'ort');

// The JSEP binary serves both the WebGPU and CPU execution providers; the JS glue is bundled into the ort entry point
const files = [
  'ort-wasm-simd-threaded.jsep.wasm',
];

if (!existsSync(src)) {
  console.warn('[copy-ort] onnxruntime-web is not installed; skipping');
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
for (const f of files) {
  copyFileSync(join(src, f), join(dest, f));
}
console.log(`[copy-ort] copied ${files.length} runtime files to public/ort`);

// ffmpeg.wasm core (used to convert AVI/MKV/... video files to MP4 in the browser)
const ffSrc = join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const ffDest = join(root, 'public', 'ffmpeg');
if (existsSync(ffSrc)) {
  mkdirSync(ffDest, { recursive: true });
  for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) copyFileSync(join(ffSrc, f), join(ffDest, f));
  console.log('[copy-ort] copied ffmpeg core to public/ffmpeg');
}
