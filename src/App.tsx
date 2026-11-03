import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Eye,
  Settings,
  Sparkles,
  Download,
  AlertOctagon,
  Activity,
  CheckCircle2,
  Volume2,
  VolumeX,
  Sliders,
  ExternalLink,
  Info,
  Camera,
  Grid,
  Bot,
} from 'lucide-react';
import { PromptRule, ViolationIncident, CameraFeed, CameraGroup } from './types';
import { INITIAL_RULES, INITIAL_CAMERAS, INITIAL_GROUPS, PRESET_PACKS } from './utils/defaultRules';
import { soundFx } from './utils/audioAlert';
import { MultiCameraMatrix } from './components/MultiCameraMatrix';
import { FeedViewport } from './components/FeedViewport';
import { RuleManager } from './components/RuleManager';
import { IncidentAuditFeed } from './components/IncidentAuditFeed';
import { AnalyticsSummary } from './components/AnalyticsSummary';
import { MetaArchitectureModal } from './components/MetaArchitectureModal';

export default function App() {
  // Stored cameras & groups
  const [cameras, setCameras] = useState<CameraFeed[]>(() => {
    try {
      const saved = localStorage.getItem('sentinel_cameras');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn('Failed to load cameras', e);
    }
    return INITIAL_CAMERAS;
  });

  const [groups, setGroups] = useState<CameraGroup[]>(() => {
    try {
      const saved = localStorage.getItem('sentinel_groups');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn('Failed to load groups', e);
    }
    return INITIAL_GROUPS;
  });

  // Stored rules
  const [rules, setRules] = useState<PromptRule[]>(() => {
    try {
      const saved = localStorage.getItem('sentinel_rules');
      if (saved) {
        const parsed: PromptRule[] = JSON.parse(saved);
        // Ensure core visual rules apply globally so they are detected on all cameras/simulations
        const migrated = parsed.map((r) => {
          if (r.id === 'rule-exam-phone' || r.id === 'rule-ppe-hardhat' || r.id === 'rule-safety-vest') {
            return { ...r, targetScope: 'all' as const, enabled: true };
          }
          return r;
        });

        // Ensure rule-safety-vest exists
        if (!migrated.some((r) => r.id === 'rule-safety-vest')) {
          migrated.push({
            id: 'rule-safety-vest',
            name: 'High-Visibility Safety Vest Required',
            prompt: 'Alert if any personnel is missing a high-visibility fluorescent or reflective neon safety vest.',
            severity: 'high',
            category: 'safety',
            streamType: 'visual',
            enabled: true,
            actionAlarm: true,
            actionCapture: true,
            detectionCount: 0,
            createdAt: new Date().toISOString(),
            targetScope: 'all',
          });
        }
        return migrated;
      }
    } catch (e) {
      console.warn('Failed to load saved rules', e);
    }
    return INITIAL_RULES;
  });

  // Stored incidents
  const [incidents, setIncidents] = useState<ViolationIncident[]>(() => {
    try {
      const saved = localStorage.getItem('sentinel_incidents');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn('Failed to load saved incidents', e);
    }
    return [];
  });

  // Master monitoring state & active view
  const [isMonitoring, setIsMonitoring] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'matrix' | 'visual'>('matrix');
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [operationalContext, setOperationalContext] = useState<string>(
    'Multi-Zone Industrial Facility & Examination Complex'
  );
  const [showMetaModal, setShowMetaModal] = useState<boolean>(false);

  // Sync audio mute
  useEffect(() => {
    soundFx.isMuted = isMuted;
  }, [isMuted]);

  // Persist cameras
  useEffect(() => {
    try {
      localStorage.setItem('sentinel_cameras', JSON.stringify(cameras));
    } catch (e) {
      console.warn('Failed to persist cameras', e);
    }
  }, [cameras]);

  // Persist rules
  useEffect(() => {
    try {
      localStorage.setItem('sentinel_rules', JSON.stringify(rules));
    } catch (e) {
      console.warn('Failed to persist rules', e);
    }
  }, [rules]);

  // Persist incidents
  useEffect(() => {
    try {
      localStorage.setItem('sentinel_incidents', JSON.stringify(incidents.slice(0, 100)));
    } catch (e) {
      console.warn('Failed to persist incidents', e);
    }
  }, [incidents]);

  // Handle detected violation from any camera or stream
  const handleViolationDetected = (
    violationData: Omit<ViolationIncident, 'id' | 'timestamp' | 'status'>,
    evidencePayload: string
  ) => {
    const newIncident: ViolationIncident = {
      ...violationData,
      id: `inc-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      timestamp: new Date().toISOString(),
      status: 'active',
      visualEvidence: violationData.streamType === 'visual' ? evidencePayload : undefined,
      textEvidence: violationData.streamType === 'text' ? evidencePayload : undefined,
    };

    setIncidents((prev) => [newIncident, ...prev]);

    // Increment rule detection counter
    setRules((prev) =>
      prev.map((r) =>
        r.id === violationData.ruleId
          ? {
              ...r,
              detectionCount: (r.detectionCount || 0) + 1,
              lastTriggeredAt: new Date().toISOString(),
            }
          : r
      )
    );
  };

  // Rule management handlers
  const handleAddRule = (newRuleData: Omit<PromptRule, 'id' | 'createdAt' | 'detectionCount'>) => {
    const newRule: PromptRule = {
      ...newRuleData,
      id: `rule-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      detectionCount: 0,
      createdAt: new Date().toISOString(),
    };
    setRules((prev) => [newRule, ...prev]);
  };

  const handleUpdateRule = (id: string, updates: Partial<PromptRule>) => {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...updates } : r)));
  };

  const handleDeleteRule = (id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id));
  };

  const handleLoadPresetPack = (packIndex: number) => {
    const pack = PRESET_PACKS[packIndex];
    if (!pack) return;

    const newRules: PromptRule[] = pack.rules.map((r, i) => ({
      id: `preset-${Date.now()}-${i}`,
      name: r.name,
      prompt: r.prompt,
      severity: r.severity,
      category: r.category,
      streamType: r.streamType,
      targetScope: r.targetScope || 'all',
      targetIds: r.targetIds,
      enabled: true,
      actionAlarm: true,
      actionCapture: true,
      detectionCount: 0,
      createdAt: new Date().toISOString(),
    }));

    setRules((prev) => [...newRules, ...prev]);
  };

  // Camera management
  const handleUpdateCamera = (id: string, updates: Partial<CameraFeed>) => {
    setCameras((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)));
  };

  const handleAddCamera = (newCam: CameraFeed) => {
    setCameras((prev) => [...prev, newCam]);
  };

  // Incident status update
  const handleUpdateIncidentStatus = (
    id: string,
    status: 'active' | 'acknowledged' | 'resolved'
  ) => {
    setIncidents((prev) => prev.map((inc) => (inc.id === id ? { ...inc, status } : inc)));
  };

  const handleClearIncidents = () => {
    setIncidents([]);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/80 px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          {/* Logo & Identity */}
          <div className="flex items-center gap-3">
            <div className="relative w-9 h-9 rounded-xl bg-gradient-to-tr from-rose-500 via-indigo-600 to-cyan-400 p-[1.5px] shadow-lg shadow-rose-500/20">
              <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
                <ShieldAlert className="w-5 h-5 text-rose-400 animate-pulse" />
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-extrabold text-base tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                  SentinelPrompt
                </h1>
                <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                  Multi-Camera Multi-Worker
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Real-Time Video Auditing with Dedicated Meta AI Camera Workers
              </p>
            </div>
          </div>

          {/* Navigation View Switcher */}
          <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setActiveTab('matrix')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'matrix'
                  ? 'bg-slate-800 text-cyan-300 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Grid className="w-3.5 h-3.5 text-cyan-400" />
              Multi-Cam Matrix
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('visual')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'visual'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Eye className="w-3.5 h-3.5 text-cyan-400" />
              Spotlight Feed
            </button>
          </div>

          {/* Actions: Meta Architecture Spec & Audio Mute */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowMetaModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-500/20 to-purple-500/20 hover:from-indigo-500/30 hover:to-purple-500/30 border border-indigo-500/40 text-indigo-300 text-xs font-bold transition-all shadow-md shadow-indigo-950/40 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">Meta Hackathon</span> Spec
            </button>

            <button
              type="button"
              onClick={() => setIsMuted(!isMuted)}
              className={`p-2 rounded-xl border transition-colors ${
                isMuted
                  ? 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20'
              }`}
              title={isMuted ? 'Unmute Audio Siren' : 'Mute Audio Siren'}
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Main App Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 space-y-6">
        {/* Analytics Top Bar */}
        <AnalyticsSummary
          rules={rules}
          incidents={incidents}
          isMuted={isMuted}
          onToggleMute={() => setIsMuted(!isMuted)}
          operationalContext={operationalContext}
          onUpdateOperationalContext={setOperationalContext}
        />

        {/* Viewport Stream Section */}
        {activeTab === 'matrix' && (
          <MultiCameraMatrix
            cameras={cameras}
            groups={groups}
            rules={rules}
            onViolationDetected={handleViolationDetected}
            onUpdateCamera={handleUpdateCamera}
            onAddCamera={handleAddCamera}
          />
        )}

        {activeTab === 'visual' && (
          <div className="w-full">
            <FeedViewport
              rules={rules}
              onViolationDetected={handleViolationDetected}
              isMonitoring={isMonitoring}
              onToggleMonitoring={() => setIsMonitoring(!isMonitoring)}
              operationalContext={operationalContext}
            />
          </div>
        )}

        {/* Rule Engine & Incident Audit Log (Dual Panel) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <RuleManager
            rules={rules}
            groups={groups}
            cameras={cameras}
            onAddRule={handleAddRule}
            onUpdateRule={handleUpdateRule}
            onDeleteRule={handleDeleteRule}
            onLoadPresetPack={handleLoadPresetPack}
          />

          <IncidentAuditFeed
            incidents={incidents}
            onUpdateStatus={handleUpdateIncidentStatus}
            onClearIncidents={handleClearIncidents}
          />
        </div>
      </main>

      {/* Meta Architecture Spec Modal */}
      <MetaArchitectureModal
        isOpen={showMetaModal}
        onClose={() => setShowMetaModal(false)}
      />

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950/60 py-4 px-6 text-center text-xs text-slate-500 flex flex-wrap items-center justify-between gap-2 max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span>Multi-Camera Worker Topology Active ({cameras.length} Dedicated Workers)</span>
        </div>
        <div className="text-[11px] text-slate-400">
          Engineered for Meta Global AI Developer Hackathon • SAM 3.1, Muse Spark & Llama 3.2
        </div>
      </footer>
    </div>
  );
}
