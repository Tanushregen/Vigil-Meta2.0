import React, { useState } from 'react';
import {
  AlertOctagon,
  Download,
  Trash2,
  CheckCircle,
  Eye,
  MessageSquare,
  ExternalLink,
  X,
  Filter,
  ShieldAlert,
  Search,
} from 'lucide-react';
import { ViolationIncident, RuleSeverity } from '../types';

interface IncidentAuditFeedProps {
  incidents: ViolationIncident[];
  onUpdateStatus: (id: string, status: 'active' | 'acknowledged' | 'resolved') => void;
  onClearIncidents: () => void;
}

export const IncidentAuditFeed: React.FC<IncidentAuditFeedProps> = ({
  incidents,
  onUpdateStatus,
  onClearIncidents,
}) => {
  const [selectedIncident, setSelectedIncident] = useState<ViolationIncident | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const filteredIncidents = incidents.filter((inc) => {
    if (filterSeverity !== 'all' && inc.severity !== filterSeverity) return false;
    if (filterStatus !== 'all' && inc.status !== filterStatus) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      return (
        inc.ruleName.toLowerCase().includes(term) ||
        inc.explanation.toLowerCase().includes(term) ||
        (inc.textEvidence && inc.textEvidence.toLowerCase().includes(term))
      );
    }
    return true;
  });

  const getSeverityStyle = (sev: RuleSeverity) => {
    switch (sev) {
      case 'critical':
        return 'text-rose-400 bg-rose-500/10 border-rose-500/30';
      case 'high':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      case 'medium':
        return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30';
      case 'low':
        return 'text-blue-400 bg-blue-500/10 border-blue-500/30';
    }
  };

  // Export incidents as CSV
  const exportAsCsv = () => {
    if (incidents.length === 0) return;
    const headers = [
      'Incident ID',
      'Timestamp',
      'Rule Name',
      'Severity',
      'Category',
      'Stream',
      'Confidence %',
      'Explanation',
      'Status',
    ];

    const rows = incidents.map((i) => [
      `"${i.id}"`,
      `"${i.timestamp}"`,
      `"${i.ruleName.replace(/"/g, '""')}"`,
      `"${i.severity}"`,
      `"${i.category}"`,
      `"${i.streamType}"`,
      `"${i.confidence}"`,
      `"${i.explanation.replace(/"/g, '""')}"`,
      `"${i.status}"`,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `compliance_audit_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export incidents as formatted JSON
  const exportAsJson = () => {
    if (incidents.length === 0) return;
    const blob = new Blob([JSON.stringify(incidents, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `compliance_audit_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex flex-col bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl">
      {/* Header and Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3 mb-3">
        <div className="flex items-center gap-2">
          <AlertOctagon className="w-4 h-4 text-rose-500" />
          <h2 className="font-bold text-sm text-slate-100">Live Incident & Audit Log</h2>
          <span className="text-[11px] bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2 py-0.5 rounded-full font-mono">
            {incidents.filter((i) => i.status === 'active').length} Unresolved
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportAsCsv}
            disabled={incidents.length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 disabled:opacity-40 border border-slate-800 text-slate-300 text-xs font-semibold cursor-pointer transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            CSV Report
          </button>

          <button
            type="button"
            onClick={exportAsJson}
            disabled={incidents.length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 disabled:opacity-40 border border-slate-800 text-slate-300 text-xs font-semibold cursor-pointer transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            JSON
          </button>

          <button
            type="button"
            onClick={onClearIncidents}
            disabled={incidents.length === 0}
            className="p-1.5 rounded-lg bg-slate-950 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-800/40 text-slate-400 hover:text-rose-400 text-xs transition-colors"
            title="Clear all incidents"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 text-xs">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search incidents or evidence..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none"
          >
            <option value="all">All Severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
      </div>

      {/* Incidents Table / Feed */}
      <div className="flex flex-col gap-2 max-h-[460px] overflow-y-auto pr-1">
        {filteredIncidents.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs italic bg-slate-950/40 rounded-xl border border-slate-800/60">
            No violation incidents logged yet. Start monitoring or trigger a scenario to record events.
          </div>
        ) : (
          filteredIncidents.map((inc) => {
            return (
              <div
                key={inc.id}
                className={`p-3 rounded-xl border transition-all text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                  inc.status === 'active'
                    ? 'bg-slate-950/90 border-slate-800 hover:border-slate-700'
                    : 'bg-slate-950/40 border-slate-900 opacity-70'
                }`}
              >
                {/* Left details */}
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  {/* Thumbnail or Icon */}
                  {inc.visualEvidence ? (
                    <div
                      onClick={() => setSelectedIncident(inc)}
                      className="relative w-14 h-10 rounded-lg overflow-hidden border border-slate-700 shrink-0 cursor-pointer group bg-black"
                    >
                      <img
                        src={inc.visualEvidence}
                        alt="Violation snapshot"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        <Eye className="w-3.5 h-3.5 text-white" />
                      </div>
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0">
                      <MessageSquare className="w-4 h-4 text-emerald-400" />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-bold text-slate-200 truncate">{inc.ruleName}</span>
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded border uppercase font-bold ${getSeverityStyle(
                          inc.severity
                        )}`}
                      >
                        {inc.severity}
                      </span>
                      <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/40 px-1.5 py-0.5 rounded border border-cyan-800/40">
                        {inc.confidence}% conf
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {new Date(inc.timestamp).toLocaleTimeString()}
                      </span>
                      {inc.modelEngine && (
                        <span className="text-[10px] font-mono text-purple-300 bg-purple-950/40 px-1.5 py-0.5 rounded border border-purple-800/40">
                          {inc.modelEngine.startsWith('Meta') ? inc.modelEngine : `Meta ${inc.modelEngine}`}
                        </span>
                      )}
                    </div>

                    <p className="text-slate-300 text-[11px] leading-relaxed line-clamp-2">
                      {inc.explanation}
                    </p>

                    {inc.textEvidence && (
                      <p className="mt-1 font-mono text-[10px] bg-slate-900/80 text-rose-300 px-2 py-0.5 rounded border border-slate-800 inline-block">
                        Excerpt: "{inc.textEvidence}"
                      </p>
                    )}
                  </div>
                </div>

                {/* Right Action buttons */}
                <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                  {inc.visualEvidence && (
                    <button
                      type="button"
                      onClick={() => setSelectedIncident(inc)}
                      className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 text-[11px] font-medium border border-slate-800 flex items-center gap-1 cursor-pointer"
                    >
                      <Eye className="w-3 h-3 text-cyan-400" />
                      Evidence
                    </button>
                  )}

                  {inc.status === 'active' && (
                    <button
                      type="button"
                      onClick={() => onUpdateStatus(inc.id, 'acknowledged')}
                      className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[11px] font-semibold cursor-pointer"
                    >
                      Acknowledge
                    </button>
                  )}

                  {inc.status !== 'resolved' && (
                    <button
                      type="button"
                      onClick={() => onUpdateStatus(inc.id, 'resolved')}
                      className="px-2 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-semibold cursor-pointer flex items-center gap-1"
                    >
                      <CheckCircle className="w-3 h-3" />
                      Resolve
                    </button>
                  )}

                  {inc.status === 'resolved' && (
                    <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> Resolved
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Snapshot Lightbox Evidence Modal */}
      {selectedIncident && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-500" />
                <span className="font-bold text-sm text-slate-100">
                  Incident Evidence & Audit Details
                </span>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase font-bold ${getSeverityStyle(
                    selectedIncident.severity
                  )}`}
                >
                  {selectedIncident.severity}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedIncident(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4">
              {/* Snapshot image with bounding box indication */}
              {selectedIncident.visualEvidence && (
                <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-black aspect-video flex items-center justify-center">
                  <img
                    src={selectedIncident.visualEvidence}
                    alt="Captured violation"
                    className="w-full h-full object-contain"
                  />
                  {selectedIncident.box2d && (
                    <div
                      style={{
                        top: `${(selectedIncident.box2d.ymin / 1000) * 100}%`,
                        left: `${(selectedIncident.box2d.xmin / 1000) * 100}%`,
                        width: `${((selectedIncident.box2d.xmax - selectedIncident.box2d.xmin) / 1000) * 100}%`,
                        height: `${((selectedIncident.box2d.ymax - selectedIncident.box2d.ymin) / 1000) * 100}%`,
                      }}
                      className="absolute border-2 border-rose-500 bg-rose-500/20 rounded shadow-[0_0_15px_rgba(244,63,94,0.7)] pointer-events-none"
                    >
                      <span className="absolute top-1 left-1 bg-rose-600 text-white font-mono text-[10px] px-1 py-0.5 rounded font-bold">
                        {selectedIncident.detectedLabel || 'Violation Object'}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Data fields */}
              <div className="grid grid-cols-2 gap-3 text-xs bg-slate-950 p-3 rounded-xl border border-slate-800">
                <div>
                  <span className="text-[10px] font-mono text-slate-500 uppercase block">Rule Name</span>
                  <span className="font-semibold text-slate-200">{selectedIncident.ruleName}</span>
                </div>
                <div>
                  <span className="text-[10px] font-mono text-slate-500 uppercase block">Recorded At</span>
                  <span className="font-mono text-slate-300">
                    {new Date(selectedIncident.timestamp).toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-mono text-slate-500 uppercase block">Confidence Score</span>
                  <span className="font-bold text-cyan-400 font-mono">{selectedIncident.confidence}%</span>
                </div>
                <div>
                  <span className="text-[10px] font-mono text-slate-500 uppercase block">Category</span>
                  <span className="capitalize text-slate-300">{selectedIncident.category}</span>
                </div>
              </div>

              <div>
                <span className="text-[11px] font-mono text-cyan-400 uppercase tracking-wider block mb-1">
                  Evaluated Rule Prompt:
                </span>
                <p className="text-xs bg-slate-950 border border-slate-800 p-2.5 rounded-lg font-mono text-slate-300">
                  "{selectedIncident.rulePrompt}"
                </p>
              </div>

              <div>
                <span className="text-[11px] font-mono text-rose-400 uppercase tracking-wider block mb-1">
                  AI Violation Evidence & Observation:
                </span>
                <p className="text-xs bg-rose-950/20 border border-rose-500/30 p-2.5 rounded-lg text-rose-200 leading-relaxed">
                  {selectedIncident.explanation}
                </p>
              </div>
            </div>

            <div className="p-3 border-t border-slate-800 bg-slate-950/60 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelectedIncident(null)}
                className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
