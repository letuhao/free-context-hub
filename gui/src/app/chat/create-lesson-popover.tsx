"use client";

import { useState } from "react";
import { useProject } from "@/contexts/project-context";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { LESSON_TYPES } from "../lessons/types";

interface CreateLessonPopoverProps {
  content: string;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateLessonPopover({ content, onClose, onCreated }: CreateLessonPopoverProps) {
  const { projectId } = useProject();
  const { toast } = useToast();

  // Extract title from first line or first sentence
  const defaultTitle = content.split("\n")[0]?.replace(/^#+\s*/, "").slice(0, 100) || "New lesson";

  const [title, setTitle] = useState(defaultTitle);
  const [lessonType, setLessonType] = useState("decision");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await api.addLesson({
        project_id: projectId,
        title,
        content,
        lesson_type: lessonType,
        tags: [],
        source_refs: [],
        captured_by: "gui-user",
      });
      toast("success", "Lesson created from chat");
      onCreated();
      onClose();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to create lesson");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="absolute top-8 left-0 z-50 w-72 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-4 space-y-3 animate-[fadeInScale_0.15s_ease-out]">
      <h4 className="text-xs font-semibold text-zinc-200">Create Lesson from This Response</h4>
      <div>
        <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 block">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-zinc-500 transition-colors"
        />
      </div>
      <div>
        <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 block">Type</label>
        <select
          value={lessonType}
          onChange={(e) => setLessonType(e.target.value)}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-zinc-500 transition-colors appearance-none"
        >
          {LESSON_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleCreate}
          disabled={!title.trim() || creating}
          className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 rounded-md text-white font-medium transition-colors disabled:opacity-50"
        >
          {creating ? "Creating..." : "Create"}
        </button>
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs bg-transparent hover:bg-zinc-800 border border-zinc-700 rounded-md text-zinc-400 hover:text-zinc-300 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
