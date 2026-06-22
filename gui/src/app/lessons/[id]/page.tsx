"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import { Badge, Breadcrumb, Button, EmptyState, LineSkeleton } from "@/components/ui";
import { NoProjectGuard } from "@/components/no-project-guard";
import { relTime } from "@/lib/rel-time";
import { ArrowLeft, Sparkles, Link2 } from "lucide-react";
import type { Lesson } from "../types";

/**
 * S6 polish: deep-linkable lesson detail at `/lessons/[id]`.
 *
 * The lesson list slide-over (`LessonDetail`) is great for in-page triage, but
 * there was no stable URL to share a single lesson. This page renders a
 * read-only view of one lesson plus a "Related Lessons" section driven by
 * semantic search over the lesson's own title.
 *
 * NOTE: the shared `api` client (frozen this warp) has no single-lesson GET, so
 * we resolve the lesson from the project's list endpoint (all statuses) and
 * match by id client-side. This keeps S6 inside its write-set without editing
 * `gui/src/lib/api.ts`.
 */

type RelatedLesson = Lesson & { score?: number };

export default function LessonDeepLinkPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const lessonId = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";
  const { projectId } = useProject();

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [related, setRelated] = useState<RelatedLesson[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);

  // Resolve the lesson by id from the project list (all statuses).
  const fetchLesson = useCallback(async () => {
    if (!lessonId || !projectId) return;
    setLoading(true);
    setNotFound(false);
    try {
      const res = await api.listLessons({
        project_id: projectId,
        limit: 100,
        include_all_statuses: "true",
      });
      const items: Lesson[] = res.items ?? [];
      const found = items.find((l) => l.lesson_id === lessonId) ?? null;
      if (found) {
        setLesson(found);
      } else {
        setNotFound(true);
      }
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [lessonId, projectId]);

  useEffect(() => { fetchLesson(); }, [fetchLesson]);

  // Related lessons via semantic search over the lesson's title.
  const fetchRelated = useCallback(async () => {
    if (!lesson || !projectId) return;
    setRelatedLoading(true);
    try {
      const res = await api.searchLessons({
        project_id: projectId,
        query: lesson.title,
        limit: 6,
      });
      // searchLessons responds with `matches` (not results/items) — QC GUI-04/05.
      const hits: RelatedLesson[] = res.matches ?? res.results ?? res.items ?? [];
      // Drop the lesson itself; cap at 5.
      setRelated(hits.filter((l) => l.lesson_id !== lesson.lesson_id).slice(0, 5));
    } catch {
      setRelated([]);
    } finally {
      setRelatedLoading(false);
    }
  }, [lesson, projectId]);

  useEffect(() => { fetchRelated(); }, [fetchRelated]);

  return (
    <NoProjectGuard>
      <div className="flex-1 overflow-y-auto p-6">
        <Breadcrumb
          items={[
            { label: "Knowledge", href: "/lessons" },
            { label: "Lessons", href: "/lessons" },
            { label: lesson?.title ?? "Lesson" },
          ]}
        />

        <div className="mb-4">
          <Button variant="ghost" size="sm" onClick={() => router.push("/lessons")}>
            <ArrowLeft size={14} className="mr-1" /> Back to Lessons
          </Button>
        </div>

        {loading ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-3">
            <LineSkeleton />
            <LineSkeleton />
            <LineSkeleton />
          </div>
        ) : notFound || !lesson ? (
          <EmptyState
            icon="🔍"
            title="Lesson not found"
            description="This lesson does not exist in the current project, or it may belong to a different project. Switch projects or return to the lessons list."
            action={<Button variant="primary" onClick={() => router.push("/lessons")}>Back to Lessons</Button>}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main detail */}
            <div className="lg:col-span-2 space-y-5">
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <h1 className="text-lg font-semibold text-zinc-100 leading-snug">{lesson.title}</h1>
                </div>
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <Badge value={lesson.lesson_type} variant="type" />
                  <Badge value={lesson.status} variant="status" />
                  <span className="text-xs text-zinc-600 font-mono ml-1">ID: {lesson.lesson_id.slice(0, 8)}</span>
                  <span className="text-xs text-zinc-600">{relTime(lesson.created_at)}</span>
                  {lesson.captured_by && (
                    <span className="text-xs text-zinc-600">by {lesson.captured_by}</span>
                  )}
                </div>

                <h3 className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">Content</h3>
                <div className="text-sm text-zinc-400 leading-relaxed whitespace-pre-wrap">
                  {lesson.content}
                </div>

                {lesson.tags.length > 0 && (
                  <div className="mt-5">
                    <h3 className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">Tags</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {lesson.tags.map((t) => (
                        <span key={t} className="px-2.5 py-0.5 rounded-full text-xs bg-zinc-800 text-zinc-400">{t}</span>
                      ))}
                    </div>
                  </div>
                )}

                {lesson.source_refs.length > 0 && (
                  <div className="mt-5">
                    <h3 className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">Source Refs</h3>
                    <div className="font-mono text-xs text-zinc-600 leading-loose">
                      {lesson.source_refs.map((ref, i) => (
                        <div key={i}>{ref}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Related Lessons (semantic) */}
            <div className="lg:col-span-1">
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-zinc-200 mb-1 flex items-center gap-1.5">
                  <Sparkles size={14} className="text-purple-400" />
                  Related Lessons
                </h2>
                <p className="text-[11px] text-zinc-600 mb-4">Semantically similar knowledge in this project.</p>

                {relatedLoading ? (
                  <div className="space-y-2">
                    <LineSkeleton />
                    <LineSkeleton />
                    <LineSkeleton />
                  </div>
                ) : related.length === 0 ? (
                  <p className="text-xs text-zinc-600">
                    No related lessons found. Semantic search requires the embeddings service (LM Studio).
                  </p>
                ) : (
                  <div className="space-y-2">
                    {related.map((r) => (
                      <Link
                        key={r.lesson_id}
                        href={`/lessons/${encodeURIComponent(r.lesson_id)}`}
                        className="block px-3 py-2.5 bg-zinc-800/40 border border-zinc-800 rounded-lg hover:border-zinc-700 hover:bg-zinc-800/70 transition-colors group"
                      >
                        <div className="flex items-start gap-2">
                          <Link2 size={13} className="text-zinc-600 mt-0.5 shrink-0 group-hover:text-zinc-400" />
                          <div className="min-w-0">
                            <div className="text-xs text-zinc-300 truncate group-hover:text-zinc-100">{r.title}</div>
                            <div className="flex items-center gap-1.5 mt-1">
                              <Badge value={r.lesson_type} variant="type" />
                              {typeof r.score === "number" && (
                                <span className="text-[10px] text-zinc-600">{Math.round(r.score * 100)}% match</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </NoProjectGuard>
  );
}
