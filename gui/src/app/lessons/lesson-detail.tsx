"use client";

import { SlideOver, SlideOverSection } from "@/components/ui/slide-over";
import { Badge, Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import type { Lesson } from "./types";

interface LessonDetailProps {
  lesson: Lesson | null;
  onClose: () => void;
  onStatusChange: () => void;
  onTagClick: (tag: string) => void;
}

export function LessonDetail({ lesson, onClose, onStatusChange, onTagClick }: LessonDetailProps) {
  const { toast } = useToast();
  const { projectId } = useProject();

  if (!lesson) return null;

  const changeStatus = async (status: string) => {
    try {
      await api.updateLessonStatus(lesson.lesson_id, { project_id: projectId, status });
      toast("success", `Lesson marked as ${status}`);
      onStatusChange();
      onClose();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Status change failed");
    }
  };

  const copyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(lesson, null, 2));
    toast("success", "Copied to clipboard");
  };

  const created = new Date(lesson.created_at);
  const dateStr = created.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

  return (
    <SlideOver
      open={!!lesson}
      onClose={onClose}
      title={lesson.title}
      subtitle={
        <div className="flex gap-1.5 mt-1">
          <Badge value={lesson.lesson_type} variant="type" />
          <Badge value={lesson.status} variant="status" />
        </div>
      }
      footer={
        <div className="flex items-center gap-2">
          {lesson.status === "active" && (
            <>
              <Button variant="outline" size="sm" onClick={() => changeStatus("superseded")}>
                Mark Superseded
              </Button>
              <Button variant="outline" size="sm" onClick={() => changeStatus("archived")}>
                Archive
              </Button>
            </>
          )}
          {lesson.status === "archived" && (
            <Button variant="outline" size="sm" onClick={() => changeStatus("active")}>
              Reactivate
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={copyJson}>
            Copy JSON
          </Button>
          <a
            href={`/lessons/${lesson.lesson_id}`}
            className="text-xs text-blue-500 hover:underline ml-auto"
          >
            Open full page &rarr;
          </a>
        </div>
      }
    >
      <div className="flex gap-4 text-xs text-zinc-600 font-mono mb-4">
        <span>ID: {lesson.lesson_id.slice(0, 8)}</span>
        <span>{dateStr}</span>
        {lesson.captured_by && <span>by {lesson.captured_by}</span>}
      </div>

      <SlideOverSection title="Content">
        <div className="whitespace-pre-wrap">{lesson.content}</div>
      </SlideOverSection>

      {lesson.tags.length > 0 && (
        <SlideOverSection title="Tags">
          <div className="flex flex-wrap gap-1.5">
            {lesson.tags.map((t) => (
              <span
                key={t}
                onClick={() => { onClose(); onTagClick(t); }}
                className="px-2.5 py-0.5 rounded-full text-xs bg-zinc-800 text-zinc-400 hover:text-zinc-200 cursor-pointer transition-colors"
              >
                {t}
              </span>
            ))}
          </div>
        </SlideOverSection>
      )}

      {lesson.source_refs.length > 0 && (
        <SlideOverSection title="Source Refs">
          <div className="font-mono text-xs text-zinc-600 leading-loose">
            {lesson.source_refs.map((ref, i) => (
              <div key={i}>{ref}</div>
            ))}
          </div>
        </SlideOverSection>
      )}

      {lesson.superseded_by && (
        <SlideOverSection title="Superseded By">
          <span className="font-mono text-xs text-zinc-500">{lesson.superseded_by}</span>
        </SlideOverSection>
      )}
    </SlideOver>
  );
}
