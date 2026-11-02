import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Camera,
  Monitor,
  Play,
  Pause,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  Upload,
  Radio,
  Sliders,
  FileVideo,
  X,
  Cpu,
  Activity,
  Users,
  Footprints,
  ShieldCheck,
} from 'lucide-react';
import {
  PromptRule,
  ViolationIncident,
  FeedMode,
  BoundingBox,
  MetaModelEngine,
  TrackedPerson,
  TrackingSettings,
} from '../types';
import { soundFx } from '../utils/audioAlert';
import { SimulationCanvas, SimulationHandle } from './SimulationCanvas';
import { safePostJson } from '../utils/apiClient';
import { ByteTracker, getTrackColor } from '../utils/byteTrack';
import { estimateYoloPose, SKELETON_PAIRS, KEYPOINT_COLORS } from '../utils/yoloPose';

interface FeedViewportProps {
  rules: PromptRule[];
  onViolationDetected: (incident: Omit<ViolationIncident, 'id' | 'timestamp' | 'status'>, snapshot: string) => void;
  isMonitoring: boolean;
  onToggleMonitoring: () => void;
  operationalContext?: string;
}

interface ActiveBox extends BoundingBox {
  ruleName: string;
  severity: string;
  confidence: number;
}

export const FeedViewport: React.FC<FeedViewportProps> = ({
  rules,
  onViolationDetected,
  isMonitoring,
  onToggleMonitoring,
  operationalContext,
}) => {
  const [feedMode, setFeedMode] = useState<FeedMode>('simulation');
  const [scanIntervalMs, setScanIntervalMs] = useState<number>(3000); // 3 seconds default
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);
  const [lastScanLatency, setLastScanLatency] = useState<number | null>(null);

  // Meta model engine selection: Meta Llama 3.2 Vision, Meta Muse Spark, Meta SAM 3.1
  const [selectedModel, setSelectedModel] = useState<MetaModelEngine>('Llama 3.2 Vision');

  // Bounding box coordinates explicitly nullable to represent reset/null state
  const [activeBoundingBoxes, setActiveBoundingBoxes] = useState<ActiveBox[] | null>(null);
  const [sceneSummary, setSceneSummary] = useState<string>('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [streamNotice, setStreamNotice] = useState<string | null>(null);
  const [, setLastFrameSnapshot] = useState<string | null>(null);
  const [, setConsecutiveViolations] = useState<number>(0);

  // Video file upload state
  const [videoFileUrl, setVideoFileUrl] = useState<string | null>(null);
  const [videoFileName, setVideoFileName] = useState<string | null>(null);
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number } | null>(null);

  // ---------------------------------------------------------------------------
  // YOLO-Pose & ByteTrack Tracking State & Controls
  // ---------------------------------------------------------------------------
  const [trackingSettings, setTrackingSettings] = useState<TrackingSettings>({
    showPoseSkeleton: true,
    showByteTrackIds: true,
    showTrajectoryTrails: true,
    showErgonomicsBadge: true,
    minDetectionConfidence: 0.4,
  });

  const [trackedPeople, setTrackedPeople] = useState<TrackedPerson[]>([]);

  // Video and stream refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const simulationRef = useRef<SimulationHandle | null>(null);
  const hiddenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const trackingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scanTimerRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const viewportContainerRef = useRef<HTMLDivElement | null>(null);

  // Persistent ByteTracker instance
  const byteTrackerRef = useRef<ByteTracker>(new ByteTracker(0.4, 0.25, 30));
  const trackingAnimRef = useRef<number | null>(null);

  // Session & abort tracking to prevent race conditions from in-flight evaluations
  const sourceSessionIdRef = useRef<number>(Date.now());
  const abortControllerRef = useRef<AbortController | null>(null);

  // Stop current active media stream
  const stopCurrentStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  /**
   * Explicitly clears canvas state, resets ByteTrack tracker, and resets bounding boxes to null.
   * This is called whenever a new video source is selected or a file is uploaded.
   */
  const clearActiveCanvasAndOverlays = useCallback(() => {
    // 1. Invalidate any in-flight requests and abort ongoing fetch
    sourceSessionIdRef.current = Date.now();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // 2. Explicitly clear the hidden processing canvas buffer and zero dimensions
    if (hiddenCanvasRef.current) {
      const ctx = hiddenCanvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, hiddenCanvasRef.current.width, hiddenCanvasRef.current.height);
      }
      hiddenCanvasRef.current.width = 0;
      hiddenCanvasRef.current.height = 0;
    }

    // 3. Clear simulation canvas if switching away from simulation
    if (simulationRef.current?.clearCanvas) {
      simulationRef.current.clearCanvas();
    }

    // 4. Reset ByteTrack and clear tracking canvas
    byteTrackerRef.current.reset();
    setTrackedPeople([]);
    if (trackingCanvasRef.current) {
      const tCtx = trackingCanvasRef.current.getContext('2d');
      if (tCtx) {
        tCtx.clearRect(0, 0, trackingCanvasRef.current.width, trackingCanvasRef.current.height);
      }
    }

    // 5. Explicitly reset bounding box coordinates to null
    setActiveBoundingBoxes(null);

    // 6. Reset snapshot, dimensions, and latency telemetry to null
    setLastFrameSnapshot(null);
    setVideoDimensions(null);
    setLastScanLatency(null);
    setConsecutiveViolations(0);
    setIsEvaluating(false);
  }, []);

  // Safe mode switch that explicitly clears canvas and resets bounding boxes to null
  const handleSwitchMode = useCallback(
    (newMode: FeedMode) => {
      if (newMode === feedMode) return;
      clearActiveCanvasAndOverlays();
      setSceneSummary('');
      setCameraError(null);
      setStreamNotice(null);
      setFeedMode(newMode);
    },
    [feedMode, clearActiveCanvasAndOverlays]
  );

  // Setup WebCam
  const startWebcam = useCallback(async () => {
    stopCurrentStream();
    setCameraError(null);
    setStreamNotice(null);

    if (!navigator?.mediaDevices?.getUserMedia) {
      setStreamNotice('Webcam access is not supported in this browser.');
      handleSwitchMode('simulation');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch((playErr) => {
          console.warn('Webcam playback notice:', playErr);
        });
      }
    } catch (err: any) {
      const msg = err?.message || 'Could not access webcam.';
      const isDenied =
        err?.name === 'NotAllowedError' ||
        err?.name === 'AbortError' ||
        msg.toLowerCase().includes('permission') ||
        msg.toLowerCase().includes('denied');

      if (isDenied) {
        console.info('Webcam permission was not granted by user.');
        setStreamNotice('Webcam permission was not granted or was dismissed. Returned to Interactive Simulation.');
      } else {
        console.warn('Webcam stream unavailable:', err);
        setStreamNotice('Webcam is unavailable. Returned to Interactive Simulation.');
      }
      handleSwitchMode('simulation');
    }
  }, [stopCurrentStream, handleSwitchMode]);

  // Setup Screen Share
  const startScreenCapture = useCallback(async () => {
    stopCurrentStream();
    setCameraError(null);
    setStreamNotice(null);

    if (!navigator?.mediaDevices?.getDisplayMedia) {
      setStreamNotice('Screen sharing is not supported in this browser or iframe environment.');
      handleSwitchMode('simulation');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch((playErr) => {
          console.warn('Screen video playback notice:', playErr);
        });
      }

      // Handle user stopping screen share via native browser bar
      const tracks = stream.getVideoTracks();
      if (tracks.length > 0) {
        tracks[0].onended = () => {
          handleSwitchMode('simulation');
        };
      }
    } catch (err: any) {
      const msg = err?.message || 'Screen sharing was canceled or denied.';
      const isDenied =
        err?.name === 'NotAllowedError' ||
        err?.name === 'AbortError' ||
        msg.toLowerCase().includes('permission') ||
        msg.toLowerCase().includes('denied') ||
        msg.toLowerCase().includes('cancel');

      if (isDenied) {
        console.info('Screen capture prompt was canceled or denied by user.');
        setStreamNotice('Screen sharing permission was dismissed or canceled. Returned to Interactive Simulation.');
      } else {
        console.warn('Screen capture error:', err);
        setStreamNotice('Screen sharing could not be started. Returned to Interactive Simulation.');
      }
      handleSwitchMode('simulation');
    }
  }, [stopCurrentStream, handleSwitchMode]);

  // Handle feed mode switch effects
  useEffect(() => {
    if (feedMode === 'webcam') {
      startWebcam();
    } else if (feedMode === 'screen') {
      startScreenCapture();
    } else {
      stopCurrentStream();
    }

    return () => {
      stopCurrentStream();
    };
  }, [feedMode, startWebcam, startScreenCapture, stopCurrentStream]);

  // Capture frame from active source
  const captureCurrentFrame = useCallback((): string | null => {
    if (feedMode === 'simulation') {
      return simulationRef.current ? simulationRef.current.captureFrame() : null;
    }

    const currentVideo = feedMode === 'video_file' ? fileVideoRef.current : videoRef.current;
    if (!currentVideo || currentVideo.readyState < 2) return null;

    const vWidth = currentVideo.videoWidth;
    const vHeight = currentVideo.videoHeight;
    if (!vWidth || !vHeight) return null;

    if (!hiddenCanvasRef.current) {
      hiddenCanvasRef.current = document.createElement('canvas');
    }
    const canvas = hiddenCanvasRef.current;
    const targetW = 640;
    const targetH = Math.round((vHeight / vWidth) * 640) || 360;
    canvas.width = targetW;
    canvas.height = targetH;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(currentVideo, 0, 0, targetW, targetH);

    try {
      return canvas.toDataURL('image/jpeg', 0.82);
    } catch (err) {
      console.error('Canvas capture failed:', err);
      return null;
    }
  }, [feedMode]);

  // Coordinate mapper from normalized (0..1000) space to current screen pixel coordinates
  const mapNormalizedToScreen = useCallback(
    (nx: number, ny: number, containerW: number, containerH: number) => {
      if (feedMode === 'simulation' || !videoDimensions || !videoDimensions.width || !videoDimensions.height) {
        return {
          x: (nx / 1000) * containerW,
          y: (ny / 1000) * containerH,
        };
      }
      const containerRatio = containerW / containerH;
      const videoRatio = videoDimensions.width / videoDimensions.height;
      let renderW = containerW;
      let renderH = containerH;
      let offsetX = 0;
      let offsetY = 0;

      if (videoRatio > containerRatio) {
        renderW = containerW;
        renderH = containerW / videoRatio;
        offsetY = (containerH - renderH) / 2;
      } else {
        renderH = containerH;
        renderW = containerH * videoRatio;
        offsetX = (containerW - renderW) / 2;
      }

      return {
        x: offsetX + (nx / 1000) * renderW,
        y: offsetY + (ny / 1000) * renderH,
      };
    },
    [feedMode, videoDimensions]
  );

  // ---------------------------------------------------------------------------
  // Real-time YOLO-Pose & ByteTrack Tracking Loop (30-60 FPS)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let isCancelled = false;

    const trackingLoop = () => {
      if (isCancelled) return;

      const canvas = trackingCanvasRef.current;
      const container = viewportContainerRef.current;

      if (canvas && container) {
        const cWidth = container.clientWidth;
        const cHeight = container.clientHeight;

        if (canvas.width !== cWidth || canvas.height !== cHeight) {
          canvas.width = cWidth;
          canvas.height = cHeight;
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, cWidth, cHeight);

          if (isMonitoring) {
            let candidateDetections: Array<{
              box: BoundingBox;
              score: number;
              label?: string;
              pose?: any;
            }> = [];

            // 1. For simulation: continuously receive simulated human entities & compute YOLO-Pose
            if (feedMode === 'simulation' && simulationRef.current?.getPeopleDetections) {
              const entities = simulationRef.current.getPeopleDetections();
              candidateDetections = entities.map((ent) => {
                const pose = estimateYoloPose(ent.box, {
                  postureOverride: ent.postureHint,
                  holdingObject: ent.holdingObject,
                  motionPhase: ent.motionPhase,
                  headLookingAway: ent.headLookingAway,
                });
                return {
                  box: ent.box,
                  score: ent.score,
                  label: ent.label,
                  pose,
                };
              });
            } else if (activeBoundingBoxes && activeBoundingBoxes.length > 0) {
              // 2. For video, screen, or webcam: use AI violation & detection boxes with estimated pose
              candidateDetections = activeBoundingBoxes.map((b) => {
                const labelStr = b.label || '';
                const pose = estimateYoloPose(b, {
                  holdingObject: labelStr.toLowerCase().includes('phone'),
                });
                return {
                  box: b,
                  score: (b.confidence || 85) / 100,
                  label: labelStr || 'Detected Target',
                  pose,
                };
              });
            }

            // Update ByteTracker (Kalman motion filter + high/low 2-stage association)
            const activeTracks = byteTrackerRef.current.update(candidateDetections);
            setTrackedPeople(activeTracks);

            // Render Tracks, Skeletons & Trajectories onto overlay canvas
            activeTracks.forEach((track) => {
              const pMin = mapNormalizedToScreen(track.box.xmin, track.box.ymin, cWidth, cHeight);
              const pMax = mapNormalizedToScreen(track.box.xmax, track.box.ymax, cWidth, cHeight);
              const boxW = Math.max(10, pMax.x - pMin.x);
              const boxH = Math.max(10, pMax.y - pMin.y);
              const trackColor = track.color || getTrackColor(track.trackId);

              // -------------------------------------------------------------
              // A. Draw Trajectory Breadcrumbs & Motion Path Trail
              // -------------------------------------------------------------
              if (trackingSettings.showTrajectoryTrails && track.trajectory.length > 1) {
                ctx.save();
                ctx.beginPath();
                for (let i = 0; i < track.trajectory.length; i++) {
                  const pt = track.trajectory[i];
                  const screenPt = mapNormalizedToScreen(pt.x, pt.y, cWidth, cHeight);
                  if (i === 0) {
                    ctx.moveTo(screenPt.x, screenPt.y);
                  } else {
                    ctx.lineTo(screenPt.x, screenPt.y);
                  }
                }
                ctx.strokeStyle = trackColor;
                ctx.lineWidth = 2.5;
                ctx.shadowColor = trackColor;
                ctx.shadowBlur = 8;
                ctx.stroke();

                // Draw pulsing trail dots
                track.trajectory.forEach((pt, idx) => {
                  if (idx % 3 === 0 || idx === track.trajectory.length - 1) {
                    const screenPt = mapNormalizedToScreen(pt.x, pt.y, cWidth, cHeight);
                    ctx.beginPath();
                    ctx.arc(screenPt.x, screenPt.y, idx === track.trajectory.length - 1 ? 4 : 2, 0, Math.PI * 2);
                    ctx.fillStyle = trackColor;
                    ctx.fill();
                  }
                });
                ctx.restore();
              }

              // -------------------------------------------------------------
              // B. Draw YOLO-Pose 17-Keypoint Human Skeleton
              // -------------------------------------------------------------
              if (trackingSettings.showPoseSkeleton && track.pose && track.pose.keypoints) {
                ctx.save();
                // Map keypoints to screen space
                const screenKeypoints = new Map<number, { x: number; y: number; score: number }>();
                for (const kp of track.pose.keypoints) {
                  const spt = mapNormalizedToScreen(kp.x, kp.y, cWidth, cHeight);
                  screenKeypoints.set(kp.id, { x: spt.x, y: spt.y, score: kp.score });
                }

                // 1. Draw 19 Limb Lines
                for (const limb of SKELETON_PAIRS) {
                  const p1 = screenKeypoints.get(limb.from);
                  const p2 = screenKeypoints.get(limb.to);
                  if (p1 && p2 && p1.score >= 0.4 && p2.score >= 0.4) {
                    ctx.beginPath();
                    ctx.moveTo(p1.x, p1.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.strokeStyle = limb.color;
                    ctx.lineWidth = 3;
                    ctx.lineCap = 'round';
                    ctx.shadowColor = limb.color;
                    ctx.shadowBlur = 4;
                    ctx.stroke();
                  }
                }

                // 2. Draw 17 Keypoint Dots
                for (const kp of track.pose.keypoints) {
                  const spt = screenKeypoints.get(kp.id);
                  if (spt && spt.score >= 0.4) {
                    // Outer dark border
                    ctx.beginPath();
                    ctx.arc(spt.x, spt.y, 4.5, 0, Math.PI * 2);
                    ctx.fillStyle = '#0f172a';
                    ctx.fill();

                    // Inner bright core
                    ctx.beginPath();
                    ctx.arc(spt.x, spt.y, 3, 0, Math.PI * 2);
                    ctx.fillStyle = '#38bdf8';
                    ctx.fill();
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                  }
                }
                ctx.restore();
              }

              // -------------------------------------------------------------
              // C. Draw ByteTrack Persistent Box & ID Badge
              // -------------------------------------------------------------
              if (trackingSettings.showByteTrackIds) {
                ctx.save();
                // Bounding box frame
                ctx.strokeStyle = trackColor;
                ctx.lineWidth = 2;
                ctx.strokeRect(pMin.x, pMin.y, boxW, boxH);

                // Corner accents
                const cornerLen = Math.min(14, boxW * 0.25, boxH * 0.25);
                ctx.lineWidth = 3.5;
                ctx.strokeStyle = '#ffffff';
                // Top-left
                ctx.beginPath();
                ctx.moveTo(pMin.x, pMin.y + cornerLen);
                ctx.lineTo(pMin.x, pMin.y);
                ctx.lineTo(pMin.x + cornerLen, pMin.y);
                ctx.stroke();
                // Top-right
                ctx.beginPath();
                ctx.moveTo(pMin.x + boxW - cornerLen, pMin.y);
                ctx.lineTo(pMin.x + boxW, pMin.y);
                ctx.lineTo(pMin.x + boxW, pMin.y + cornerLen);
                ctx.stroke();
                // Bottom-left
                ctx.beginPath();
                ctx.moveTo(pMin.x, pMin.y + boxH - cornerLen);
                ctx.lineTo(pMin.x, pMin.y + boxH);
                ctx.lineTo(pMin.x + cornerLen, pMin.y + boxH);
                ctx.stroke();
                // Bottom-right
                ctx.beginPath();
                ctx.moveTo(pMin.x + boxW - cornerLen, pMin.y + boxH);
                ctx.lineTo(pMin.x + boxW, pMin.y + boxH);
                ctx.lineTo(pMin.x + boxW, pMin.y + boxH - cornerLen);
                ctx.stroke();

                // Top Persistent ByteTrack Badge
                const idLabel = `ID #${track.trackId} [${track.state}] · ${(track.score * 100).toFixed(0)}%`;
                ctx.font = 'bold 10px monospace';
                const textMetrics = ctx.measureText(idLabel);
                const badgeW = textMetrics.width + 14;
                const badgeH = 18;

                ctx.fillStyle = trackColor;
                ctx.fillRect(pMin.x, Math.max(0, pMin.y - badgeH), badgeW, badgeH);
                ctx.fillStyle = '#0f172a';
                ctx.fillText(idLabel, pMin.x + 6, Math.max(12, pMin.y - 5));
                ctx.restore();
              }

              // -------------------------------------------------------------
              // D. Draw Posture & Ergonomics Badge
              // -------------------------------------------------------------
              if (trackingSettings.showErgonomicsBadge && track.pose) {
                ctx.save();
                let postureLabel = `🧍 ${track.pose.posture.toUpperCase()}`;
                let postureBg = 'rgba(15, 23, 42, 0.85)';
                let postureTextColor = '#38bdf8';

                if (track.pose.posture === 'fallen') {
                  postureLabel = '🚨 FALLEN / MAN-DOWN (CRITICAL)';
                  postureBg = '#ef4444';
                  postureTextColor = '#ffffff';
                } else if (track.pose.posture === 'bending') {
                  postureLabel = `⚠️ BENDING HAZARD (${track.pose.spineAngleDeg || 38}°)`;
                  postureBg = '#f59e0b';
                  postureTextColor = '#0f172a';
                } else if (track.pose.posture === 'reaching') {
                  postureLabel = '✋ OVERHEAD REACH';
                  postureBg = '#8b5cf6';
                  postureTextColor = '#ffffff';
                } else if (track.pose.posture === 'walking') {
                  postureLabel = `🚶 WALKING · ${(track.velocity.speed).toFixed(1)}px/s`;
                  postureBg = 'rgba(2, 132, 199, 0.9)';
                  postureTextColor = '#ffffff';
                }

                ctx.font = 'bold 9px system-ui, sans-serif';
                const pMetrics = ctx.measureText(postureLabel);
                const pWidth = pMetrics.width + 12;
                const pHeight = 16;
                const pX = pMin.x;
                const pY = pMin.y + boxH + 4;

                ctx.fillStyle = postureBg;
                ctx.fillRect(pX, pY, pWidth, pHeight);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
                ctx.lineWidth = 1;
                ctx.strokeRect(pX, pY, pWidth, pHeight);

                ctx.fillStyle = postureTextColor;
                ctx.fillText(postureLabel, pX + 6, pY + 11);
                ctx.restore();
              }
            });
          }
        }
      }

      trackingAnimRef.current = requestAnimationFrame(trackingLoop);
    };

    trackingAnimRef.current = requestAnimationFrame(trackingLoop);

    return () => {
      isCancelled = true;
      if (trackingAnimRef.current) {
        cancelAnimationFrame(trackingAnimRef.current);
      }
    };
  }, [
    isMonitoring,
    feedMode,
    activeBoundingBoxes,
    trackingSettings,
    mapNormalizedToScreen,
  ]);

  // Perform single scan evaluation against user prompt rules
  const evaluateActiveFrame = useCallback(
    async (overrideContext?: string) => {
      if (isEvaluating) return;

      const activeRules = rules.filter(
        (r) => r.enabled && (r.streamType === 'visual' || r.streamType === 'both')
      );
      if (activeRules.length === 0) {
        setActiveBoundingBoxes(null);
        return;
      }

      const frameBase64 = captureCurrentFrame();
      if (!frameBase64) return;

      // Track current session ID so any asynchronous response from an older source is rejected
      const requestSessionId = sourceSessionIdRef.current;

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setIsEvaluating(true);
      const startTime = performance.now();

      try {
        const simContext = overrideContext || simulationRef.current?.getConditionsContext?.() || '';
        const combinedContext = [
          operationalContext || 'Visual Inspection Monitoring Zone',
          feedMode === 'video_file' ? `Video File: ${videoFileName || 'Uploaded Video'}` : `Feed: ${feedMode}`,
          simContext,
        ]
          .filter(Boolean)
          .join('. ');

        const { success, data, error } = await safePostJson(
          '/api/evaluate-frame',
          {
            imageBase64: frameBase64,
            rules: activeRules,
            context: combinedContext,
            feedMode,
            modelEngine: selectedModel,
          },
          { signal: abortController.signal }
        );

        // If user switched source or uploaded a new file while request was in-flight, discard!
        if (sourceSessionIdRef.current !== requestSessionId) {
          return;
        }

        const elapsed = Math.round(performance.now() - startTime);
        setLastScanLatency(elapsed);

        if (!success || !data) {
          if (error && !error.includes('aborted')) {
            console.warn('Frame evaluation notice:', error);
          }
          return;
        }

        if (data.success) {
          setSceneSummary(data.sceneSummary || '');
          const violations = data.violations || [];

          if (violations.length > 0) {
            setConsecutiveViolations((prev) => prev + 1);
            setLastFrameSnapshot(frameBase64);

            let highestSeverity = 'low';
            const boxes: ActiveBox[] = [];

            violations.forEach((v: any) => {
              const matchedRule = rules.find((r) => r.id === v.ruleId);
              const severity = matchedRule?.severity || 'high';

              if (severity === 'critical') highestSeverity = 'critical';
              else if (severity === 'high' && highestSeverity !== 'critical') highestSeverity = 'high';

              if (v.box2d) {
                boxes.push({
                  ymin: v.box2d.ymin,
                  xmin: v.box2d.xmin,
                  ymax: v.box2d.ymax,
                  xmax: v.box2d.xmax,
                  ruleName: matchedRule?.name || 'Rule Violation',
                  severity,
                  label: v.detectedLabel || 'Violation',
                  confidence: v.confidence || 85,
                });
              }

              // Emit incident to parent log
              onViolationDetected(
                {
                  ruleId: v.ruleId,
                  ruleName: matchedRule?.name || 'Custom Rule',
                  rulePrompt: matchedRule?.prompt || '',
                  severity,
                  category: matchedRule?.category || 'custom',
                  streamType: 'visual',
                  confidence: v.confidence || 85,
                  explanation: v.explanation || 'Violation detected by prompt rule match.',
                  detectedLabel: v.detectedLabel,
                  box2d: v.box2d,
                  modelEngine: selectedModel,
                },
                frameBase64
              );
            });

            setActiveBoundingBoxes(boxes);

            // Audio alerts
            if (highestSeverity === 'critical') {
              soundFx.playCriticalAlert();
            } else {
              soundFx.playWarningPing();
            }
          } else {
            // Frame has NO violations: reset bounding boxes to null
            setActiveBoundingBoxes(null);
            setConsecutiveViolations(0);
          }
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.error('Frame evaluation error:', err);
        }
      } finally {
        if (sourceSessionIdRef.current === requestSessionId) {
          setIsEvaluating(false);
        }
      }
    },
    [
      isEvaluating,
      rules,
      captureCurrentFrame,
      feedMode,
      videoFileName,
      operationalContext,
      onViolationDetected,
      selectedModel,
    ]
  );

  // Periodically evaluate active frame
  useEffect(() => {
    if (!isMonitoring) {
      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
      return;
    }

    // Run first check quickly
    const initialTimeout = setTimeout(() => {
      evaluateActiveFrame();
    }, 600);

    scanTimerRef.current = setInterval(() => {
      evaluateActiveFrame();
    }, scanIntervalMs);

    return () => {
      clearTimeout(initialTimeout);
      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    };
  }, [isMonitoring, scanIntervalMs, evaluateActiveFrame]);

  // Handle local video file upload with complete canvas clear and null bounding box reset
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // 1. Explicitly clear canvas state and reset bounding boxes to null
      clearActiveCanvasAndOverlays();
      setSceneSummary(`Loading "${file.name}"...`);

      // 2. Revoke prior object URL if any
      if (videoFileUrl) {
        URL.revokeObjectURL(videoFileUrl);
      }

      // 3. Create fresh object URL and switch mode
      const url = URL.createObjectURL(file);
      setVideoFileUrl(url);
      setVideoFileName(file.name);
      setFeedMode('video_file');

      // 4. Reset input so selecting the same file again triggers onChange
      e.target.value = '';
    }
  };

  // Eject uploaded video with complete canvas clear and null bounding box reset
  const handleRemoveVideo = () => {
    clearActiveCanvasAndOverlays();
    if (videoFileUrl) {
      URL.revokeObjectURL(videoFileUrl);
    }
    setVideoFileUrl(null);
    setVideoFileName(null);
    setSceneSummary('');
    handleSwitchMode('simulation');
  };

  // Calculate box pixel positioning to account for video aspect-ratio letterboxing
  const calculateBoxStyle = (box: ActiveBox) => {
    const container = viewportContainerRef.current;
    if (!container) {
      return {
        top: `${(box.ymin / 1000) * 100}%`,
        left: `${(box.xmin / 1000) * 100}%`,
        width: `${((box.xmax - box.xmin) / 1000) * 100}%`,
        height: `${((box.ymax - box.ymin) / 1000) * 100}%`,
      };
    }

    const containerW = container.clientWidth;
    const containerH = container.clientHeight;

    // In simulation mode, canvas always fills container
    if (feedMode === 'simulation' || !videoDimensions || !videoDimensions.width || !videoDimensions.height) {
      return {
        top: `${(box.ymin / 1000) * 100}%`,
        left: `${(box.xmin / 1000) * 100}%`,
        width: `${((box.xmax - box.xmin) / 1000) * 100}%`,
        height: `${((box.ymax - box.ymin) / 1000) * 100}%`,
      };
    }

    // Video has object-contain: compute letterbox/pillarbox offset
    const containerRatio = containerW / containerH;
    const videoRatio = videoDimensions.width / videoDimensions.height;

    let renderW = containerW;
    let renderH = containerH;
    let offsetX = 0;
    let offsetY = 0;

    if (videoRatio > containerRatio) {
      renderW = containerW;
      renderH = containerW / videoRatio;
      offsetY = (containerH - renderH) / 2;
    } else {
      renderH = containerH;
      renderW = containerH * videoRatio;
      offsetX = (containerW - renderW) / 2;
    }

    const topPx = offsetY + (box.ymin / 1000) * renderH;
    const leftPx = offsetX + (box.xmin / 1000) * renderW;
    const widthPx = ((box.xmax - box.xmin) / 1000) * renderW;
    const heightPx = ((box.ymax - box.ymin) / 1000) * renderH;

    return {
      top: `${topPx}px`,
      left: `${leftPx}px`,
      width: `${widthPx}px`,
      height: `${heightPx}px`,
    };
  };

  const hasViolations = Boolean(activeBoundingBoxes && activeBoundingBoxes.length > 0);

  return (
    <div className="flex flex-col gap-3 bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl">
      {/* Top Feed Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        {/* Source Selector Tabs */}
        <div className="flex items-center gap-1.5 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => handleSwitchMode('simulation')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              feedMode === 'simulation'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Interactive Simulation
          </button>

          <button
            type="button"
            onClick={() => handleSwitchMode('webcam')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              feedMode === 'webcam'
                ? 'bg-rose-500 text-white shadow-md shadow-rose-500/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            Live Webcam
          </button>

          <button
            type="button"
            onClick={() => handleSwitchMode('screen')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              feedMode === 'screen'
                ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            Screen Share
          </button>

          <button
            type="button"
            onClick={() => {
              if (videoFileUrl) {
                handleSwitchMode('video_file');
              } else {
                fileInputRef.current?.click();
              }
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              feedMode === 'video_file'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            {videoFileUrl ? 'Video File Active' : 'Upload Video'}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime,video/ogg"
            onChange={handleFileUpload}
            className="hidden"
          />
        </div>

        {/* Meta Model Engine Selector & Scan Frequency & Monitoring Master Switch */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Active Meta AI Model Selector */}
          <div className="flex items-center gap-1.5 text-xs text-purple-300 bg-purple-950/40 border border-purple-500/30 px-2.5 py-1 rounded-xl shadow-sm">
            <Cpu className="w-3.5 h-3.5 text-purple-400 shrink-0" />
            <span className="font-semibold hidden sm:inline text-[11px] text-purple-300">Model:</span>
            <select
              value={selectedModel}
              onChange={(e) => {
                const newModel = e.target.value as MetaModelEngine;
                setSelectedModel(newModel);
                setSceneSummary(`Model switched to Meta ${newModel}`);
              }}
              className="bg-transparent text-purple-200 text-xs font-semibold focus:outline-none cursor-pointer"
            >
              <option value="Llama 3.2 Vision" className="bg-slate-900 text-slate-100">
                Meta Llama 3.2 Vision
              </option>
              <option value="SAM 3.1 + Muse Spark" className="bg-slate-900 text-slate-100">
                Meta Muse Spark (SAM 3.1)
              </option>
              <option value="SAM 3.1 + Llama 3.3" className="bg-slate-900 text-slate-100">
                Meta Llama 3.3
              </option>
            </select>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Sliders className="w-3.5 h-3.5 text-slate-500" />
            <span>Rate:</span>
            <select
              value={scanIntervalMs}
              onChange={(e) => setScanIntervalMs(Number(e.target.value))}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            >
              <option value={1800}>Fast (1.8s)</option>
              <option value={3000}>Standard (3.0s)</option>
              <option value={5000}>Eco (5.0s)</option>
            </select>
          </div>

          <button
            type="button"
            onClick={onToggleMonitoring}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-xl font-bold text-xs transition-all cursor-pointer ${
              isMonitoring
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/50 hover:bg-rose-500/30'
                : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400 font-extrabold shadow-lg shadow-emerald-500/20'
            }`}
          >
            {isMonitoring ? (
              <>
                <Pause className="w-3.5 h-3.5 fill-current" />
                Pause Monitor
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                Start Monitor
              </>
            )}
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* YOLO-Pose & ByteTrack Multi-Person Tracking Controls Bar            */}
      {/* ------------------------------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 px-3 py-2 bg-slate-950/70 border border-slate-800/80 rounded-xl text-xs">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400 shrink-0" />
          <span className="font-bold text-slate-200 text-xs tracking-wide">YOLO-Pose + ByteTrack Engine:</span>
          <span className="text-[10px] text-cyan-400/80 font-mono hidden md:inline">
            [17 COCO Keypoints + Kalman 2-Stage Association]
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Toggle ByteTrack Persistent IDs */}
          <button
            type="button"
            onClick={() =>
              setTrackingSettings((prev) => ({ ...prev, showByteTrackIds: !prev.showByteTrackIds }))
            }
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-colors cursor-pointer ${
              trackingSettings.showByteTrackIds
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
                : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
            }`}
            title="Toggle persistent Kalman track IDs"
          >
            <Users className="w-3 h-3" />
            ByteTrack IDs {trackingSettings.showByteTrackIds ? 'ON' : 'OFF'}
          </button>

          {/* Toggle YOLO-Pose Skeletons */}
          <button
            type="button"
            onClick={() =>
              setTrackingSettings((prev) => ({ ...prev, showPoseSkeleton: !prev.showPoseSkeleton }))
            }
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-colors cursor-pointer ${
              trackingSettings.showPoseSkeleton
                ? 'bg-purple-500/20 text-purple-300 border-purple-500/50'
                : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
            }`}
            title="Toggle 17-keypoint skeleton limbs and joints"
          >
            <Activity className="w-3 h-3" />
            YOLO-Pose Skeletons {trackingSettings.showPoseSkeleton ? 'ON' : 'OFF'}
          </button>

          {/* Toggle Trajectory Trails */}
          <button
            type="button"
            onClick={() =>
              setTrackingSettings((prev) => ({ ...prev, showTrajectoryTrails: !prev.showTrajectoryTrails }))
            }
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-colors cursor-pointer ${
              trackingSettings.showTrajectoryTrails
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
            }`}
            title="Toggle motion breadcrumbs and velocity trail"
          >
            <Footprints className="w-3 h-3" />
            Trails {trackingSettings.showTrajectoryTrails ? 'ON' : 'OFF'}
          </button>

          {/* Toggle Ergonomics & Posture */}
          <button
            type="button"
            onClick={() =>
              setTrackingSettings((prev) => ({ ...prev, showErgonomicsBadge: !prev.showErgonomicsBadge }))
            }
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-colors cursor-pointer ${
              trackingSettings.showErgonomicsBadge
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
            }`}
            title="Toggle posture and fall hazard tags"
          >
            <ShieldCheck className="w-3 h-3" />
            Ergonomics {trackingSettings.showErgonomicsBadge ? 'ON' : 'OFF'}
          </button>

          {/* Active Tracklets HUD Pill */}
          <div className="hidden lg:flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-[11px] font-mono text-cyan-300">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
            <span>Tracked: {trackedPeople.length} Person{trackedPeople.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>

      {/* Stream notification banner (e.g. for user-dismissed camera/screen permissions) */}
      {streamNotice && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-amber-500/15 border border-amber-500/30 text-amber-200 rounded-xl text-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{streamNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setStreamNotice(null)}
            className="p-1 hover:bg-amber-500/20 rounded text-amber-400 cursor-pointer transition-colors"
            title="Dismiss notice"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Video file banner when a video file is loaded */}
      {feedMode === 'video_file' && videoFileUrl && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-amber-950/30 border border-amber-500/30 rounded-xl text-xs text-amber-200">
          <div className="flex items-center gap-2 truncate">
            <FileVideo className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="font-semibold truncate">Active Video:</span>
            <span className="font-mono text-[11px] text-amber-300 truncate max-w-xs">{videoFileName}</span>
            {videoDimensions && (
              <span className="text-[10px] text-amber-400/70 font-mono">
                ({videoDimensions.width}x{videoDimensions.height})
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded-lg text-[11px] font-semibold transition-colors flex items-center gap-1 cursor-pointer"
            >
              <Upload className="w-3 h-3" />
              Upload Different Video
            </button>
            <button
              type="button"
              onClick={handleRemoveVideo}
              className="p-1 hover:bg-amber-500/20 text-amber-400 rounded-lg transition-colors cursor-pointer"
              title="Close video file"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Main Video / Canvas Viewport */}
      <div
        ref={viewportContainerRef}
        className="relative w-full aspect-video rounded-xl overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center select-none"
      >
        {/* Scenario 1: Interactive Procedural Simulation */}
        {feedMode === 'simulation' && (
          <div className="w-full h-full flex items-center justify-center">
            <SimulationCanvas
              ref={simulationRef}
              onViolationConditionChange={(cond) => {
                setTimeout(() => {
                  evaluateActiveFrame(cond);
                }, 50);
              }}
            />
          </div>
        )}

        {/* Scenario 2: Webcam / Screen Stream */}
        {(feedMode === 'webcam' || feedMode === 'screen') && (
          <div className="relative w-full h-full flex items-center justify-center bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-contain"
            />
            {cameraError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-slate-950/90 text-rose-300 gap-2">
                <AlertTriangle className="w-8 h-8 text-rose-500" />
                <p className="font-semibold">{cameraError}</p>
                <button
                  type="button"
                  onClick={() => handleSwitchMode('simulation')}
                  className="mt-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs cursor-pointer"
                >
                  Switch back to interactive simulation
                </button>
              </div>
            )}
          </div>
        )}

        {/* Scenario 3: Video File Upload */}
        {feedMode === 'video_file' && (
          <div className="relative w-full h-full flex items-center justify-center bg-black">
            {videoFileUrl ? (
              <video
                ref={fileVideoRef}
                src={videoFileUrl}
                controls
                loop
                playsInline
                autoPlay
                className="w-full h-full object-contain"
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  setVideoDimensions({ width: v.videoWidth, height: v.videoHeight });
                  v.play().catch(() => {});
                  setTimeout(() => {
                    evaluateActiveFrame();
                  }, 250);
                }}
                onSeeked={() => {
                  // Explicitly clear bounding boxes on scrubbing/seeking
                  clearActiveCanvasAndOverlays();
                  setTimeout(() => {
                    evaluateActiveFrame();
                  }, 120);
                }}
                onPlay={() => {
                  evaluateActiveFrame();
                }}
              />
            ) : (
              <div className="flex flex-col items-center justify-center p-8 text-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <FileVideo className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-200">No Video File Selected</h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm">
                    Upload an MP4, WebM, or MOV video file to audit safety rules, PPE compliance, and prohibited items in real time.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-amber-500/20 flex items-center gap-2 cursor-pointer transition-colors"
                >
                  <Upload className="w-4 h-4" />
                  Select Video File
                </button>
              </div>
            )}
          </div>
        )}

        {/* ------------------------------------------------------------------- */}
        {/* Dynamic Overlay Canvas for YOLO-Pose & ByteTrack Skeletons/Trails  */}
        {/* ------------------------------------------------------------------- */}
        <canvas
          ref={trackingCanvasRef}
          className="absolute inset-0 pointer-events-none z-20 w-full h-full"
        />

        {/* Dynamic Bounding Box Overlays - only rendered if activeBoundingBoxes is not null */}
        {activeBoundingBoxes &&
          activeBoundingBoxes.map((box, idx) => {
            const style = calculateBoxStyle(box);

            return (
              <div
                key={idx}
                style={style}
                className="absolute pointer-events-none border-2 border-rose-500 bg-rose-500/15 rounded z-20 animate-pulse flex flex-col justify-between p-1 shadow-[0_0_15px_rgba(244,63,94,0.6)] transition-all duration-150"
              >
                <div className="self-start bg-rose-600 text-white font-mono text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider flex items-center gap-1 shadow">
                  <AlertTriangle className="w-3 h-3" />
                  <span>
                    {box.label || 'Violation'} ({box.confidence}%)
                  </span>
                </div>
                <div className="self-end bg-black/85 text-rose-200 text-[9px] px-1.5 py-0.5 rounded font-mono border border-rose-500/40">
                  {box.ruleName}
                </div>
              </div>
            );
          })}

        {/* Active Scan Laser sweep animation when evaluating */}
        {isEvaluating && (
          <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
            <div className="w-full h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#38bdf8] animate-bounce" />
          </div>
        )}

        {/* Real-time Status Overlay HUD */}
        <div className="absolute top-3 right-3 z-30 flex items-center gap-2">
          {isMonitoring ? (
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold backdrop-blur-md border ${
                hasViolations
                  ? 'bg-rose-500/20 border-rose-500 text-rose-300 shadow-[0_0_12px_rgba(244,63,94,0.4)] animate-pulse'
                  : 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  hasViolations ? 'bg-rose-500' : 'bg-emerald-400 animate-ping'
                }`}
              />
              {hasViolations ? 'VIOLATION DETECTED' : 'MONITORING ACTIVE'}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800/80 border border-slate-700 text-slate-400">
              <span className="w-2 h-2 rounded-full bg-slate-500" />
              PAUSED
            </div>
          )}

          {lastScanLatency !== null && (
            <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-md bg-slate-950/80 border border-slate-800 text-[11px] font-mono text-slate-400">
              <Radio className="w-3 h-3 text-cyan-400" />
              <span>{lastScanLatency}ms</span>
            </div>
          )}
        </div>
      </div>

      {/* Frame Scene Summary & Live Telemetry bar */}
      <div className="flex flex-wrap items-center justify-between text-xs text-slate-400 px-1 pt-1 gap-2">
        <div className="flex items-center gap-2 truncate">
          <span className="font-semibold text-slate-300">Live AI Scene Analysis:</span>
          <span className="italic text-slate-400 truncate max-w-md">
            {sceneSummary || (isMonitoring ? 'Scanning active frame for rule prompt violations...' : 'Monitoring paused.')}
          </span>
        </div>

        <div className="flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            Active Visual Rules: {rules.filter((r) => r.enabled && (r.streamType === 'visual' || r.streamType === 'both')).length}
          </span>
          <button
            type="button"
            onClick={() => evaluateActiveFrame()}
            disabled={isEvaluating}
            className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 font-medium cursor-pointer"
          >
            <RefreshCw className={`w-3 h-3 ${isEvaluating ? 'animate-spin' : ''}`} />
            Scan Now
          </button>
        </div>
      </div>
    </div>
  );
};
