import React from 'react';
import {
  Sparkles,
  Layers,
  Cpu,
  ShieldCheck,
  Eye,
  FileText,
  Activity,
  X,
  CheckCircle2,
  ExternalLink,
  Bot,
} from 'lucide-react';

interface MetaArchitectureModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MetaArchitectureModal: React.FC<MetaArchitectureModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in">
      <div className="relative w-full max-w-4xl bg-slate-900 border border-indigo-500/40 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center shadow-md shadow-indigo-500/30">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-white flex items-center gap-2">
                Meta AI Developer Hackathon Architecture
                <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 px-2 py-0.5 rounded-full font-mono uppercase">
                  Meta Model API Spec
                </span>
              </h2>
              <p className="text-[11px] text-slate-400">
                Multi-Camera Multi-Worker Topology using YOLOv8-Pose, SAM 3 & Muse Spark
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-6 text-xs text-slate-300">
          {/* Executive Architecture Overview */}
          <div className="p-4 rounded-xl bg-indigo-950/30 border border-indigo-500/30">
            <h3 className="font-bold text-sm text-indigo-200 mb-1 flex items-center gap-2">
              <Bot className="w-4 h-4 text-indigo-400" />
              Dedicated Agent Worker Pattern for Multi-Camera Surveillance
            </h3>
            <p className="text-slate-300 leading-relaxed text-[11px]">
              Instead of bottlenecking multiple camera feeds into a single monolithic API call, SentinelPrompt deploys an autonomous <strong>Dedicated AI Worker</strong> for every individual camera. Each worker is powered by <strong>Meta's Model API stack</strong>, running in-browser YOLO detection and pose estimation, ByteTrack tracking, segmentation via <strong>SAM 3</strong>, and rule reasoning via <strong>Muse Spark</strong>.
            </p>
          </div>

          {/* Grid of Meta Models in SentinelPrompt */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Model 1: SAM 3 */}
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4 text-cyan-400" />
                    <span className="font-bold text-sm text-slate-100">Meta SAM 3</span>
                  </div>
                  <span className="text-[10px] font-mono bg-cyan-950/60 text-cyan-300 border border-cyan-800 px-2 py-0.5 rounded">
                    Perception & Tracking
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
                  Meta's <strong>Segment Anything Model 3</strong> turns each tracked person into a pixel mask, prompted by the person's box plus click points from their pose keypoints. It runs in the browser (WebGPU or CPU).
                </p>
                <div className="space-y-1.5 font-mono text-[10px] text-slate-300 bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                  <div className="text-cyan-300">✓ Box + keypoint prompted person masks</div>
                  <div className="text-cyan-300">✓ Background-removed crops for the rules model</div>
                  <div className="text-cyan-300">✓ Negative points separate overlapping people</div>
                  <div className="text-cyan-300">✓ Silhouette overlay refits to each track</div>
                </div>
              </div>
            </div>

            {/* Model 2: Muse Spark */}
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-purple-400" />
                    <span className="font-bold text-sm text-slate-100">Meta Muse Spark</span>
                  </div>
                  <span className="text-[10px] font-mono bg-purple-950/60 text-purple-300 border border-purple-800 px-2 py-0.5 rounded">
                    Agentic Worker Brain
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
                  Judges every active prompt rule against the full frame plus one background-removed crop per tracked person, through the Meta Model API. It returns violations with confidence, rationale and the target's ID.
                </p>
                <div className="space-y-1.5 font-mono text-[10px] text-slate-300 bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                  <div className="text-purple-300">✓ Natural language rules, no retraining</div>
                  <div className="text-purple-300">✓ Per-person verdicts tied to track IDs</div>
                  <div className="text-purple-300">✓ Selectable Muse Spark 1.1 / 1.2 / 1.3</div>
                </div>
              </div>
            </div>

            {/* Model 3: YOLO detectors */}
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-emerald-400" />
                    <span className="font-bold text-sm text-slate-100">YOLOv8-Pose + YOLOv10</span>
                  </div>
                  <span className="text-[10px] font-mono bg-emerald-950/60 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded">
                    Detection & Pose
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
                  Run locally on every video frame. YOLOv8-Pose finds each person with 17 body keypoints, and YOLOv10 spots objects such as phones and bags.
                </p>
                <div className="space-y-1.5 font-mono text-[10px] text-slate-300 bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                  <div className="text-emerald-300">✓ Real keypoints: shoulders, elbows, hips, knees</div>
                  <div className="text-emerald-300">✓ ByteTrack persistent IDs, trails and posture</div>
                  <div className="text-emerald-300">✓ WebGPU with CPU fallback, no API calls</div>
                </div>
              </div>
            </div>

            {/* Model 4: Rule compiler */}
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-amber-400" />
                    <span className="font-bold text-sm text-slate-100">Muse Spark Rule Compiler</span>
                  </div>
                  <span className="text-[10px] font-mono bg-amber-950/60 text-amber-300 border border-amber-800 px-2 py-0.5 rounded">
                    Policy Authoring
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
                  The <strong>AI Rule Synthesizer</strong> turns a plain-language scenario into ready-to-use visual rules with severity and category, generated by Muse Spark.
                </p>
                <div className="space-y-1.5 font-mono text-[10px] text-slate-300 bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                  <div className="text-amber-300">✓ Scenario description to rule set</div>
                  <div className="text-amber-300">✓ Severity and category suggested per rule</div>
                  <div className="text-amber-300">✓ Preset packs for PPE, proctoring, hygiene</div>
                </div>
              </div>
            </div>
          </div>

          {/* Camera-to-Rule Mapping Flow Diagram */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
            <h4 className="font-bold text-slate-200 text-xs mb-2">
              Multi-Camera Scoping Matrix (How Rules Bind to Cameras & Groups):
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px]">
              <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                <span className="font-bold text-amber-400 block mb-1">Global Scope:</span>
                <p className="text-slate-400 text-[10px]">
                  Applied across ALL cameras uniformly (e.g. "Distracted phone usage anywhere in the facility").
                </p>
              </div>

              <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                <span className="font-bold text-cyan-400 block mb-1">Zone / Group Scope:</span>
                <p className="text-slate-400 text-[10px]">
                  Applied to all cameras assigned to a specific Zone (e.g. Scaffolding Group = "Hardhat + Harness Mandatory").
                </p>
              </div>

              <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                <span className="font-bold text-rose-400 block mb-1">Camera-Specific Scope:</span>
                <p className="text-slate-400 text-[10px]">
                  Bound to an individual camera feed only (e.g. Camera 02 Exam Hall = "Chair Vacant / Screen Abandonment").
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Meets Meta AI Hackathon 20%+ Model Requirement (Exceeds 70% Meta Stack)</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-indigo-500 hover:bg-indigo-400 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-500/20 cursor-pointer"
          >
            Close Spec
          </button>
        </div>
      </div>
    </div>
  );
};
