import React, { useState } from 'react';
import {
  ShieldAlert,
  Plus,
  Sparkles,
  Trash2,
  Edit2,
  Check,
  X,
  Volume2,
  Camera,
  Layers,
  Wand2,
  Eye,
  MessageSquare,
  Radio,
} from 'lucide-react';
import { PromptRule, RuleSeverity, RuleCategory, StreamType, RuleScope, CameraGroup, CameraFeed } from '../types';
import { PRESET_PACKS } from '../utils/defaultRules';
import { safePostJson } from '../utils/apiClient';

interface RuleManagerProps {
  rules: PromptRule[];
  groups: CameraGroup[];
  cameras: CameraFeed[];
  onAddRule: (rule: Omit<PromptRule, 'id' | 'createdAt' | 'detectionCount'>) => void;
  onUpdateRule: (id: string, updates: Partial<PromptRule>) => void;
  onDeleteRule: (id: string) => void;
  onLoadPresetPack: (packIndex: number) => void;
}

export const RuleManager: React.FC<RuleManagerProps> = ({
  rules,
  groups,
  cameras,
  onAddRule,
  onUpdateRule,
  onDeleteRule,
  onLoadPresetPack,
}) => {
  // New rule form state
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [name, setName] = useState<string>('');
  const [prompt, setPrompt] = useState<string>('');
  const [severity, setSeverity] = useState<RuleSeverity>('high');
  const [category, setCategory] = useState<RuleCategory>('safety');
  const [streamType, setStreamType] = useState<StreamType>('visual');
  const [targetScope, setTargetScope] = useState<RuleScope>('all');
  const [selectedTargetId, setSelectedTargetId] = useState<string>('');
  const [actionAlarm, setActionAlarm] = useState<boolean>(true);
  const [actionCapture, setActionCapture] = useState<boolean>(true);

  // AI Rule generation modal
  const [isAiGenerating, setIsAiGenerating] = useState<boolean>(false);
  const [aiScenarioPrompt, setAiScenarioPrompt] = useState<string>('');
  const [isGeneratingRules, setIsGeneratingRules] = useState<boolean>(false);

  // Editing rule state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState<string>('');

  // Filter state
  const [filterStream, setFilterStream] = useState<'all' | 'visual' | 'text'>('all');

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !prompt.trim()) return;

    let targetIds: string[] | undefined = undefined;
    if (targetScope !== 'all' && selectedTargetId) {
      targetIds = [selectedTargetId];
    }

    onAddRule({
      name: name.trim(),
      prompt: prompt.trim(),
      severity,
      category,
      streamType,
      targetScope,
      targetIds,
      enabled: true,
      actionAlarm,
      actionCapture,
    });

    // Reset form
    setName('');
    setPrompt('');
    setTargetScope('all');
    setSelectedTargetId('');
    setIsCreating(false);
  };

  const handleAiSynthesize = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiScenarioPrompt.trim()) return;

    setIsGeneratingRules(true);
    try {
      const { success, data, error } = await safePostJson('/api/generate-rules', {
        scenarioDescription: aiScenarioPrompt,
      });
      if (success && data && data.rules?.length) {
        data.rules.forEach((r: any) => {
          onAddRule({
            name: r.name,
            prompt: r.prompt,
            severity: (r.severity as RuleSeverity) || 'high',
            category: (r.category as RuleCategory) || 'custom',
            streamType: (r.streamType as StreamType) || 'visual',
            targetScope: 'all',
            enabled: true,
            actionAlarm: true,
            actionCapture: true,
          });
        });
        setIsAiGenerating(false);
        setAiScenarioPrompt('');
      }
    } catch (err) {
      console.error('Failed to generate rules:', err);
    } finally {
      setIsGeneratingRules(false);
    }
  };

  const filteredRules = rules.filter((r) => {
    if (filterStream === 'all') return true;
    return r.streamType === filterStream || r.streamType === 'both';
  });

  const getSeverityBadge = (sev: RuleSeverity) => {
    switch (sev) {
      case 'critical':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
      case 'high':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      case 'medium':
        return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40';
      case 'low':
        return 'bg-blue-500/20 text-blue-300 border-blue-500/40';
    }
  };

  const renderTargetBadge = (r: PromptRule) => {
    if (r.targetScope === 'all') {
      return (
        <span className="text-[10px] font-mono bg-indigo-950/60 text-indigo-300 border border-indigo-800 px-1.5 py-0.5 rounded">
          All Cameras (Global)
        </span>
      );
    }
    if (r.targetScope === 'group') {
      const grp = groups.find((g) => r.targetIds?.includes(g.id));
      return (
        <span className="text-[10px] font-mono bg-cyan-950/60 text-cyan-300 border border-cyan-800 px-1.5 py-0.5 rounded">
          Zone: {grp?.name || 'Group'}
        </span>
      );
    }
    if (r.targetScope === 'camera') {
      const cam = cameras.find((c) => r.targetIds?.includes(c.id));
      return (
        <span className="text-[10px] font-mono bg-amber-950/60 text-amber-300 border border-amber-800 px-1.5 py-0.5 rounded">
          Camera: {cam?.name || 'Individual'}
        </span>
      );
    }
    return null;
  };

  return (
    <div className="flex flex-col gap-4 bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl">
      {/* Header and Quick Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-rose-400" />
          <h2 className="font-bold text-sm text-slate-100">Natural Language Rule Engine</h2>
          <span className="text-[11px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-mono">
            {rules.filter((r) => r.enabled).length} Active / {rules.length} Total
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsAiGenerating(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold text-xs shadow-md shadow-indigo-500/20 cursor-pointer"
          >
            <Wand2 className="w-3.5 h-3.5" />
            AI Rule Synthesizer
          </button>

          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shadow-md shadow-cyan-500/20 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            New Rule Prompt
          </button>
        </div>
      </div>

      {/* Preset Pack Quick Loaders */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs text-slate-400">
        <span className="text-[11px] font-medium text-slate-500 shrink-0">Presets:</span>
        {PRESET_PACKS.map((pack, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => onLoadPresetPack(idx)}
            className="px-2.5 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 text-[11px] font-medium shrink-0 transition-colors"
          >
            + {pack.name}
          </button>
        ))}
      </div>

      {/* AI Rule Generation Modal */}
      {isAiGenerating && (
        <form
          onSubmit={handleAiSynthesize}
          className="p-4 rounded-xl bg-indigo-950/40 border border-indigo-500/30 flex flex-col gap-3 animate-in fade-in"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-300">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <span>AI Rule Generator (Llama 3.3 / Muse Spark Policy Compiler)</span>
            </div>
            <button
              type="button"
              onClick={() => setIsAiGenerating(false)}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-indigo-200/80">
            Describe your facility, operation, or policy in plain words. The compiler formulates calibrated prompt rules with optimal severities, camera scopes, and detection triggers.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={aiScenarioPrompt}
              onChange={(e) => setAiScenarioPrompt(e.target.value)}
              placeholder="e.g., Cleanroom semiconductor fab requiring bunny suits and no makeup, or Bank teller security"
              className="flex-1 bg-slate-950 border border-indigo-700/60 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
            <button
              type="submit"
              disabled={isGeneratingRules || !aiScenarioPrompt.trim()}
              className="px-4 py-2 bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer shadow"
            >
              <Wand2 className={`w-3.5 h-3.5 ${isGeneratingRules ? 'animate-spin' : ''}`} />
              {isGeneratingRules ? 'Generating...' : 'Synthesize'}
            </button>
          </div>
        </form>
      )}

      {/* Create New Prompt Rule Form */}
      {isCreating && (
        <form
          onSubmit={handleCreateSubmit}
          className="p-4 rounded-xl bg-slate-950 border border-cyan-500/40 flex flex-col gap-3 animate-in fade-in"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="text-xs font-bold text-cyan-300">New Custom Prompt Rule</span>
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                Rule Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Safety Helmet Required"
                required
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Severity
                </label>
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none"
                >
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none"
                >
                  <option value="safety">Safety</option>
                  <option value="security">Security</option>
                  <option value="compliance">Compliance</option>
                  <option value="conduct">Conduct</option>
                  <option value="custom">Custom</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Stream Type
                </label>
                <select
                  value={streamType}
                  onChange={(e) => setStreamType(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none"
                >
                  <option value="visual">Visual Feed</option>
                  <option value="text">Text Stream</option>
                  <option value="both">Both</option>
                </select>
              </div>
            </div>
          </div>

          {/* Camera / Group Targeting Scope */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
            <div>
              <label className="block text-[11px] font-semibold text-cyan-300 mb-1">
                Target Camera Scope
              </label>
              <select
                value={targetScope}
                onChange={(e) => {
                  setTargetScope(e.target.value as any);
                  setSelectedTargetId('');
                }}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none"
              >
                <option value="all">Global (All Cameras & Streams)</option>
                <option value="group">Specific Camera Group / Zone</option>
                <option value="camera">Individual Camera</option>
              </select>
            </div>

            {targetScope === 'group' && (
              <div>
                <label className="block text-[11px] font-semibold text-cyan-300 mb-1">
                  Select Camera Group (Zone)
                </label>
                <select
                  value={selectedTargetId}
                  onChange={(e) => setSelectedTargetId(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none"
                >
                  <option value="">-- Select Zone --</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {targetScope === 'camera' && (
              <div>
                <label className="block text-[11px] font-semibold text-cyan-300 mb-1">
                  Select Specific Camera
                </label>
                <select
                  value={selectedTargetId}
                  onChange={(e) => setSelectedTargetId(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none"
                >
                  <option value="">-- Select Camera --</option>
                  {cameras.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">
              Natural Language Prompt (Condition to detect)
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={2}
              placeholder="e.g., Alert if any person is in the work area without wearing a hardhat or is looking down at a mobile phone screen."
              required
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-4 text-xs text-slate-300">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={actionAlarm}
                  onChange={(e) => setActionAlarm(e.target.checked)}
                  className="rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0"
                />
                <Volume2 className="w-3.5 h-3.5 text-slate-400" />
                Sound Alarm
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={actionCapture}
                  onChange={(e) => setActionCapture(e.target.checked)}
                  className="rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0"
                />
                <Camera className="w-3.5 h-3.5 text-slate-400" />
                Auto-Capture Snapshot
              </label>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-lg text-xs shadow-md shadow-cyan-500/20"
              >
                Activate Rule
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Stream Filter Bar */}
      <div className="flex items-center justify-between text-xs border-b border-slate-800/80 pb-2">
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            type="button"
            onClick={() => setFilterStream('all')}
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
              filterStream === 'all'
                ? 'bg-slate-800 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All Rules
          </button>
          <button
            type="button"
            onClick={() => setFilterStream('visual')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
              filterStream === 'visual'
                ? 'bg-slate-800 text-cyan-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Eye className="w-3 h-3" />
            Visual Rules
          </button>
          <button
            type="button"
            onClick={() => setFilterStream('text')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
              filterStream === 'text'
                ? 'bg-slate-800 text-emerald-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <MessageSquare className="w-3 h-3" />
            Text Rules
          </button>
        </div>
      </div>

      {/* Rules List */}
      <div className="flex flex-col gap-2.5 max-h-[480px] overflow-y-auto pr-1">
        {filteredRules.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs italic">
            No prompt rules found for this filter. Create one or load a preset above.
          </div>
        ) : (
          filteredRules.map((r) => {
            const isEditing = editingId === r.id;

            return (
              <div
                key={r.id}
                className={`p-3 rounded-xl border transition-all text-xs ${
                  r.enabled
                    ? 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                    : 'bg-slate-950/40 border-slate-900 opacity-60'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Toggle enable */}
                    <button
                      type="button"
                      onClick={() => onUpdateRule(r.id, { enabled: !r.enabled })}
                      className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        r.enabled ? 'bg-cyan-500' : 'bg-slate-700'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                          r.enabled ? 'translate-x-3' : 'translate-x-0'
                        }`}
                      />
                    </button>

                    <span className="font-bold text-slate-200">{r.name}</span>

                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded border uppercase font-bold ${getSeverityBadge(
                        r.severity
                      )}`}
                    >
                      {r.severity}
                    </span>

                    {/* Camera / Group Scope Badge */}
                    {renderTargetBadge(r)}

                    <span className="text-[10px] font-mono bg-slate-900 text-slate-400 px-1.5 py-0.5 rounded border border-slate-800 capitalize">
                      {r.category}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    {r.detectionCount > 0 && (
                      <span className="text-[10px] bg-rose-500/20 text-rose-300 border border-rose-500/40 px-1.5 py-0.5 rounded-full font-mono">
                        {r.detectionCount} breaches
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        if (isEditing) {
                          onUpdateRule(r.id, { prompt: editingPrompt });
                          setEditingId(null);
                        } else {
                          setEditingId(r.id);
                          setEditingPrompt(r.prompt);
                        }
                      }}
                      className="p-1 text-slate-400 hover:text-slate-200 rounded"
                      title={isEditing ? 'Save prompt' : 'Edit prompt'}
                    >
                      {isEditing ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Edit2 className="w-3.5 h-3.5" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => onDeleteRule(r.id)}
                      className="p-1 text-slate-500 hover:text-rose-400 rounded"
                      title="Delete rule"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Prompt Text / Inline Editor */}
                {isEditing ? (
                  <div className="mt-2 flex flex-col gap-2">
                    <textarea
                      value={editingPrompt}
                      onChange={(e) => setEditingPrompt(e.target.value)}
                      rows={2}
                      className="w-full bg-slate-900 border border-cyan-500 rounded p-2 text-xs text-white focus:outline-none"
                    />
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="px-2 py-0.5 rounded text-[11px] text-slate-400 hover:text-white"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onUpdateRule(r.id, { prompt: editingPrompt });
                          setEditingId(null);
                        }}
                        className="px-2.5 py-0.5 rounded text-[11px] bg-cyan-500 text-slate-950 font-bold"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/80 mt-1">
                    <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider block mb-0.5">
                      Target Prompt Condition:
                    </span>
                    <p className="text-slate-300 font-mono text-[11px] leading-relaxed">
                      "{r.prompt}"
                    </p>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
