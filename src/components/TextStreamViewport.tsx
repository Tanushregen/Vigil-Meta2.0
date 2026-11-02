import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Send,
  Mic,
  MicOff,
  Play,
  Pause,
  AlertTriangle,
  Bot,
  User,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { PromptRule, ViolationIncident } from '../types';
import { soundFx } from '../utils/audioAlert';
import { safePostJson } from '../utils/apiClient';

interface TextStreamViewportProps {
  rules: PromptRule[];
  onViolationDetected: (incident: Omit<ViolationIncident, 'id' | 'timestamp' | 'status'>, textSnippet: string) => void;
  isMonitoring: boolean;
}

interface StreamMessage {
  id: string;
  sender: 'customer' | 'agent' | 'system' | 'mic';
  text: string;
  timestamp: string;
  isViolated?: boolean;
  violationReason?: string;
  ruleName?: string;
}

const SAMPLE_TEXT_STREAM: { sender: 'customer' | 'agent'; text: string }[] = [
  { sender: 'customer', text: 'Hello, I need help updating my billing information on file.' },
  { sender: 'agent', text: 'Sure thing! Can you verify your account email address?' },
  { sender: 'customer', text: 'Yes, it is customer@example.com, and here is my SSN: 000-12-3456 please hurry up!' },
  { sender: 'agent', text: 'I have received your account email. Please never share your full social security number over chat.' },
  { sender: 'customer', text: 'This service is completely unacceptable! You are incompetent and I am going to report this entire company!' },
  { sender: 'agent', text: 'I understand your frustration and am escalating this directly to our supervisor.' },
  { sender: 'customer', text: 'My credit card number is 4532-8921-9923-4123 with CVV 891 exp 08/29, run the charge right now.' },
  { sender: 'agent', text: 'For your security, our system blocks plain credit card transmission. Direct payment links are provided in the portal.' },
];

export const TextStreamViewport: React.FC<TextStreamViewportProps> = ({
  rules,
  onViolationDetected,
  isMonitoring,
}) => {
  const [messages, setMessages] = useState<StreamMessage[]>([
    {
      id: 'm-0',
      sender: 'system',
      text: 'Text stream audit engine initialized. Active prompt rules are listening to inbound logs & transcripts.',
      timestamp: new Date().toLocaleTimeString(),
    },
  ]);
  const [customInput, setCustomInput] = useState<string>('');
  const [isAutoSimulating, setIsAutoSimulating] = useState<boolean>(true);
  const [isListeningMic, setIsListeningMic] = useState<boolean>(false);
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const simIndexRef = useRef<number>(0);
  const recognitionRef = useRef<any>(null);

  // Auto-scroll messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Evaluate single text message against active prompt rules
  const evaluateTextMessage = async (text: string, sender: 'customer' | 'agent' | 'system' | 'mic') => {
    const activeRules = rules.filter(
      (r) => r.enabled && (r.streamType === 'text' || r.streamType === 'both')
    );
    if (activeRules.length === 0) {
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}`,
          sender,
          text,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
      return;
    }

    setIsEvaluating(true);
    try {
      const { success, data, error } = await safePostJson('/api/evaluate-text', {
        text,
        rules: activeRules,
      });

      if (!success || !data) {
        if (error) console.warn('Text evaluation notice:', error);
        setMessages((prev) => [
          ...prev,
          {
            id: `msg-${Date.now()}`,
            sender,
            text,
            timestamp: new Date().toLocaleTimeString(),
          },
        ]);
        return;
      }

      const violations = data.violations || [];
      const hasViolation = violations.length > 0;

      let violationReason = '';
      let ruleName = '';

      if (hasViolation) {
        violations.forEach((v: any) => {
          const rule = rules.find((r) => r.id === v.ruleId);
          ruleName = rule?.name || 'Text Policy Rule';
          violationReason = v.explanation;

          onViolationDetected(
            {
              ruleId: v.ruleId,
              ruleName,
              rulePrompt: rule?.prompt || '',
              severity: rule?.severity || 'high',
              category: rule?.category || 'compliance',
              streamType: 'text',
              confidence: v.confidence || 90,
              explanation: v.explanation,
              textEvidence: v.excerpt || text,
            },
            text
          );

          if (rule?.severity === 'critical') {
            soundFx.playCriticalAlert();
          } else {
            soundFx.playWarningPing();
          }
        });
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}`,
          sender,
          text,
          timestamp: new Date().toLocaleTimeString(),
          isViolated: hasViolation,
          violationReason,
          ruleName,
        },
      ]);
    } catch (err) {
      console.error('Text eval error:', err);
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}`,
          sender,
          text,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    } finally {
      setIsEvaluating(false);
    }
  };

  // Automated stream simulator loop
  useEffect(() => {
    if (!isMonitoring || !isAutoSimulating) return;

    const interval = setInterval(() => {
      const sample = SAMPLE_TEXT_STREAM[simIndexRef.current % SAMPLE_TEXT_STREAM.length];
      simIndexRef.current += 1;
      evaluateTextMessage(sample.text, sample.sender);
    }, 4500);

    return () => clearInterval(interval);
  }, [isMonitoring, isAutoSimulating, rules]);

  // Speech Recognition setup (Web Speech API)
  const toggleSpeechRecognition = () => {
    if (isListeningMic) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        setIsListeningMic(false);
      }
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser. Please type in the input box.');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        const transcript = event.results[event.results.length - 1][0].transcript;
        if (transcript.trim()) {
          evaluateTextMessage(transcript.trim(), 'mic');
        }
      };

      recognition.onerror = (err: any) => {
        console.error('Speech recognition error:', err);
        setIsListeningMic(false);
      };

      recognition.onend = () => {
        setIsListeningMic(false);
      };

      recognition.start();
      recognitionRef.current = recognition;
      setIsListeningMic(true);
    } catch (e) {
      console.error('Failed to start speech recognition', e);
    }
  };

  const handleSendCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customInput.trim()) return;
    evaluateTextMessage(customInput.trim(), 'customer');
    setCustomInput('');
  };

  return (
    <div className="flex flex-col h-full bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-cyan-400" />
          <h3 className="font-semibold text-sm text-slate-100">Live Transcript & Text Stream</h3>
          <span className="text-[11px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-mono">
            Prompt Rules Applied
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsAutoSimulating(!isAutoSimulating)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
              isAutoSimulating
                ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
          >
            {isAutoSimulating ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            Auto Log Stream: {isAutoSimulating ? 'ON' : 'OFF'}
          </button>

          <button
            type="button"
            onClick={toggleSpeechRecognition}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
              isListeningMic
                ? 'bg-rose-500 text-white border-rose-500 animate-pulse'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
            }`}
          >
            {isListeningMic ? <Mic className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}
            Mic Ingest
          </button>
        </div>
      </div>

      {/* Message Stream Feed */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-2.5 pr-1 max-h-[360px] min-h-[220px]"
      >
        {messages.map((m) => {
          return (
            <div
              key={m.id}
              className={`p-3 rounded-xl border transition-all text-xs ${
                m.isViolated
                  ? 'bg-rose-950/40 border-rose-500/60 shadow-lg shadow-rose-950/30'
                  : m.sender === 'system'
                  ? 'bg-slate-950/60 border-slate-800/80 text-slate-400 italic'
                  : 'bg-slate-950/40 border-slate-800/70 text-slate-200'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold capitalize flex items-center gap-1 text-[11px] text-slate-400">
                  {m.sender === 'customer' && <User className="w-3 h-3 text-cyan-400" />}
                  {m.sender === 'agent' && <Bot className="w-3 h-3 text-emerald-400" />}
                  {m.sender === 'mic' && <Mic className="w-3 h-3 text-rose-400" />}
                  {m.sender}
                </span>
                <span className="text-[10px] font-mono text-slate-500">{m.timestamp}</span>
              </div>

              <p className="leading-relaxed">{m.text}</p>

              {m.isViolated && (
                <div className="mt-2 pt-2 border-t border-rose-500/30 flex items-start gap-1.5 text-rose-300 bg-rose-500/10 p-2 rounded-lg">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-400" />
                  <div>
                    <span className="font-bold text-rose-200">VIOLATION: {m.ruleName}</span>
                    <p className="text-[11px] text-rose-300/90 mt-0.5">{m.violationReason}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Input Form */}
      <form onSubmit={handleSendCustom} className="mt-3 flex items-center gap-2">
        <input
          type="text"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          placeholder="Type or paste sample transcript text to test against rules..."
          className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
        />
        <button
          type="submit"
          disabled={!customInput.trim() || isEvaluating}
          className="px-3 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer shadow-md shadow-cyan-500/20"
        >
          <Send className="w-3.5 h-3.5" />
          Evaluate
        </button>
      </form>
    </div>
  );
};
