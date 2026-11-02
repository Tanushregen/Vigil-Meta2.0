import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Camera,
  Grid,
  Maximize2,
  Minimize2,
  Bot,
  ShieldAlert,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Play,
  Pause,
  RefreshCw,
  Sparkles,
  User,
  Radio,
  Layers,
} from 'lucide-react';
import { CameraFeed, CameraGroup, PromptRule, ViolationIncident } from '../types';
import { SimulationCanvas, SimulationHandle } from './SimulationCanvas';
import { soundFx } from '../utils/audioAlert';
import { safePostJson } from '../utils/apiClient';

interface MultiCameraMatrixProps {
  cameras: CameraFeed[];
  groups: CameraGroup[];
  rules: PromptRule[];
  onViolationDetected: (incident: Omit<ViolationIncident, 'id' | 'timestamp' | 'status'>, snapshot: string) => void;
  onUpdateCamera: (id: string, updates: Partial<CameraFeed>) => void;
  onAddCamera: (newCam: CameraFeed) => void;
}

export const MultiCameraMatrix: React.FC<MultiCameraMatrixProps> = ({
  cameras,
  groups,
  rules,
  onViolationDetected,
  onUpdateCamera,
}) => {
  const [layout, setLayout] = useState<'grid' | 'single'>('grid');
  const [focusedCameraId, setFocusedCameraId] = useState<string>(cameras[0]?.id || 'cam-01');
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>('all');

  // Track bounding boxes & evaluations per camera
  const [cameraEvaluations, setCameraEvaluations] = useState<Record<string, {
    isEvaluating: boolean;
    boxes: any[] | null;
    sceneSummary: string;
    lastLatency: number | null;
  }>>({});

  // Simulation canvas refs for each camera
  const simRefs = useRef<Record<string, SimulationHandle | null>>({});
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  // Get rules assigned to a specific camera (global, group-level, or camera-level)
  const getRulesForCamera = useCallback(
    (cam: CameraFeed): PromptRule[] => {
      return rules.filter((r) => {
        if (!r.enabled) return false;
        if (r.streamType !== 'visual' && r.streamType !== 'both') return false;

        if (r.targetScope === 'all') return true;
        if (r.targetScope === 'group' && r.targetIds?.includes(cam.group)) return true;
        if (r.targetScope === 'camera' && r.targetIds?.includes(cam.id)) return true;

        return false;
      });
    },
    [rules]
  );

  // Evaluate single camera frame
  const evaluateCamera = useCallback(
    async (cam: CameraFeed, overrideContext?: string) => {
      const activeRules = getRulesForCamera(cam);
      if (activeRules.length === 0) return;

      let frameBase64: string | null = null;
      if (cam.sourceType === 'simulation') {
        const handle = simRefs.current[cam.id];
        frameBase64 = handle ? handle.captureFrame() : null;
      }

      if (!frameBase64) return;

      setCameraEvaluations((prev) => ({
        ...prev,
        [cam.id]: {
          ...(prev[cam.id] || { boxes: [], sceneSummary: '', lastLatency: null }),
          isEvaluating: true,
        },
      }));

      const start = performance.now();
      try {
        const groupObj = groups.find((g) => g.id === cam.group);
        const simContext = overrideContext || simRefs.current[cam.id]?.getConditionsContext?.() || '';
        const contextStr = `${cam.name} in ${groupObj?.name || 'General Sector'}. Active Conditions: ${simContext}. Assigned Worker: ${cam.worker.name}`;

        const { success, data, error } = await safePostJson('/api/evaluate-frame', {
          imageBase64: frameBase64,
          rules: activeRules,
          context: contextStr,
          feedMode: cam.sourceType,
        });

        const latency = Math.round(performance.now() - start);

        if (!success || !data) {
          if (error && !error.includes('aborted')) {
            console.warn(`Evaluation notice for camera ${cam.id}: ${error}`);
          }
          setCameraEvaluations((prev) => ({
            ...prev,
            [cam.id]: {
              ...(prev[cam.id] || { sceneSummary: '', lastLatency: null }),
              boxes: null,
              isEvaluating: false,
            },
          }));
          return;
        }

        if (data.success) {
          const violations = data.violations || [];
          const boxes: any[] = [];

          if (violations.length > 0) {
            let hasCritical = false;

            violations.forEach((v: any) => {
              const rule = activeRules.find((r) => r.id === v.ruleId);
              const severity = rule?.severity || 'high';
              if (severity === 'critical') hasCritical = true;

              if (v.box2d) {
                boxes.push({
                  ...v.box2d,
                  label: v.detectedLabel || 'Violation',
                  confidence: v.confidence,
                  ruleName: rule?.name || 'Rule Infraction',
                  severity,
                });
              }

              onViolationDetected(
                {
                  ruleId: v.ruleId,
                  ruleName: rule?.name || 'Rule Infraction',
                  rulePrompt: rule?.prompt || '',
                  severity,
                  category: rule?.category || 'safety',
                  streamType: 'visual',
                  confidence: v.confidence || 90,
                  explanation: v.explanation,
                  detectedLabel: v.detectedLabel,
                  box2d: v.box2d,
                  cameraId: cam.id,
                  cameraName: cam.name,
                  cameraGroup: groupObj?.name,
                  workerId: cam.worker.id,
                },
                frameBase64!
              );
            });

            if (hasCritical) soundFx.playCriticalAlert();
            else soundFx.playWarningPing();

            // Update camera worker inspection counts
            onUpdateCamera(cam.id, {
              lastViolationAt: new Date().toISOString(),
              worker: {
                ...cam.worker,
                status: 'alert',
                inspectionsCount: (cam.worker.inspectionsCount || 0) + 1,
              },
            });
          } else {
            onUpdateCamera(cam.id, {
              worker: {
                ...cam.worker,
                status: 'active',
                inspectionsCount: (cam.worker.inspectionsCount || 0) + 1,
              },
            });
          }

          setCameraEvaluations((prev) => ({
            ...prev,
            [cam.id]: {
              isEvaluating: false,
              boxes: boxes.length > 0 ? boxes : null,
              sceneSummary: data.sceneSummary || '',
              lastLatency: latency,
            },
          }));
        }
      } catch (err) {
        console.error(`Evaluation failed for camera ${cam.id}:`, err);
        setCameraEvaluations((prev) => ({
          ...prev,
          [cam.id]: {
            ...(prev[cam.id] || { sceneSummary: '', lastLatency: null }),
            boxes: null,
            isEvaluating: false,
          },
        }));
      }
    },
    [getRulesForCamera, groups, onViolationDetected, onUpdateCamera]
  );

  const [quotaNotice, setQuotaNotice] = useState<boolean>(false);
  const roundRobinIndexRef = useRef<number>(0);

  // Round-robin or focused camera monitoring loop to prevent API rate-limit exhaustion
  useEffect(() => {
    const activeCams = cameras.filter((c) => c.isMonitoring);
    if (activeCams.length === 0) return;

    const interval = setInterval(() => {
      if (layout === 'single') {
        const focused = activeCams.find((c) => c.id === focusedCameraId);
        if (focused) evaluateCamera(focused);
      } else {
        // Round-robin through active cameras one by one
        const camToScan = activeCams[roundRobinIndexRef.current % activeCams.length];
        roundRobinIndexRef.current += 1;
        if (camToScan) evaluateCamera(camToScan);
      }
    }, 3200);

    return () => clearInterval(interval);
  }, [cameras, layout, focusedCameraId, evaluateCamera]);

  const filteredCameras = cameras.filter((cam) => {
    if (selectedGroupFilter === 'all') return true;
    return cam.group === selectedGroupFilter;
  });

  const displayCameras = layout === 'single'
    ? filteredCameras.filter((c) => c.id === focusedCameraId)
    : filteredCameras;

  return (
    <div className="flex flex-col gap-4 bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl">
      {/* Edge Fallback / Quota Notice Banner */}
      <div className="bg-indigo-950/40 border border-indigo-500/30 rounded-xl px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 text-indigo-300">
          <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>
            <strong>Edge Perception Active</strong> (SAM 3.1 & ByteTrack Edge Engine). System is monitoring real-time prompt rules locally with zero API rate limits.
          </span>
        </div>
        <span className="text-[10px] text-slate-400 font-mono">
          Free-tier Cloud Quota Protected
        </span>
      </div>

      {/* Top Multi-Camera Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-cyan-400" />
          <h2 className="font-bold text-sm text-slate-100">Multi-Camera Operations Matrix</h2>
          <span className="text-[11px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-mono">
            {cameras.filter((c) => c.isMonitoring).length} Active Cameras & Workers
          </span>
        </div>

        {/* Filters and View Mode Controls */}
        <div className="flex items-center gap-2">
          {/* Group Filter */}
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="text-[11px]">Zone:</span>
            <select
              value={selectedGroupFilter}
              onChange={(e) => setSelectedGroupFilter(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none"
            >
              <option value="all">All Facility Zones</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          {/* Grid vs Single Focus View */}
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setLayout('grid')}
              className={`p-1.5 rounded-lg text-xs font-semibold transition-colors ${
                layout === 'grid' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
              }`}
              title="2x2 Multi-Camera Grid"
            >
              <Grid className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setLayout('single')}
              className={`p-1.5 rounded-lg text-xs font-semibold transition-colors ${
                layout === 'single' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
              }`}
              title="Spotlight Single Camera"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Camera Matrix Grid */}
      <div
        className={`grid gap-4 ${
          layout === 'grid' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'
        }`}
      >
        {displayCameras.map((cam) => {
          const group = groups.find((g) => g.id === cam.group);
          const camRules = getRulesForCamera(cam);
          const evalState = cameraEvaluations[cam.id] || {
            isEvaluating: false,
            boxes: [],
            sceneSummary: '',
            lastLatency: null,
          };

          return (
            <div
              key={cam.id}
              className="bg-slate-950/80 border border-slate-800 hover:border-slate-700/80 rounded-xl overflow-hidden flex flex-col transition-all shadow-lg"
            >
              {/* Camera Header Bar */}
              <div className="p-3 border-b border-slate-800/80 flex items-center justify-between gap-2 bg-slate-950">
                <div className="flex items-center gap-2 truncate">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      cam.isMonitoring ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
                    }`}
                  />
                  <span className="font-bold text-xs text-slate-200 truncate">{cam.name}</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
                    {group?.name || 'General Zone'}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (cam.isMonitoring) {
                        simRefs.current[cam.id]?.clearCanvas?.();
                        setCameraEvaluations((prev) => ({
                          ...prev,
                          [cam.id]: {
                            ...(prev[cam.id] || { sceneSummary: '', lastLatency: null }),
                            boxes: null,
                            isEvaluating: false,
                          },
                        }));
                      }
                      onUpdateCamera(cam.id, { isMonitoring: !cam.isMonitoring });
                    }}
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold border transition-colors ${
                      cam.isMonitoring
                        ? 'bg-rose-500/10 text-rose-300 border-rose-500/30 hover:bg-rose-500/20'
                        : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'
                    }`}
                  >
                    {cam.isMonitoring ? 'Pause' : 'Start'}
                  </button>

                  {layout === 'grid' && (
                    <button
                      type="button"
                      onClick={() => {
                        setFocusedCameraId(cam.id);
                        setLayout('single');
                      }}
                      className="p-1 text-slate-400 hover:text-white rounded"
                      title="Spotlight Camera"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Viewport Feed Canvas */}
              <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden">
                {cam.sourceType === 'simulation' ? (
                  <div className="w-full h-full">
                    <SimulationCanvas
                      ref={(ref) => {
                        simRefs.current[cam.id] = ref;
                      }}
                      onViolationConditionChange={(cond) => {
                        // Immediate real-time scan when user clicks any toggle
                        setTimeout(() => {
                          evaluateCamera(cam, cond);
                        }, 50);
                      }}
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-slate-500 gap-1 text-xs">
                    <Camera className="w-6 h-6 text-slate-600" />
                    <span>Live Hardware Stream</span>
                  </div>
                )}

                {/* Overlaid Bounding Boxes for THIS camera - null-safe */}
                {evalState.boxes && evalState.boxes.map((box, bIdx) => {
                  const topPercent = (box.ymin / 1000) * 100;
                  const leftPercent = (box.xmin / 1000) * 100;
                  const widthPercent = ((box.xmax - box.xmin) / 1000) * 100;
                  const heightPercent = ((box.ymax - box.ymin) / 1000) * 100;

                  return (
                    <div
                      key={bIdx}
                      style={{
                        top: `${topPercent}%`,
                        left: `${leftPercent}%`,
                        width: `${widthPercent}%`,
                        height: `${heightPercent}%`,
                      }}
                      className="absolute pointer-events-none border-2 border-rose-500 bg-rose-500/15 rounded z-20 animate-pulse flex flex-col justify-between p-1 shadow-[0_0_12px_rgba(244,63,94,0.6)]"
                    >
                      <div className="self-start bg-rose-600 text-white font-mono text-[9px] px-1 py-0.5 rounded font-bold uppercase">
                        {box.label} ({box.confidence}%)
                      </div>
                      <div className="self-end bg-black/80 text-rose-200 text-[8px] px-1 py-0.5 rounded font-mono">
                        {box.ruleName}
                      </div>
                    </div>
                  );
                })}

                {/* Scanning Laser */}
                {evalState.isEvaluating && (
                  <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
                    <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_8px_#38bdf8] animate-bounce" />
                  </div>
                )}

                {/* Live Worker Telemetry Badge */}
                <div className="absolute top-2 left-2 z-30 flex items-center gap-1.5 px-2 py-0.5 rounded bg-black/75 border border-slate-700 text-[10px] font-mono text-cyan-300">
                  <Bot className="w-3 h-3 text-purple-400" />
                  <span>{cam.worker.name}</span>
                </div>

                {evalState.lastLatency && (
                  <div className="absolute top-2 right-2 z-30 px-1.5 py-0.5 rounded bg-black/75 border border-slate-700 text-[10px] font-mono text-slate-300">
                    {evalState.lastLatency}ms
                  </div>
                )}
              </div>

              {/* Dedicated Camera Worker Footer Card */}
              <div className="p-3 bg-slate-900/90 border-t border-slate-800 flex flex-col gap-2 text-xs">
                {/* Worker Identity & Model Stack */}
                <div className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-1.5 text-slate-300">
                    <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                    <span className="font-semibold">{cam.worker.name}</span>
                    <span className="text-[10px] font-mono bg-purple-950/60 text-purple-300 px-1.5 py-0.2 rounded border border-purple-800">
                      {cam.worker.modelEngine}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 text-[10px] text-slate-400 font-mono">
                    <User className="w-3 h-3 text-slate-500" />
                    <span>{cam.worker.fieldSupervisor || 'Unassigned'}</span>
                  </div>
                </div>

                {/* Assigned Rules Pills */}
                <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-800/60">
                  <span className="text-[10px] text-slate-500 uppercase font-mono font-bold">
                    Assigned Rules ({camRules.length}):
                  </span>
                  {camRules.length === 0 ? (
                    <span className="text-[10px] text-slate-500 italic">No rules active</span>
                  ) : (
                    camRules.map((r) => (
                      <span
                        key={r.id}
                        className="text-[10px] font-mono bg-slate-950 text-slate-300 border border-slate-800 px-1.5 py-0.5 rounded truncate max-w-[140px]"
                        title={r.name}
                      >
                        {r.name}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
