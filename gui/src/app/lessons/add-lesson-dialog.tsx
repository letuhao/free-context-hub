"use client";

import { useState } from "react";
import { useProject } from "@/contexts/project-context";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { Button } from "@/components/ui";
import { RichEditor } from "@/components/rich-editor";
import { LESSON_TYPES } from "./types";

interface AddLessonDialogProps {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
  presetType?: string;
}

const VERIFICATION_METHODS = ["user_confirmation", "recorded_test_event", "cli_exit_code"];

export function AddLessonDialog({ open, onClose, onAdded, presetType }: AddLessonDialogProps) {
  const { projectId } = useProject();
  const { toast } = useToast();

  const [title, setTitle] = useState("");
  const [type, setType] = useState(presetType ?? "decision");
  const [content, setContent] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sourceRefs, setSourceRefs] = useState("");
  const [capturedBy, setCapturedBy] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Guardrail-specific
  const [grTrigger, setGrTrigger] = useState("");
  const [grRequirement, setGrRequirement] = useState("");
  const [grVerification, setGrVerification] = useState("user_confirmation");

  const addTag = (tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) setTags([...tags, trimmed]);
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(tagsInput);
      setTagsInput("");
    }
  };

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim()) {
      toast("error", "Title and content are required");
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        project_id: projectId,
        lesson_type: type,
        title: title.trim(),
        content: content.trim(),
        tags,
      };
      if (sourceRefs.trim()) body.source_refs = sourceRefs.split(",").map((s) => s.trim()).filter(Boolean);
      if (capturedBy.trim()) body.captured_by = capturedBy.trim();
      if (type === "guardrail" && grTrigger.trim()) {
        body.guardrail_rule = {
          trigger: grTrigger.trim(),
          requirement: grRequirement.trim(),
          verification_method: grVerification,
        };
      }
      await api.addLesson(body);
      toast("success", "Lesson added");
      // Reset
      setTitle(""); setContent(""); setTags([]); setSourceRefs(""); setCapturedBy("");
      setGrTrigger(""); setGrRequirement("");
      onAdded();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to add lesson");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-[520px] max-h-[80vh] overflow-y-auto bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-2xl">
        <h3 className="text-base font-semibold text-zinc-100 mb-5">Add Lesson</h3>

        {/* Title */}
        <div className="mb-3.5">
          <label className="block text-xs text-zinc-500 mb-1">Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-md text-sm text-zinc-100 outline-none focus:border-zinc-600" placeholder="Short, descriptive title" autoFocus />
        </div>

        {/* Type */}
        <div className="mb-3.5">
          <label className="block text-xs text-zinc-500 mb-1">Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)} className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-md text-sm text-zinc-100 outline-none">
            {LESSON_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {/* Content */}
        <div className="mb-3.5">
          <label className="block text-xs text-zinc-500 mb-1">Content</label>
          <RichEditor
            value={content}
            onChange={setContent}
            placeholder="Describe the decision, workaround, or rule..."
            minHeight={120}
          />
        </div>

        {/* Tags */}
        <div className="mb-3.5">
          <label className="block text-xs text-zinc-500 mb-1">Tags</label>
          <div className="flex flex-wrap gap-1 items-center px-2 py-1.5 bg-zinc-950 border border-zinc-700 rounded-md min-h-[36px]">
            {tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 bg-zinc-800 rounded text-xs text-zinc-400">
                {t}
                <button onClick={() => setTags(tags.filter((x) => x !== t))} className="text-zinc-600 hover:text-zinc-300 font-bold">&times;</button>
              </span>
            ))}
            <input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} onKeyDown={handleTagKeyDown} onBlur={() => { if (tagsInput.trim()) { addTag(tagsInput); setTagsInput(""); } }} className="flex-1 min-w-[60px] bg-transparent text-xs text-zinc-300 outline-none" placeholder="add tag..." />
          </div>
        </div>

        {/* Advanced */}
        <button onClick={() => setShowAdvanced(!showAdvanced)} className="text-sm text-zinc-600 hover:text-zinc-400 mb-3 flex items-center gap-1">
          {showAdvanced ? "▾" : "▸"} Advanced
        </button>
        {showAdvanced && (
          <div className="border-t border-zinc-800 pt-3 space-y-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Source Refs (comma-separated)</label>
              <input value={sourceRefs} onChange={(e) => setSourceRefs(e.target.value)} className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-md text-sm text-zinc-100 outline-none" placeholder="src/db/client.ts:42, docs/adr/003.md" />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Captured By</label>
              <input value={capturedBy} onChange={(e) => setCapturedBy(e.target.value)} className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-md text-sm text-zinc-100 outline-none" placeholder="e.g. claude-code" />
            </div>
            {type === "guardrail" && (
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3.5 space-y-3 mt-2">
                <div className="text-xs text-zinc-500 mb-1">Guardrail Rule</div>
                <div>
                  <label className="block text-xs text-zinc-600 mb-1">Trigger</label>
                  <input value={grTrigger} onChange={(e) => setGrTrigger(e.target.value)} className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-md text-sm text-zinc-100 outline-none" placeholder="e.g. force push to main" />
                </div>
                <div>
                  <label className="block text-xs text-zinc-600 mb-1">Requirement</label>
                  <input value={grRequirement} onChange={(e) => setGrRequirement(e.target.value)} className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-md text-sm text-zinc-100 outline-none" placeholder="e.g. Use PR workflow instead" />
                </div>
                <div>
                  <label className="block text-xs text-zinc-600 mb-1">Verification Method</label>
                  <select value={grVerification} onChange={(e) => setGrVerification(e.target.value)} className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-md text-sm text-zinc-100 outline-none">
                    {VERIFICATION_METHODS.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-zinc-800">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Adding..." : "Add Lesson"}
          </Button>
        </div>
      </div>
    </div>
  );
}
