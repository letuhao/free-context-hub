"use client";

import { useState } from "react";
import { useProject } from "@/contexts/project-context";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { Sparkles, Check, X } from "lucide-react";

type AiSuggestion = {
  original: string;
  suggested: string;
  accepted: boolean | null; // null = pending
};

interface AiEditorProps {
  lessonId: string;
  content: string;
  onApply: (newContent: string) => void;
  onClose: () => void;
}

const QUICK_ACTIONS = ["Clarify", "Simplify", "Expand"] as const;

export function AiEditor({ lessonId, content, onApply, onClose }: AiEditorProps) {
  const { projectId } = useProject();
  const { toast } = useToast();

  const [instruction, setInstruction] = useState("");
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  const generate = async (instr: string) => {
    if (!instr.trim()) return;
    setLoading(true);
    setSuggestions([]);
    try {
      const res = await api.improveLessonContent(lessonId, {
        project_id: projectId,
        instruction: instr,
      });
      const items: AiSuggestion[] = (res.suggestions ?? []).map((s: any) => ({
        original: s.original ?? content,
        suggested: s.suggested ?? s.improved ?? s.text ?? "",
        accepted: null,
      }));
      if (items.length === 0 && res.status === "ok") {
        // If API returns single improved text
        items.push({ original: content, suggested: (res as any).improved ?? content, accepted: null });
      }
      setSuggestions(items.length > 0 ? items : [{ original: content, suggested: content, accepted: null }]);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "AI generation failed");
    } finally {
      setLoading(false);
    }
  };

  const handleQuickAction = (action: string) => {
    generate(action + " this lesson content");
  };

  const handleCustomGenerate = () => {
    generate(instruction);
  };

  const setAccepted = (idx: number, accepted: boolean) => {
    setSuggestions((prev) => prev.map((s, i) => i === idx ? { ...s, accepted } : s));
  };

  const acceptAll = () => {
    setSuggestions((prev) => prev.map((s) => ({ ...s, accepted: true })));
  };

  const rejectAll = () => {
    setSuggestions((prev) => prev.map((s) => ({ ...s, accepted: false })));
  };

  const applyChanges = () => {
    // Build new content from accepted suggestions
    let result = content;
    for (const s of suggestions) {
      if (s.accepted && s.original && s.suggested) {
        result = result.replace(s.original, s.suggested);
      }
    }
    onApply(result);
  };

  const hasDecisions = suggestions.length > 0 && suggestions.every((s) => s.accepted !== null);
  const hasAccepted = suggestions.some((s) => s.accepted === true);

  return (
    <div className="space-y-4">
      {/* AI Assist toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-zinc-600 mr-1">AI Assist:</span>
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action}
              onClick={() => handleQuickAction(action)}
              disabled={loading}
              className="px-2 py-0.5 text-[10px] bg-purple-600/15 hover:bg-purple-600/25 border border-purple-700/40 rounded text-purple-400 transition-colors disabled:opacity-50"
            >
              {action}
            </button>
          ))}
          <button
            onClick={() => setShowPrompt(!showPrompt)}
            disabled={loading}
            className="px-2 py-0.5 text-[10px] bg-purple-600/15 hover:bg-purple-600/25 border border-purple-700/40 rounded text-purple-400 transition-colors disabled:opacity-50"
          >
            Custom...
          </button>
        </div>
      </div>

      {/* Custom prompt input */}
      {showPrompt && (
        <div className="bg-purple-950/20 border border-purple-800/30 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={14} className="text-purple-400" />
            <span className="text-xs text-purple-300 font-medium">AI Assist</span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCustomGenerate(); }}
              placeholder="Tell AI what to do with the content..."
              className="flex-1 px-3 py-1.5 bg-zinc-900 border border-purple-800/40 rounded-md text-xs text-zinc-300 outline-none focus:border-purple-600/60 placeholder:text-zinc-600"
              autoFocus
            />
            <button
              onClick={handleCustomGenerate}
              disabled={!instruction.trim() || loading}
              className="px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-500 rounded-md text-white font-medium transition-colors shrink-0 disabled:opacity-50"
            >
              {loading ? "Generating..." : "Generate"}
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-xs text-purple-400 py-4 text-center animate-pulse">
          <Sparkles size={16} className="inline mr-1" />
          AI is analyzing your content...
        </div>
      )}

      {/* Diff view */}
      {suggestions.length > 0 && !loading && (
        <div className="border border-purple-800/30 rounded-lg overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 bg-purple-950/20 border-b border-purple-800/30">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-purple-400" />
              <span className="text-xs text-purple-300 font-medium">
                AI Suggestions — {suggestions.length} change{suggestions.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={acceptAll}
                className="px-2.5 py-1 text-[10px] bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-700/40 rounded text-emerald-400 font-medium transition-colors"
              >
                Accept All
              </button>
              <button
                onClick={rejectAll}
                className="px-2.5 py-1 text-[10px] bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-zinc-400 transition-colors"
              >
                Reject All
              </button>
            </div>
          </div>

          {/* Chunks */}
          {suggestions.map((s, idx) => (
            <div key={idx} className={idx < suggestions.length - 1 ? "border-b border-zinc-800" : ""}>
              <div className="flex items-center justify-between px-4 py-1.5 bg-zinc-900/50">
                <span className="text-[10px] text-zinc-500">Change {idx + 1} of {suggestions.length}</span>
                <div className="flex items-center gap-1">
                  {s.accepted === null ? (
                    <>
                      <button
                        onClick={() => setAccepted(idx, true)}
                        className="px-2 py-0.5 text-[10px] bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-700/40 rounded text-emerald-400 transition-colors flex items-center gap-0.5"
                      >
                        <Check size={10} /> Accept
                      </button>
                      <button
                        onClick={() => setAccepted(idx, false)}
                        className="px-2 py-0.5 text-[10px] bg-red-600/15 hover:bg-red-600/25 border border-red-700/40 rounded text-red-400 transition-colors flex items-center gap-0.5"
                      >
                        <X size={10} /> Reject
                      </button>
                    </>
                  ) : s.accepted ? (
                    <span className="text-[10px] text-emerald-400 flex items-center gap-0.5"><Check size={10} /> Accepted</span>
                  ) : (
                    <span className="text-[10px] text-red-400 flex items-center gap-0.5"><X size={10} /> Rejected</span>
                  )}
                </div>
              </div>
              <div className="px-4 py-2 text-xs font-mono leading-relaxed">
                <div className="bg-red-500/[0.08] text-red-300 px-2 py-1 rounded-sm border-l-2 border-red-500/40 line-through decoration-red-500/40 whitespace-pre-wrap">
                  {s.original.slice(0, 500)}
                </div>
                <div className="bg-emerald-500/[0.08] text-emerald-300 px-2 py-1 rounded-sm border-l-2 border-emerald-500/40 mt-1 whitespace-pre-wrap">
                  {s.suggested.slice(0, 500)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Apply button */}
      {hasDecisions && hasAccepted && (
        <div className="flex items-center gap-2">
          <button
            onClick={applyChanges}
            className="px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-500 rounded-md text-white font-medium transition-colors"
          >
            Apply Accepted Changes
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Discard
          </button>
        </div>
      )}
    </div>
  );
}
