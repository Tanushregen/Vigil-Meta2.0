import React from 'react';
import {
  Activity,
  ShieldAlert,
  CheckCircle,
  Percent,
  Clock,
  Volume2,
  VolumeX,
  Sliders,
} from 'lucide-react';
import { PromptRule, ViolationIncident } from '../types';
import { soundFx } from '../utils/audioAlert';

interface AnalyticsSummaryProps {
  rules: PromptRule[];
  incidents: ViolationIncident[];
  isMuted: boolean;
  onToggleMute: () => void;
  operationalContext: string;
  onUpdateOperationalContext: (ctx: string) => void;
}

export const AnalyticsSummary: React.FC<AnalyticsSummaryProps> = ({
  rules,
  incidents,
  isMuted,
  onToggleMute,
  operationalContext,
  onUpdateOperationalContext,
}) => {
  const activeRulesCount = rules.filter((r) => r.enabled).length;
  const criticalViolations = incidents.filter((i) => i.severity === 'critical').length;
  const highViolations = incidents.filter((i) => i.severity === 'high').length;
  const resolvedCount = incidents.filter((i) => i.status === 'resolved').length;

  // Approximate compliance score
  const totalIncidents = incidents.length;
  const complianceRate =
    totalIncidents === 0
      ? 100
      : Math.max(0, Math.min(100, Math.round((1 - (criticalViolations * 2 + highViolations) / (totalIncidents * 2 + 5)) * 100)));

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {/* Metric 1 */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 flex flex-col justify-between shadow-lg">
        <div className="flex items-center justify-between text-slate-400 text-xs">
          <span>Active Rules</span>
          <Activity className="w-3.5 h-3.5 text-cyan-400" />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-black text-slate-100 font-mono">{activeRulesCount}</span>
          <span className="text-[11px] text-slate-500 font-mono">/ {rules.length} enabled</span>
        </div>
      </div>

      {/* Metric 2 */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 flex flex-col justify-between shadow-lg">
        <div className="flex items-center justify-between text-slate-400 text-xs">
          <span>Violations Logged</span>
          <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-black text-rose-400 font-mono">{totalIncidents}</span>
          <span className="text-[11px] text-rose-500/80 font-mono">({criticalViolations} critical)</span>
        </div>
      </div>

      {/* Metric 3 */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 flex flex-col justify-between shadow-lg">
        <div className="flex items-center justify-between text-slate-400 text-xs">
          <span>Compliance Index</span>
          <Percent className="w-3.5 h-3.5 text-emerald-400" />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className={`text-2xl font-black font-mono ${complianceRate >= 80 ? 'text-emerald-400' : 'text-amber-400'}`}>
            {complianceRate}%
          </span>
          <span className="text-[11px] text-slate-500 font-mono">{resolvedCount} resolved</span>
        </div>
      </div>

      {/* Metric 4: Sound Alert & Environment Setting */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 flex flex-col justify-between shadow-lg">
        <div className="flex items-center justify-between text-slate-400 text-xs">
          <span>Audio Siren</span>
          <button
            type="button"
            onClick={onToggleMute}
            className={`p-1 rounded-md transition-colors ${
              isMuted ? 'text-slate-500 hover:text-slate-300' : 'text-cyan-400 hover:text-cyan-300'
            }`}
            title={isMuted ? 'Unmute alerts' : 'Mute audio alerts'}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="text-[11px] font-mono text-slate-300">
            {isMuted ? 'Sound Muted' : 'Siren Active'}
          </span>
          <button
            type="button"
            onClick={() => {
              if (!isMuted) soundFx.playCriticalAlert();
            }}
            className="text-[10px] font-mono text-cyan-400 hover:underline"
          >
            Test Beep
          </button>
        </div>
      </div>
    </div>
  );
};
