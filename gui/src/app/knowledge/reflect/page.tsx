"use client";

import { useState, useRef } from "react";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import { Breadcrumb, PageHeader, Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { NoProjectGuard } from "@/components/no-project-guard";
import { ProjectBadge } from "@/components/project-badge";
import { Sparkles } from "lucide-react";

type SourceLesson = { lesson_id: string; title: string; content?: string };

function ReflectInner() {
  const { projectId } = useProject();
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [topic, setTopic] = useState("");
  const [answer, setAnswer] = useState("");
  const [warning, setWarning] = useState("");
  const [sources, setSources] = useState<SourceLesson[]>([]);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!projectId || !topic.trim()) return;
    setLoading(true);
    setAnswer(""); setWarning(""); setSources([]);
    try {
      // Pull the most relevant lessons for the topic, then synthesize over them.
      let bullets: string[] = [];
      let used: SourceLesson[] = [];
      try {
        const res = await api.searchLessons({ project_id: projectId, query: topic.trim(), limit: 8 });
        // searchLessons responds with `matches`; without it reflect lost all grounding
        // bullets and the Sources panel was always empty. (QC GUI-04.)
        const items: any[] = res.matches ?? res.items ?? res.results ?? res.lessons ?? [];
        used = items.map((l) => ({ lesson_id: l.lesson_id, title: l.title, content: l.content ?? l.content_snippet }));
        bullets = items.map((l) => { const body = l.content ?? l.content_snippet; return body ? `${l.title}: ${body}` : l.title; }).filter(Boolean);
      } catch {
        /* no lessons / search unavailable — reflect on the topic alone */
      }
      setSources(used);

      const r = await api.reflect(projectId, { topic: topic.trim(), bullets });
      setAnswer(r.answer ?? "");
      if (r.warning) setWarning(r.warning);
    } catch (e) {
      toastRef.current("error", e instanceof Error ? e.message : "Reflect failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-6">
      <PageHeader
        title="Reflect"
        subtitle="Ask a question; get an LLM-synthesized answer drawn from this project's lessons."
        breadcrumb={<Breadcrumb items={[{ label: "Knowledge", href: "/lessons" }, { label: "Reflect" }]} />}
        projectBadge={<ProjectBadge />}
      />

      <div className="flex items-center gap-2 mb-4">
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") run(); }}
          placeholder="e.g. How do we handle authentication?"
          className="flex-1 rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600"
        />
        <Button onClick={run} disabled={loading || !topic.trim()}>
          <Sparkles size={16} /> {loading ? "Reflecting…" : "Reflect"}
        </Button>
      </div>

      {warning && (
        <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
          {warning}
        </div>
      )}

      {answer && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 mb-4">
          <div className="text-[11px] uppercase tracking-wide text-zinc-600 mb-2">Synthesis</div>
          <p className="text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed">{answer}</p>
        </div>
      )}

      {sources.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-zinc-600 mb-2">
            Drawn from {sources.length} lesson{sources.length === 1 ? "" : "s"}
          </div>
          <div className="space-y-1">
            {sources.map((s) => (
              <a
                key={s.lesson_id}
                href={`/lessons/${encodeURIComponent(s.lesson_id)}`}
                className="block text-xs text-zinc-400 hover:text-zinc-200 truncate rounded px-2 py-1 hover:bg-zinc-900"
              >
                {s.title}
              </a>
            ))}
          </div>
        </div>
      )}

      {!answer && !loading && !warning && (
        <p className="text-xs text-zinc-600">
          Reflect uses the configured chat model (requires <code>DISTILLATION_ENABLED=true</code>). Agents can call the
          same capability over MCP via <code>reflect</code>.
        </p>
      )}
    </div>
  );
}

export default function ReflectPage() {
  return (
    <NoProjectGuard>
      <ReflectInner />
    </NoProjectGuard>
  );
}
