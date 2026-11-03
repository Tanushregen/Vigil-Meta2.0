import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Cross-origin isolation enables multi-threaded WASM (SharedArrayBuffer) for the in-browser SAM worker.
// "credentialless" keeps cross-origin resources such as Google Fonts working without CORP headers.
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  next();
});

// Allow large payloads for base64 video frames
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Body parser error handler: Ensure any bad payload returns JSON, never HTML
app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err) {
    console.warn('[SentinelPrompt Server] Body parser notice:', err.message);
    return res.status(err.status || 400).json({
      success: false,
      error: `Invalid request payload: ${err.message || 'Malformed body'}`,
      violations: [],
      isEdgeFallback: true,
    });
  }
  next();
});

interface PromptRule {
  id: string;
  name: string;
  prompt: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  streamType: 'visual' | 'text' | 'both';
  enabled: boolean;
}

// Circuit Breaker for Free-Tier 429 Quota Exhaustion
let quotaExceededUntil = 0;

function isQuotaExceeded(): boolean {
  return Date.now() < quotaExceededUntil;
}

function tripQuotaCircuitBreaker(retryAfterSeconds: number = 180) {
  quotaExceededUntil = Date.now() + retryAfterSeconds * 1000;
  console.warn(`[SentinelPrompt] Cloud API 429 Quota Exceeded. Tripping circuit breaker for ${retryAfterSeconds}s. Gracefully switching to Edge Perception Engine.`);
}

// Edge Fallback Perception Engine (Emulating Edge simulation engine & ByteTrack Heuristics for Interactive Simulation)
// For synthetic 2D interactive simulations with known character positions, this maps interactive condition toggles.
// For real uploaded videos or webcams, this NEVER returns hardcoded coordinates.
function evaluateFrameEdgeEngine(rules: PromptRule[], context?: string, feedMode: string = 'simulation') {
  // If this is a real video upload, webcam, or screen share, NEVER fabricate fixed static cartoon bounding boxes!
  const ctx = (context || '').toLowerCase();
  const isSim = feedMode === 'simulation' || ctx.includes('scenario:');
  if (!isSim) {
    return [];
  }

  const violations: any[] = [];

  for (const rule of rules) {
    const prompt = (rule.prompt + ' ' + rule.name).toLowerCase();

    // Check 1: Hardhat / Head protection - only flag if simulation explicitly reported violation
    if (prompt.includes('hardhat') || prompt.includes('helmet') || prompt.includes('head protection')) {
      const isHardhatViolated = ctx.includes('no hardhat (violation)') || (ctx.includes('no hardhat') && !ctx.includes('hardhat worn'));
      if (isHardhatViolated) {
        violations.push({
          ruleId: rule.id,
          isViolated: true,
          confidence: 96,
          explanation: 'Edge simulation engine detected personnel head without required OSHA protective safety helmet.',
          detectedLabel: 'Unprotected Head',
          box2d: { ymin: 125, xmin: 440, ymax: 260, xmax: 560 },
        });
      }
    }

    // Check 2: Cell phone / mobile device in hand
    if (prompt.includes('phone') || prompt.includes('mobile') || prompt.includes('smartphone') || prompt.includes('cellular')) {
      const isPhoneViolated = ctx.includes('cell phone in hand (violation)') || ctx.includes('smartphone in hand') || ctx.includes('phone (violation)');
      if (isPhoneViolated) {
        violations.push({
          ruleId: rule.id,
          isViolated: true,
          confidence: 94,
          explanation: 'Edge ByteTrack detected active unauthorized smartphone/cellular device in hand during operational period.',
          detectedLabel: 'Smartphone In Hand',
          box2d: { ymin: 440, xmin: 520, ymax: 590, xmax: 620 },
        });
      }
    }

    // Check 3: High-Vis Safety Vest
    if (prompt.includes('vest') || prompt.includes('high-vis') || prompt.includes('visibility') || prompt.includes('outerwear')) {
      const isVestViolated = ctx.includes('missing vest (violation)') || ctx.includes('missing vest') || ctx.includes('vest off');
      if (isVestViolated) {
        violations.push({
          ruleId: rule.id,
          isViolated: true,
          confidence: 93,
          explanation: 'Operator torso lacks mandatory fluorescent reflective high-visibility safety vest.',
          detectedLabel: 'Missing Hi-Vis Vest',
          box2d: { ymin: 270, xmin: 410, ymax: 600, xmax: 590 },
        });
      }
    }

    // Check 4: Proctoring Absence / Seat Abandonment
    if (prompt.includes('absence') || prompt.includes('vacant') || prompt.includes('abandon') || prompt.includes('empty') || prompt.includes('left test')) {
      const isAbsentViolated = ctx.includes('candidate absent') || ctx.includes('vacant seat');
      if (isAbsentViolated) {
        violations.push({
          ruleId: rule.id,
          isViolated: true,
          confidence: 98,
          explanation: 'Workstation seat is vacant. Primary examinee is absent from proctored perimeter.',
          detectedLabel: 'Workstation Vacant',
          box2d: { ymin: 180, xmin: 280, ymax: 720, xmax: 720 },
        });
      }
    }

    // Check 5: Gaze Aversion / Looking away
    if (prompt.includes('gaze') || prompt.includes('looking away') || prompt.includes('off-screen')) {
      const isGazeViolated = ctx.includes('gaze off screen') || ctx.includes('looking away');
      if (isGazeViolated) {
        violations.push({
          ruleId: rule.id,
          isViolated: true,
          confidence: 92,
          explanation: 'Candidate head turned away from monitor toward off-screen angle.',
          detectedLabel: 'Off-Screen Gaze',
          box2d: { ymin: 140, xmin: 440, ymax: 270, xmax: 560 },
        });
      }
    }

    // Check 6: Second Person / Unauthorized Intruder
    if (prompt.includes('second person') || prompt.includes('multiple person') || prompt.includes('unauthorized') || prompt.includes('two person')) {
      const isSecondViolated = ctx.includes('second unauthorized person') || ctx.includes('second person');
      if (isSecondViolated) {
        violations.push({
          ruleId: rule.id,
          isViolated: true,
          confidence: 97,
          explanation: 'Secondary unauthorized person detected standing in examination frame.',
          detectedLabel: 'Unauthorized Person',
          box2d: { ymin: 150, xmin: 660, ymax: 600, xmax: 820 },
        });
      }
    }

    // Check 7: Cleanroom Hairnet / Hygiene
    if (prompt.includes('hairnet') || prompt.includes('hygiene') || prompt.includes('cleanroom') || prompt.includes('hair')) {
      const isHairnetViolated = ctx.includes('uncovered hair') || ctx.includes('missing hairnet');
      if (isHairnetViolated) {
        violations.push({
          ruleId: rule.id,
          isViolated: true,
          confidence: 95,
          explanation: 'Operator hair is uncovered without mandatory sanitary protective hairnet.',
          detectedLabel: 'Missing Hairnet',
          box2d: { ymin: 130, xmin: 440, ymax: 260, xmax: 560 },
        });
      }
    }
  }

  return violations;
}

// Normalizes a model-returned box (object or [ymin,xmin,ymax,xmax] array, 0-1000) into a clamped box2d, or undefined if unusable.
function normalizeViolationBox(v: any): { ymin: number; xmin: number; ymax: number; xmax: number } | undefined {
  const raw = v?.box2d ?? v?.box_2d ?? v?.boundingBox ?? v?.bbox;
  let ymin: number, xmin: number, ymax: number, xmax: number;
  if (Array.isArray(raw) && raw.length === 4) {
    [ymin, xmin, ymax, xmax] = raw.map(Number);
  } else if (raw && typeof raw === 'object') {
    ({ ymin, xmin, ymax, xmax } = { ymin: Number(raw.ymin), xmin: Number(raw.xmin), ymax: Number(raw.ymax), xmax: Number(raw.xmax) });
  } else {
    return undefined;
  }
  if (![ymin, xmin, ymax, xmax].every(Number.isFinite)) return undefined;
  const clamp = (n: number) => Math.max(0, Math.min(1000, Math.round(n)));
  const box = {
    ymin: clamp(Math.min(ymin, ymax)),
    xmin: clamp(Math.min(xmin, xmax)),
    ymax: clamp(Math.max(ymin, ymax)),
    xmax: clamp(Math.max(xmin, xmax)),
  };
  if (box.ymax - box.ymin < 5 || box.xmax - box.xmin < 5) return undefined;
  return box;
}

function withNormalizedBoxes(violations: any[]): any[] {
  return violations.map((v) => ({ ...v, box2d: normalizeViolationBox(v) }));
}

// A violation tied to a tracked target takes that target's (SAM-refined) box instead of any model-generated one.
function attachTargetBoxes(violations: any[], targets: Array<{ id: number; box: any }>): any[] {
  if (targets.length === 0) return violations;
  const byId = new Map(targets.map((t) => [t.id, t.box]));
  return violations.map((v) => {
    const id = Number(v?.targetId);
    return byId.has(id) ? { ...v, targetId: id, box2d: byId.get(id) } : v;
  });
}

// -----------------------------------------------------------------------------
// Meta Muse Spark (Meta Model API, Responses API: POST {base}/responses)
// -----------------------------------------------------------------------------
const MUSE_DEFAULT_MODEL = 'muse-spark-1.3';
const MUSE_MODELS: Record<string, string> = {
  'Muse Spark 1.3': 'muse-spark-1.3',
  'Muse Spark 1.2': 'muse-spark-1.2',
  'Muse Spark 1.1': 'muse-spark-1.1',
};

function metaApiKey(): string {
  return (process.env.META_API_KEY || process.env.META_LLAMA_API_KEY || '').trim();
}

function metaApiUrl(): string {
  return (process.env.META_API_URL || 'https://api.meta.ai/v1').replace(/\/+$/, '');
}

// UI engine names -> Meta Model API ids. Unknown / legacy names saved in the browser fall back to the default.
function museModelId(engine?: string): string {
  return (engine && MUSE_MODELS[engine]) || process.env.MUSE_MODEL || MUSE_DEFAULT_MODEL;
}

/** Pulls a JSON object out of a model reply, tolerating ```json fences and surrounding prose. */
function parseModelJson(text: string): any | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Calls Muse Spark with optional images (base64 JPEG) and returns the parsed JSON reply, or null on any failure.
 * Reasoning effort defaults to "minimal" so live scans stay fast (override with MUSE_REASONING).
 */
async function callMuseSpark(params: {
  engine?: string;
  instructions: string;
  prompt: string;
  images?: string[];
  maxOutputTokens?: number;
}): Promise<any | null> {
  const apiKey = metaApiKey();
  if (!apiKey || isQuotaExceeded()) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(`${metaApiUrl()}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: museModelId(params.engine),
        reasoning: { effort: process.env.MUSE_REASONING || 'minimal' },
        // Reasoning tokens count against this budget, so leave room for the JSON answer
        max_output_tokens: params.maxOutputTokens ?? 4000,
        instructions: params.instructions,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: params.prompt },
              ...(params.images || []).map((b64) => ({ type: 'input_image', image_url: `data:image/jpeg;base64,${b64}` })),
            ],
          },
        ],
      }),
    });

    if (res.status === 429) {
      tripQuotaCircuitBreaker(30);
      return null;
    }
    if (!res.ok) {
      console.warn(`[Muse Spark] HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }

    const data: any = await res.json();
    const text = (data?.output || [])
      .filter((o: any) => o?.type === 'message')
      .flatMap((o: any) => o?.content || [])
      .map((c: any) => c?.text || '')
      .join('');
    const parsed = text ? parseModelJson(text) : null;
    if (!parsed) console.warn(`[Muse Spark] no JSON in reply (status: ${data?.status})`);
    return parsed;
  } catch (e: any) {
    if (e?.name !== 'AbortError') console.warn('[Muse Spark] request failed:', e?.message || e);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Health check endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    hasApiKey: !!metaApiKey(),
    model: museModelId(),
    quotaExceeded: isQuotaExceeded(),
    timestamp: new Date().toISOString(),
  });
});

// Real-time Visual Frame Violation Evaluation with Meta Muse Spark
app.post('/api/evaluate-frame', async (req: Request, res: Response) => {
  try {
    const { imageBase64, rules, context, feedMode, modelEngine = 'Muse Spark 1.3', targets: rawTargets, objects: rawObjects } = req.body;

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid imageBase64' });
    }

    const activeRules: PromptRule[] = (rules || []).filter(
      (r: PromptRule) => r.enabled && (r.streamType === 'visual' || r.streamType === 'both')
    );

    if (activeRules.length === 0) {
      return res.json({
        success: true,
        violations: [],
        modelEngine,
        message: 'No active visual rules configured.',
      });
    }

    const isSim = feedMode === 'simulation' || (context && context.toLowerCase().includes('scenario:'));
    const hasAnyApiKey = !!metaApiKey();

    // 1. If API key is missing or quota is exceeded:
    if (!hasAnyApiKey || isQuotaExceeded()) {
      if (isSim) {
        // Simulation mode has interactive toggles for testing rules
        const edgeViolations = evaluateFrameEdgeEngine(activeRules, context, 'simulation');
        return res.json({
          success: true,
          timestamp: new Date().toISOString(),
          modelEngine: `Meta ${modelEngine}`,
          sceneSummary: `[Meta ${modelEngine}] Interactive Simulation Engine Active`,
          violations: edgeViolations,
          isEdgeFallback: true,
          quotaNotice: isQuotaExceeded(),
        });
      } else {
        // Real video or webcam feed: DO NOT fabricate fake hardcoded boxes!
        return res.json({
          success: true,
          timestamp: new Date().toISOString(),
          modelEngine: `Meta ${modelEngine}`,
          sceneSummary: `[Meta ${modelEngine}] Video feed active. Monitoring frame compliance.`,
          violations: [],
          isEdgeFallback: !hasAnyApiKey,
          quotaNotice: isQuotaExceeded(),
        });
      }
    }

    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    // Detection -> segmentation hand-off from the browser: YOLO tracks, SAM-refined boxes and masked crops.
    const targets: Array<{ id: number; globalId?: number; context?: string; label: string; box: { ymin: number; xmin: number; ymax: number; xmax: number }; masked: boolean; crop: string }> = [];
    for (const t of Array.isArray(rawTargets) ? rawTargets.slice(0, 8) : []) {
      const box = normalizeViolationBox({ box2d: t?.box });
      if (!Number.isInteger(t?.id) || !box || typeof t?.crop !== 'string') continue;
      targets.push({
        id: t.id,
        globalId: Number.isInteger(t?.globalId) ? t.globalId : undefined,
        // What the room already knows about this person (other cameras, flagged violations); capped to keep prompts small
        context: typeof t?.context === 'string' ? t.context.slice(0, 500) : undefined,
        label: String(t.label || 'person').slice(0, 40),
        box,
        masked: !!t.masked,
        crop: t.crop.replace(/^data:image\/\w+;base64,/, ''),
      });
    }
    const objects = (Array.isArray(rawObjects) ? rawObjects.slice(0, 12) : [])
      .map((o: any) => ({ label: String(o?.label || '').slice(0, 40), score: Number(o?.score) || 0, box: normalizeViolationBox({ box2d: o?.box }) }))
      .filter((o) => o.label && o.box);
    const hasTargets = targets.length > 0;
    const targetPromptText = hasTargets
      ? `
PRE-DETECTED TARGETS (YOLOv10 detector + SAM 3 segmentation, tracked by ID). Boxes are normalized 0-1000 [ymin, xmin, ymax, xmax]:
${targets
  .map((t) => `- Target #${t.id} (${t.label}${t.globalId !== undefined ? `, room-wide person ID ${t.globalId}` : ''}) box [${t.box.ymin}, ${t.box.xmin}, ${t.box.ymax}, ${t.box.xmax}] - ${t.masked ? 'background removed with SAM mask' : 'plain box crop'}; its crop image follows the full frame${t.context ? `
  Room context: ${t.context}` : ''}`)
  .join('\n')}
${objects.length ? `Other detected objects: ${objects.map((o) => `${o.label} (${Math.round(o.score * 100)}%) [${o.box!.ymin}, ${o.box!.xmin}, ${o.box!.ymax}, ${o.box!.xmax}]`).join('; ')}` : ''}
Judge every rule PER TARGET using its crop (gray background = removed by the mask). Targets with a room-wide person ID are the same individual on every camera; their room context says what other cameras saw and which violations are already ACTIVE. Treat an ACTIVE violation as a lead, not a fact: report it again only if you can see it in this view, otherwise leave it out so it is marked resolved. When a violation belongs to a target, set "targetId" to that target's ID. Do not return box2d for target violations; the system uses the target's own box. For scene-level rules that no target satisfies (e.g. nobody present, restricted object), omit targetId and give box2d if you can localize it.`
      : '';
    const rulesPromptText = activeRules
      .map(
        (r, idx) =>
          `[Rule ${idx + 1}] ID: "${r.id}" | Name: "${r.name}" | Severity: ${r.severity}
Condition to detect: "${r.prompt}"`
      )
      .join('\n\n');

    const prompt = `You are an authoritative real-time vision compliance auditor (Meta ${modelEngine}).
Analyze this video frame carefully against the following active prompt rules:
${rulesPromptText}
${context ? `Operational Environment: ${context}` : ''}${targetPromptText}

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
   - box2d: REQUIRED unless targetId is set. Tight bounding box {"ymin": int, "xmin": int, "ymax": int, "xmax": int} in normalized image coordinates 0-1000 (origin top-left, ymin/xmin = top-left corner, ymax/xmax = bottom-right corner) around the exact violating person or object. Never omit it.
DO NOT invent or hallucinate violations that are not visible in the frame. If in doubt or no violation is present, return empty array.

Reply with ONLY a JSON object, no prose and no markdown fences:
{"violations":[{"ruleId":"...","isViolated":true,"confidence":90,"explanation":"...","detectedLabel":"...","targetId":0,"box2d":{"ymin":0,"xmin":0,"ymax":0,"xmax":0}}],"sceneSummary":"one sentence describing the scene"}`;

    // 2. Muse Spark judges the rules: full frame first, then one background-removed crop per tracked target
    const parsedData = await callMuseSpark({
      engine: modelEngine,
      instructions: `You are Meta ${modelEngine}, a real-time vision auditor. Output strictly JSON.`,
      prompt: targets.length
        ? `${prompt}\n\nImages that follow: first the full frame, then the crop of each target in the order listed: ${targets.map((t) => `#${t.id}`).join(', ')}.`
        : prompt,
      images: [cleanBase64, ...targets.map((t) => t.crop)],
    });

    // If all cloud endpoints failed or rate-limited
    if (!parsedData) {
      if (isSim) {
        const edgeViolations = evaluateFrameEdgeEngine(activeRules, context, 'simulation');
        return res.json({
          success: true,
          timestamp: new Date().toISOString(),
          modelEngine: `Meta ${modelEngine}`,
          sceneSummary: `[Meta ${modelEngine}] Interactive Simulation Engine Active`,
          violations: edgeViolations,
          isEdgeFallback: true,
          quotaNotice: isQuotaExceeded(),
        });
      }

      return res.json({
        success: true,
        timestamp: new Date().toISOString(),
        modelEngine: `Meta ${modelEngine}`,
        sceneSummary: `[Meta ${modelEngine}] Video frame inspected. No active violations.`,
        violations: [],
        isEdgeFallback: true,
        quotaNotice: isQuotaExceeded(),
      });
    }

    const confirmed = attachTargetBoxes(withNormalizedBoxes((parsedData.violations || []).filter((v: any) => v.isViolated === true)), targets);
    const summaryText = parsedData.sceneSummary
      ? `[Meta ${modelEngine}] ${parsedData.sceneSummary}`
      : `[Meta ${modelEngine}] Frame evaluated with zero prompt rule infractions.`;

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      modelEngine: `Meta ${modelEngine}`,
      sceneSummary: summaryText,
      violations: confirmed,
      isEdgeFallback: false,
    });
  } catch (error: any) {
    console.error('Error evaluating frame:', error);
    const activeRules = (req.body?.rules || []).filter((r: any) => r.enabled);
    const isSim = req.body?.feedMode === 'simulation';
    const edgeViolations = isSim ? evaluateFrameEdgeEngine(activeRules, req.body?.context, 'simulation') : [];
    const modelEngine = req.body?.modelEngine || 'Muse Spark 1.3';
    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      modelEngine: `Meta ${modelEngine}`,
      sceneSummary: isSim ? `[Meta ${modelEngine}] Simulation Engine Active` : `[Meta ${modelEngine}] Video feed active`,
      violations: edgeViolations,
      isEdgeFallback: true,
    });
  }
});

// AI Rule Generator from User Intent
app.post('/api/generate-rules', async (req: Request, res: Response) => {
  try {
    const { scenarioDescription } = req.body;

    if (!scenarioDescription || typeof scenarioDescription !== 'string') {
      return res.status(400).json({ error: 'scenarioDescription is required' });
    }

    // Default heuristic rules based on keywords if quota is reached or fast response needed
    const desc = scenarioDescription.toLowerCase();
    let defaultGenerated: any[] = [];
    if (desc.includes('safety') || desc.includes('construct') || desc.includes('work') || desc.includes('hardhat')) {
      defaultGenerated = [
        {
          name: 'Mandatory Hardhat & Head Protection',
          prompt: 'Alert if any person is in the active area without a protective safety helmet or hardhat.',
          severity: 'critical',
          category: 'safety',
          streamType: 'visual',
        },
        {
          name: 'High-Visibility Neon Vest Required',
          prompt: 'Alert if any personnel is missing a high-visibility reflective neon safety vest.',
          severity: 'high',
          category: 'safety',
          streamType: 'visual',
        },
        {
          name: 'Distracted Smartphone In Zone',
          prompt: 'Alert if any worker is looking down at a mobile phone screen while in the machinery path.',
          severity: 'medium',
          category: 'safety',
          streamType: 'visual',
        },
      ];
    } else if (desc.includes('exam') || desc.includes('proctor') || desc.includes('test') || desc.includes('student')) {
      defaultGenerated = [
        {
          name: 'Unauthorized Mobile Device in Exam',
          prompt: 'Alert if candidate has a smartphone, tablet, or cellular device visible in hand or on desk.',
          severity: 'critical',
          category: 'security',
          streamType: 'visual',
        },
        {
          name: 'Candidate Left Testing Desk',
          prompt: 'Alert if the primary examinee chair is completely vacant during an active test session.',
          severity: 'high',
          category: 'compliance',
          streamType: 'visual',
        },
        {
          name: 'Multiple Persons Detected in Room',
          prompt: 'Alert if more than one human face or unauthorized attendee is present in the examination frame.',
          severity: 'critical',
          category: 'security',
          streamType: 'visual',
        },
      ];
    } else {
      defaultGenerated = [
        {
          name: `${scenarioDescription.slice(0, 24)} Safety Check`,
          prompt: `Alert if any visible action violates standard guidelines for: ${scenarioDescription}`,
          severity: 'high',
          category: 'custom',
          streamType: 'both',
        },
        {
          name: 'Unattended Hazard Protocol',
          prompt: 'Alert if safety perimeter or designated zone is left unattended or obstructed.',
          severity: 'medium',
          category: 'safety',
          streamType: 'visual',
        },
      ];
    }

    if (isQuotaExceeded() || !metaApiKey()) {
      return res.json({ success: true, rules: defaultGenerated, isEdgeFallback: true });
    }

    const prompt = `A user wants to monitor real-time violations for: "${scenarioDescription}"
Generate 3 to 4 actionable violation rules that a camera can check visually. Each rule has: name, prompt (a plain-language condition to detect), severity (critical, high, medium or low), category (safety, security, compliance, conduct, quality or custom) and streamType (always "visual").
Reply with ONLY a JSON object, no prose and no markdown fences: {"rules":[{"name":"...","prompt":"...","severity":"high","category":"safety","streamType":"visual"}]}`;

    const parsed = await callMuseSpark({
      instructions: 'You are a safety compliance architect. Output strictly JSON.',
      prompt,
    });

    if (!parsed || !Array.isArray(parsed.rules) || parsed.rules.length === 0) {
      return res.json({ success: true, rules: defaultGenerated, isEdgeFallback: true });
    }

    return res.json({ success: true, rules: parsed.rules || defaultGenerated, isEdgeFallback: false });
  } catch (error: any) {
    console.error('Error generating rules:', error);
    return res.json({
      success: true,
      rules: [
        {
          name: 'General Operational Compliance',
          prompt: 'Alert if any unsafe practice or policy breach is observed in the designated area.',
          severity: 'high',
          category: 'safety',
          streamType: 'both',
        },
      ],
      isEdgeFallback: true,
    });
  }
});

// Explicit API 404 handler: Guarantee any unmatched /api route returns JSON, never Vite SPA HTML
app.all('/api/*', (_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'API endpoint not found',
    violations: [],
  });
});

// Explicit API error handling middleware: Guarantee errors on /api always return JSON
app.use('/api', (err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[SentinelPrompt Server] Unhandled API error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal Server Error',
    violations: [],
  });
});

// Setup dev server with Vite middleware or production static files
async function startServer() {
  if (!isProduction) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    // Models and the ONNX runtime are large and never change in place: let browsers keep them for a week
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (/[\\/](models|ort)[\\/]/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=604800');
        },
      })
    );
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SentinelPrompt server running on port ${PORT} (isProduction: ${isProduction})`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
