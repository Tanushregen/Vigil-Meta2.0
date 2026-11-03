// Downloads the SAM 3 tracker ONNX weights (too big for git) into public/models/sam3 if they are missing.
import { createWriteStream, existsSync, mkdirSync, statSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'public', 'models', 'sam3');
const base = 'https://huggingface.co/onnx-community/sam3-tracker-ONNX/resolve/main';

// [remote path, local name, expected size in bytes (minimum) so truncated downloads are retried]
const files = [
  ['onnx/vision_encoder_int8.onnx', 'vision_encoder_int8.onnx', 1_000_000],
  ['onnx/vision_encoder_int8.onnx_data', 'vision_encoder_int8.onnx_data', 500_000_000],
  ['onnx/prompt_encoder_mask_decoder_int8.onnx', 'prompt_encoder_mask_decoder_int8.onnx', 200_000],
  ['onnx/prompt_encoder_mask_decoder_int8.onnx_data', 'prompt_encoder_mask_decoder_int8.onnx_data', 9_000_000],
  // fp16 4-bit build used when SAM runs on WebGPU
  ['onnx/vision_encoder_q4f16.onnx', 'vision_encoder_q4f16.onnx', 1_000_000],
  ['onnx/vision_encoder_q4f16.onnx_data', 'vision_encoder_q4f16.onnx_data', 290_000_000],
  ['onnx/prompt_encoder_mask_decoder_q4f16.onnx', 'prompt_encoder_mask_decoder_q4f16.onnx', 200_000],
  ['onnx/prompt_encoder_mask_decoder_q4f16.onnx_data', 'prompt_encoder_mask_decoder_q4f16.onnx_data', 5_000_000],
];

mkdirSync(dest, { recursive: true });

for (const [remote, local, minSize] of files) {
  const target = join(dest, local);
  if (existsSync(target) && statSync(target).size >= minSize) continue;

  console.log(`[fetch-models] downloading ${local} ...`);
  const res = await fetch(`${base}/${remote}`, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    console.error(`[fetch-models] failed to download ${remote}: HTTP ${res.status}`);
    process.exit(1);
  }
  const tmp = `${target}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
    renameSync(tmp, target);
  } catch (err) {
    rmSync(tmp, { force: true });
    console.error(`[fetch-models] ${local} failed:`, err.message);
    process.exit(1);
  }
}
console.log('[fetch-models] SAM 3 weights ready');
