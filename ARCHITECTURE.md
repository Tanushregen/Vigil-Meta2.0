# SentinelPrompt (Vigil-Meta 2.0) — Architecture

SentinelPrompt is a real-time monitor that checks camera feeds against **rules written in plain language**
("Alert if anyone is on the scaffold without a hardhat"). Fast local models find and track the people in each frame; a
cloud vision-language model (Meta **Muse Spark**) decides which rules each person is breaking.

This document describes how a frame becomes an incident, what each model does, exactly which instructions are sent to
the rules model, and how to run and extend the system. Everything here reflects the code in this repository.

---

## 1. The idea in one picture

```
 camera / video file / screen share
              │
              ▼
┌───────────────────────────── in the browser (local, GPU + CPU) ─────────────────────────────┐
│ YOLOv8n-pose ─► ByteTrack ─► OSNet re-ID ─► PersonRegistry ─► SAM 3 masks ─► per-person     │
│ people+17 pts   local IDs    appearance     global IDs P1,P2   (box + body   crops + context │
│                              fingerprint    shared by cameras   points)                      │
└──────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                               │  POST /api/evaluate-frame
                                               ▼
                               Express server (server.ts)  ── builds prompt ──►  Muse Spark
                                               │                                  (Meta Model API)
                                               ▼
                         violations (ruleId, targetId, explanation, confidence)
                                               │
                  ┌────────────────────────────┴───────────────────────────┐
                  ▼                                                        ▼
        incident log + alarm sound                         PersonRegistry.setViolations()
        (App.tsx, localStorage)                            → "ACTIVE violations" shared with
                                                             every camera on the next scan
```

Design principles:

1. **Local models do the seeing, the cloud model does the judging.** Boxes, skeletons, masks and IDs are computed in the
   browser at video rate. The cloud model is called once every few seconds and only decides "is rule X broken, for
   whom".
2. **Boxes never come from the language model for tracked people.** A violation tied to a target uses that target's own
   box, so overlays stay glued to the person.
3. **One person, one ID, across cameras.** A re-ID model fingerprints each person; the registry merges the same person
   seen on different cameras into one global ID (`P3`).
4. **Shared memory between cameras.** What the room already knows about a person (other cameras, active violations) is
   written into the prompt, so the model judges a person, not an isolated frame.
5. **Degrade, don't fail.** No API key, quota exhausted, SAM too slow, GPU missing: each has a defined fallback (§8).

---

## 2. Components

| Layer | Piece | File(s) | Role |
|---|---|---|---|
| Server | Express + Vite middleware | `server.ts` | `/api/evaluate-frame`, `/api/generate-rules`, `/api/health`, COOP/COEP headers, static serving in production |
| UI | App shell | `src/App.tsx` | Cameras, groups, rules, incidents (persisted in `localStorage`), tabs |
| UI | Multi-Cam Matrix | `src/components/MultiCameraMatrix.tsx` | Grid of cameras, per-camera source, round-robin scan loop, shared `PersonRegistry` |
| UI | Camera tile | `src/components/CameraStream.tsx` | Plays a webcam / video file / screen share, draws boxes, skeletons, labels, violation banners |
| UI | Room panel | `src/components/RoomPeoplePanel.tsx` | Active people, which cameras see them, their active violations |
| UI | Spotlight Feed | `src/components/FeedViewport.tsx` | Single large feed with its own YOLO + pose + SAM loop and scan timer |
| UI | Rules | `src/components/RuleManager.tsx`, `src/utils/defaultRules.ts` | Create / edit / generate rules, preset packs |
| UI | Incidents, analytics, architecture | `IncidentAuditFeed.tsx`, `AnalyticsSummary.tsx`, `MetaArchitectureModal.tsx` | Audit log, stats, in-app explanation |
| Perception | Per-camera pipeline | `src/utils/cameraPipeline.ts` | Orchestrates pose → track → re-ID → registry → target payload |
| Perception | Pose detector | `src/utils/poseDetector.ts` | YOLOv8n-pose decode + NMS, 17 keypoints, posture |
| Perception | Object detector | `src/utils/yoloDetector.ts` | YOLOv10n (Spotlight Feed objects: phone, laptop, …) |
| Perception | Tracker | `src/utils/byteTrack.ts` | ByteTrack with Kalman filter: stable local track IDs |
| Perception | Re-ID | `src/utils/reid.ts` | OSNet embeddings (512-d) |
| Perception | Registry | `src/utils/personRegistry.ts` | Global IDs, galleries, sightings, violations, `describe()` context |
| Perception | SAM 3 | `src/utils/samSegmenter.ts`, `src/utils/samCore.ts`, `src/workers/samWorker.ts` | Box + body-point prompted masks in a Web Worker |
| Runtime | ONNX Runtime | `src/utils/ortRuntime.ts` | WebGPU with WASM fallback, `runExclusive()` serialization |
| Media | AVI/MKV/… conversion | `src/utils/videoConvert.ts` | ffmpeg.wasm → MP4 for formats `<video>` cannot play |
| Build | Asset scripts | `scripts/copy-ort.mjs`, `scripts/fetch-models.mjs` | Copy WASM/ffmpeg cores, download SAM 3 weights |

---

## 3. Models

| Model | Where it runs | Used for | Notes |
|---|---|---|---|
| **YOLOv8n-pose** (`public/models/yolov8n-pose.onnx`, 12.9 MB) | Browser, main thread, WebGPU → WASM | People + 17 keypoints per person | Output `[1,56,8400]`, decoded with NMS; keypoints normalized to 0–1000 |
| **YOLOv10n** (`yolov10n.onnx`, 9 MB) | Browser, main thread | Non-person objects in Spotlight Feed | NMS-free output |
| **OSNet x0.25 MSMT17** (`osnet_x0_25_msmt17.onnx`, 0.9 MB) | Browser | Person appearance fingerprint | Fixed batch 16, 128×256 input, L2-normalized |
| **SAM 3 tracker** (`public/models/sam3/`, ~800 MB, downloaded) | Browser, **Web Worker** with its own ORT instance | Mask per person from box + body points | `q4f16` on WebGPU, `int8` on CPU; input 1008 px, 288×288 masks |
| **Muse Spark 1.3 / 1.2 / 1.1** | Meta Model API (cloud) | Judges the rules per person | Responses API, images + JSON output, `reasoning.effort = minimal` |
| **ffmpeg.wasm** (`public/ffmpeg/`) | Browser worker | Convert AVI etc. to MP4 | ~32 MB, downloaded only when needed |

SAM 3.1 is not used: it ships only as a PyTorch checkpoint, so the ONNX export of SAM 3 is used. The segmentation code
is written against a generic "image encoder + prompt decoder" shape, so the weights can be swapped later.

**GPU + CPU together.** YOLO / pose / re-ID use the GPU on the main thread. SAM runs in its own worker with its own
runtime so it never queues behind them. When no WebGPU adapter exists, everything falls back to multithreaded WASM
(needs the COOP/COEP headers the server sets).

---

## 4. The per-frame perception pipeline

Implemented by `CameraPipeline` (`cameraPipeline.ts`); one instance per real camera, all sharing one `PersonRegistry`.

```
loop (every ~30 ms after each pass):
  1. detectPoses(video, minScore 0.45)         → people with box + 17 keypoints + posture
  2. ByteTracker.update(...)                   → stable local trackId per person on this camera
  3. pick tracks needing a fingerprint:
       hits ≥ 3, height ≥ 120/1000,
       unidentified → retry every 1 s, identified → refresh every 5 s
  4. embedPeople(video, boxes)                 → 512-d embeddings (batch ≤ 16)
  5. registry.observe(camId, observations)     → local trackId → global person ID
  6. publish tracks (box, pose, label "P3", colour) for the overlay
```

Key constants: `MIN_HITS_FOR_ID = 3`, `MIN_HITS_TO_CREATE = 10`, `MIN_HEIGHT_FOR_ID = 120`,
`REFRESH_EMBEDDING_MS = 5000`, `MAX_TARGETS = 6`, `MIN_POSE_SCORE = 0.45`.

A track may be *matched* to a known person after 3 hits, but may only *create* a new person after 10 hits. This stops
flickering detections from minting ghost IDs.

### 4.1 Cross-camera identity (`personRegistry.ts`)

`observe(camId, tracks, now)` links local tracks to global people in three steps:

1. **Sticky links.** A track that already has an identity keeps it.
2. **Matching.** Other tracks are compared with every person not already used on this camera, using cosine similarity
   against the person's gallery (up to 8 diverse embeddings). Pairs are accepted best-first, one-to-one, when
   `score ≥ 0.70` (`MATCH_THRESHOLD`) and the runner-up is not within `0.04` (`MATCH_MARGIN`). Ambiguous matches are
   rejected: a separate ID is safer than a wrong merge. A person cannot appear twice on one camera.
3. **Creation.** Unmatched tracks with an embedding and `canCreate` become new people (`P1, P2, …`).

Housekeeping: people unseen for 10 minutes are forgotten; people seen for under 4 s and gone for 15 s are dropped as
false detections (unless they carry a violation); at most 100 people are kept. `ACTIVE_WINDOW_MS = 8000` defines
"currently in the room". The registry is in memory and resets on page reload.

### 4.2 Context shared between cameras (`describe()`)

For each person on each scan the registry produces a sentence like:

> `P3: first seen 94s ago. also seen on Camera 02 (2s ago, standing). ACTIVE violations: "Hardhat & Head Protection Compliance" on Camera 02 for 12s. recently resolved: "Phone" (Camera 04).`

This is the "share the active details" step: it travels to Muse Spark inside the prompt (§5.2).

### 4.3 SAM 3 segmentation (`buildTargets`)

For the (up to 6) largest identified people on the camera, `segmentIfReady()` asks SAM for one mask each, prompted by:

* the person's **box**, and
* **body keypoints** from the pose model (`buildPosePoints`): foreground points on the torso/limbs of this person, and
  background points taken from *other* people's keypoints, so overlapping people are separated.

The mask refines the box and is used to cut a **background-removed crop** (gray background) for the model. SAM is
optional and bounded: if the model is not loaded yet, or a pass exceeds its budget, plain box crops are sent instead
(`masked: false`).

Model loading: `preloadSam()` is called at app start and again on resume, so the first scan does not wait for
~800 MB of weights; the UI shows loading / ready / slow / error states.

---

## 5. The rules model (Muse Spark)

### 5.1 Request flow

`POST /api/evaluate-frame` body (from `MultiCameraMatrix.evaluateCamera` and `FeedViewport.evaluateActiveFrame`):

```jsonc
{
  "imageBase64": "<640px JPEG of the full frame>",
  "rules": [ /* PromptRule[] for this camera */ ],
  "context": "Camera 02 in <group>. Active Conditions: ... Assigned Worker: ...",
  "feedMode": "webcam | video_file | screen_share | simulation",
  "modelEngine": "Muse Spark 1.3",
  "targets": [ { "id": 7, "globalId": 3, "label": "P3", "box": {ymin,xmin,ymax,xmax}, "masked": true,
                 "crop": "<jpeg>", "context": "P3: first seen ..." } ],
  "objects": [ { "label": "cell phone", "score": 0.81, "box": {...} } ]
}
```

Server steps (`server.ts`):

1. Keep only **enabled** rules whose `streamType` is `visual` or `both`. None → empty result.
2. No API key or circuit breaker open → edge fallback (§8).
3. Sanitize `targets` (≤ 8, integer id, valid box, crop required, context ≤ 500 chars) and `objects` (≤ 12). Boxes are
   normalized to integers clamped to 0–1000, `[ymin, xmin, ymax, xmax]`.
4. Build the prompt (§5.2) and call Muse Spark with images `[full frame, crop of target 1, crop of target 2, …]`.
5. Keep only `isViolated === true`, normalize boxes, replace any target violation's box with the **target's own box**
   (`attachTargetBoxes`), return JSON.

Call parameters (`callMuseSpark`): `POST {META_API_URL}/responses`, bearer `META_API_KEY`, model id from the UI engine
name (`Muse Spark 1.3` → `muse-spark-1.3`), `reasoning.effort` from `MUSE_REASONING` (default `minimal`),
`max_output_tokens` 4000 (reasoning tokens share the budget), 45 s timeout. HTTP 429 trips the circuit breaker for 30 s.
Any failure returns `null` and the caller degrades gracefully. The reply is parsed tolerantly (`parseModelJson` strips
code fences and surrounding prose).

### 5.2 The instructions sent to the model

**System instruction** (`instructions` field):

```
You are Meta <modelEngine>, a real-time vision auditor. Output strictly JSON.
```

**User prompt** (assembled per request; parts in `[]` are conditional):

```
You are an authoritative real-time vision compliance auditor (Meta <modelEngine>).
Analyze this video frame carefully against the following active prompt rules:
[Rule 1] ID: "<id>" | Name: "<name>" | Severity: <severity>
Condition to detect: "<rule prompt>"
[Rule 2] ...
[Operational Environment: <context>]
[PRE-DETECTED TARGETS (YOLOv10 detector + SAM 3 segmentation, tracked by ID). Boxes are normalized 0-1000 [ymin, xmin, ymax, xmax]:
 - Target #<id> (<label>[, room-wide person ID <gid>]) box [..] - background removed with SAM mask | plain box crop; its crop image follows the full frame
     [Room context: <registry.describe() text>]
 [Other detected objects: <label> (<pct>%) [box]; ...]
 Judge every rule PER TARGET using its crop (gray background = removed by the mask). Targets with a room-wide person ID
 are the same individual on every camera; their room context says what other cameras saw and which violations are
 already ACTIVE. Treat an ACTIVE violation as a lead, not a fact: report it again only if you can see it in this view,
 otherwise leave it out so it is marked resolved. When a violation belongs to a target, set "targetId" to that target's
 ID. Do not return box2d for target violations; the system uses the target's own box. For scene-level rules that no
 target satisfies (e.g. nobody present, restricted object), omit targetId and give box2d if you can localize it.]

CRITICAL RULES:
1. ONLY flag a violation if you visually observe clear evidence of the violation in this specific frame.
2. If there are NO people, or the people are complying, or the violation condition is NOT present, return violations: [].
3. For each real violation visually seen in the image:
   - ruleId: exact rule ID
   - isViolated: true
   - confidence: 50-100
   - explanation: clear concise description of what is visible in the frame
   - detectedLabel: brief label (e.g. "Missing Hardhat", "Phone in Hand", "Missing Vest")
   - targetId: ID of the pre-detected target that violates the rule (only when targets are listed above)
   - box2d: REQUIRED unless targetId is set. Tight bounding box {ymin,xmin,ymax,xmax} in normalized image coordinates
     0-1000 (origin top-left) around the exact violating person or object. Never omit it.
DO NOT invent or hallucinate violations that are not visible in the frame. If in doubt or no violation is present, return empty array.

Reply with ONLY a JSON object, no prose and no markdown fences:
{"violations":[{"ruleId":"...","isViolated":true,"confidence":90,"explanation":"...","detectedLabel":"...","targetId":0,"box2d":{"ymin":0,"xmin":0,"ymax":0,"xmax":0}}],"sceneSummary":"one sentence describing the scene"}

[Images that follow: first the full frame, then the crop of each target in the order listed: #7, #9, ...]
```

Behavioral consequences worth knowing:

* The model must **see** the evidence in the current view. "ACTIVE violation" context is only a lead, which is how a
  violation gets cleared when the person fixes it, and how a violation seen on camera A directs attention on camera B.
* Violations that name a `targetId` are drawn with the target's box; scene-level rules (empty room, restricted object)
  rely on the model's own `box2d`.
* Only `visual` / `both` rules are evaluated. Text rules were removed together with the text stream.

### 5.3 Rule generation

`POST /api/generate-rules` with `{ scenarioDescription }`. System instruction:
`You are a safety compliance architect. Output strictly JSON.` Prompt asks for 3–4 rules, each with `name`, `prompt`
(a plain-language condition), `severity` (`critical|high|medium|low`), `category`
(`safety|security|compliance|conduct|quality|custom`) and `streamType` (always `"visual"`), as
`{"rules":[...]}`. Without a key, on quota exhaustion, or on an unusable reply, keyword-based default rules are
returned (`isEdgeFallback: true`).

### 5.4 Writing good rules

A rule is `{ id, name, prompt, severity, category, streamType, targetScope, targetIds, enabled }`.

* `prompt` is the condition the model checks, per person, from a crop. Make it visible and concrete:
  "Alert if a person is not wearing a protective hardhat" works; "Alert if work is unsafe" does not.
* `targetScope`: `all`, `group` (match camera group IDs in `targetIds`) or `camera` (match camera IDs).
* Rules are re-sent on every scan, so edits take effect on the next scan.

---

## 6. Scan scheduling and the UI loops

Two independent loops, both calling `/api/evaluate-frame`:

| Loop | Where | Cadence | Notes |
|---|---|---|---|
| **Multi-Cam Matrix** | `MultiCameraMatrix.tsx` | one camera every **3200 ms**, round-robin over monitoring cameras (or only the focused one in single layout) | Real cameras only open after **Start**; each has a source: simulation, webcam, video file, screen share |
| **Spotlight Feed** | `FeedViewport.tsx` | every `scanIntervalMs` (default **3000 ms**, user-selectable) plus a first scan at 600 ms | Own YOLO + pose loops and own SAM use; does **not** use the shared registry |

After a verdict the Matrix calls `applyVerdict()`: each scanned person gets exactly the violations reported for them on
that camera, and previously active ones that are no longer reported are marked resolved. The incident explanation is
prefixed with the person (`[P3] …`).

**Incidents.** Each reported violation calls `onViolationDetected` → `App.handleViolationDetected`, which stores a
`ViolationIncident` with the frame as evidence, increments the rule counter, and plays a critical or warning sound.
Incidents (latest 100), cameras, groups and rules persist in `localStorage`. There is currently **no de-duplication**:
a violation that persists is logged again on every scan.

**Pause Monitor** stops every model: in-flight cloud requests are aborted, late responses are discarded via a source
session ID, a running SAM pass is cancelled (an idle loaded model stays loaded so resume is instant), overlays and mask
caches are cleared, and the YOLO / pose / scan timers stop through their own effects.

**Video files.** Browsers play MP4/M4V/WebM/Ogg/MOV. For anything else (AVI, MKV, WMV, FLV, …) `convertToMp4()` runs
ffmpeg.wasm (`-an`, 640 px wide, 15 fps, H.264 `ultrafast`, `crf 28`), then the MP4 plays like any other file. The core
is fetched through blob URLs, with an 8 s start timeout and 3 attempts.

---

## 7. Server details

* **Endpoints:** `GET /api/health` → `{ status, hasApiKey, model, quotaExceeded, timestamp }`;
  `POST /api/evaluate-frame`; `POST /api/generate-rules`. Unknown `/api/*` routes and body-parse errors return JSON,
  never HTML. JSON body limit is 50 MB (frames are base64).
* **Headers:** `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` on every
  response, required for `SharedArrayBuffer` / multithreaded WASM.
* **Dev vs production:** dev (`npm run dev`) mounts Vite as middleware on the same port; production (`NODE_ENV=production`)
  serves `dist/` and caches `/models` and `/ort` for a week.
* **Circuit breaker:** a 429 from the model API opens it for 30 s (`tripQuotaCircuitBreaker`); while open, calls skip the
  cloud.

### Configuration (`.env`, never committed)

| Variable | Default | Meaning |
|---|---|---|
| `META_API_KEY` | — | Meta Model API key (`META_LLAMA_API_KEY` also accepted) |
| `META_API_URL` | `https://api.meta.ai/v1` | API base URL |
| `MUSE_MODEL` | `muse-spark-1.3` | Used when the UI engine name is not recognized |
| `MUSE_REASONING` | `minimal` | Reasoning effort; higher is slower and costs more |
| `PORT` | `3000` | Server port |
| `NODE_ENV` | — | `production` serves `dist/` |
| `APP_URL` | — | Public URL of the app |

---

## 8. Failure behavior

| Situation | What happens |
|---|---|
| No API key, or circuit breaker open | Simulation feeds use the local rule-toggle edge engine; real feeds return no violations. Boxes are never fabricated for real feeds |
| Muse Spark error, timeout (45 s) or unparsable reply | Same fallbacks as above; the next scan tries again |
| 429 rate limit | Breaker opens for 30 s |
| SAM not loaded yet | Scans proceed with plain box crops |
| SAM pass slower than 8 s (budget) | That scan sends box crops |
| SAM pass slower than 20 s | SAM is switched off on this device (Spotlight), box crops are used |
| No WebGPU adapter | ONNX Runtime uses WASM (SAM uses `int8` weights), with the ORT proxy worker |
| Pose model fails or has not finished | Camera shows "Loading detector…"; Spotlight falls back to a box-derived pose estimate |
| AVI conversion fails | The camera tile reports that the file is unsupported or damaged |

The "edge engine" is a keyword heuristic over the simulation's own condition strings; it exists to demo rules without a
key and is not a vision model.

---

## 9. Running, building, extending

```bash
npm install --legacy-peer-deps --ignore-scripts   # see note below
npm run dev          # copies WASM runtimes, downloads SAM 3 weights if missing, starts http://localhost:3000
npm run build        # production bundle in dist/
NODE_ENV=production npm start
npm run lint         # tsc --noEmit
npm run models       # re-run the model download only
```

`predev` / `prestart` / `prebuild` run `scripts/copy-ort.mjs` (ORT WASM + ffmpeg core into `public/`) and
`scripts/fetch-models.mjs` (SAM 3 `int8` + `q4f16` from `onnx-community/sam3-tracker-ONNX`). Large files are git-ignored:
`public/ort/`, `public/ffmpeg/`, `public/models/sam3/*.onnx*`.

Install note: `esbuild` is aliased to `esbuild-wasm` because antivirus software was deleting the native `esbuild.exe`
on the development machine. On a machine without that problem you can revert the alias in `package.json`.

### Where to change things

| To change… | Edit |
|---|---|
| What the rules model is told, or its JSON shape | `server.ts` → `/api/evaluate-frame` prompt (and the parsing in `attachTargetBoxes` / `withNormalizedBoxes`) |
| Model names offered in the UI | `MUSE_MODELS` in `server.ts` and `MetaModelEngine` in `src/types.ts` |
| Cross-camera strictness | `MATCH_THRESHOLD`, `MATCH_MARGIN`, `GALLERY_SIZE` in `personRegistry.ts` |
| When a person gets an ID / ghost handling | `MIN_HITS_*`, `MIN_HEIGHT_FOR_ID`, `MIN_POSE_SCORE` in `cameraPipeline.ts`, ghost constants in `personRegistry.ts` |
| Scan frequency | 3200 ms interval in `MultiCameraMatrix.tsx`; `scanIntervalMs` in `FeedViewport.tsx` |
| Segmentation behavior | `samCore.ts` (prompts, mask picking), `samWorker.ts` (backends), budgets in `FeedViewport.tsx` |
| Default rules, cameras, preset packs | `src/utils/defaultRules.ts` |
| Video formats converted | `NATIVE_EXTENSIONS` in `videoConvert.ts` |

---

## 10. Known limitations

* The registry is per page load and in memory. Reloading resets all person IDs.
* Spotlight Feed does not use the shared registry or re-ID; only the Matrix does.
* Re-ID quality depends on camera angle, resolution and clothing; very different viewpoints can split one person into
  two IDs. Ambiguous matches deliberately do not merge.
* Incidents are logged on every scan that reports a violation (no cooldown or de-duplication).
* SAM 3 is heavy: on weak GPUs or CPU-only machines masks may be stale or disabled, and scans fall back to box crops.
* The first run downloads ~800 MB of SAM weights and, for non-MP4 files, a ~32 MB converter.
* Cloud verdict quality depends on the rule wording and on the crops; the model is told to flag only what it can see, so
  occluded evidence (for example a hat hidden by a raised arm) is not flagged.
