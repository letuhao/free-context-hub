"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, type TopicWithRoster, type CoordinationEventRecord } from "@/lib/api";
import { Breadcrumb, PageHeader, Button } from "@/components/ui";
import { TableSkeleton } from "@/components/ui/loading-skeleton";
import { useToast } from "@/components/ui/toast";
import { TopicStatusPill } from "../../page";
import { Users, ScrollText, UserPlus, Lock } from "lucide-react";

const LEVELS = ["authority", "coordination", "execution"] as const;
const POLL_MS = 3000;

export default function TopicDetailPage() {
  const params = useParams<{ id: string }>();
  const topicId = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [data, setData] = useState<TopicWithRoster | null>(null);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<CoordinationEventRecord[]>([]);
  const cursorRef = useRef(0);

  // Join form
  const [joinOpen, setJoinOpen] = useState(false);
  const [actorId, setActorId] = useState("");
  const [actorType, setActorType] = useState("ai");
  const [displayName, setDisplayName] = useState("");
  const [level, setLevel] = useState<string>("execution");
  const [joining, setJoining] = useState(false);

  // Close
  const [closeTarget, setCloseTarget] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeActor, setCloseActor] = useState("");

  const fetchTopic = useCallback(async () => {
    if (!topicId) return;
    try {
      const res = await api.getTopic(topicId);
      setData(res.data);
    } catch (e) {
      toastRef.current("error", e instanceof Error ? e.message : "Failed to load topic");
    } finally {
      setLoading(false);
    }
  }, [topicId]);

  // Poll the event log forward from the cursor (cursor-replay live updates).
  const pollEvents = useCallback(async () => {
    if (!topicId) return;
    try {
      const res = await api.topicEvents(topicId, { since: cursorRef.current });
      const fresh = res.data?.events ?? [];
      if (fresh.length > 0) {
        setEvents((prev) => [...prev, ...fresh]);
        cursorRef.current = res.data.next_cursor;
      }
    } catch {
      /* transient — next tick retries */
    }
  }, [topicId]);

  useEffect(() => {
    fetchTopic();
  }, [fetchTopic]);

  useEffect(() => {
    pollEvents();
    const t = setInterval(pollEvents, POLL_MS);
    return () => clearInterval(t);
  }, [pollEvents]);

  const submitJoin = async () => {
    if (!actorId.trim() || !displayName.trim()) return;
    setJoining(true);
    try {
      await api.joinTopic(topicId, { actor_id: actorId.trim(), actor_type: actorType, display_name: displayName.trim(), level });
      toastRef.current("success", "Joined topic");
      setJoinOpen(false);
      setActorId(""); setDisplayName("");
      fetchTopic();
    } catch (e) {
      toastRef.current("error", e instanceof Error ? e.message : "Failed to join");
    } finally {
      setJoining(false);
    }
  };

  const grantLevel = async (target: string, newLevel: string, grantedBy: string) => {
    try {
      await api.grantTopicLevel(topicId, { actor_id: target, level: newLevel, granted_by: grantedBy });
      toastRef.current("success", `Granted ${newLevel} to ${target}`);
      fetchTopic();
    } catch (e) {
      toastRef.current("error", e instanceof Error ? e.message : "Grant failed");
    }
  };

  const submitClose = async () => {
    if (!closeActor.trim()) return;
    setClosing(true);
    try {
      await api.closeTopic(topicId, { actor_id: closeActor.trim() });
      toastRef.current("success", "Topic closed");
      setCloseTarget(false);
      fetchTopic();
    } catch (e) {
      toastRef.current("error", e instanceof Error ? e.message : "Close failed");
    } finally {
      setClosing(false);
    }
  };

  if (loading) {
    return <div className="max-w-5xl mx-auto px-6 py-6"><TableSkeleton /></div>;
  }
  if (!data) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-6 text-sm text-zinc-500">
        Topic not found. <Link href="/coordination" className="text-zinc-300 underline">Back to topics</Link>
      </div>
    );
  }

  const { topic, roster } = data;
  const isClosed = topic.status === "closed";

  return (
    <div className="max-w-5xl mx-auto px-6 py-6">
      <PageHeader
        title={topic.name}
        subtitle={topic.charter}
        breadcrumb={<Breadcrumb items={[{ label: "Coordination", href: "/coordination" }, { label: "Topics", href: "/coordination" }, { label: topic.name }]} />}
        actions={
          <div className="flex items-center gap-2">
            <TopicStatusPill status={topic.status} />
            {!isClosed && (
              <>
                <Button variant="outline" onClick={() => setJoinOpen(true)}><UserPlus size={16} /> Join</Button>
                <Button variant="ghost" onClick={() => setCloseTarget(true)}><Lock size={16} /> Close</Button>
              </>
            )}
          </div>
        }
      />

      <div className="grid md:grid-cols-2 gap-6">
        {/* Roster */}
        <section>
          <div className="flex items-center gap-2 mb-3 text-zinc-300">
            <Users size={16} strokeWidth={1.5} />
            <h2 className="text-sm font-semibold">Participants ({roster.length})</h2>
          </div>
          {roster.length === 0 ? (
            <p className="text-xs text-zinc-600">No participants yet.</p>
          ) : (
            <div className="space-y-2">
              {roster.map((p) => (
                <div key={p.actor_id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm text-zinc-100 truncate">{p.display_name}</div>
                      <div className="text-[11px] text-zinc-600">{p.actor_id} · {p.type}</div>
                    </div>
                    <span className="text-[11px] rounded bg-zinc-800 text-zinc-300 px-1.5 py-0.5">{p.level}</span>
                  </div>
                  {!isClosed && (
                    <div className="mt-2 flex items-center gap-1.5">
                      <select
                        defaultValue={p.level}
                        onChange={(e) => grantLevel(p.actor_id, e.target.value, roster[0]?.actor_id ?? p.actor_id)}
                        className="text-[11px] rounded bg-zinc-900 border border-zinc-800 px-1.5 py-1 text-zinc-300 outline-none"
                        title="Grant level (granted by the topic owner / an authority — enforced server-side)"
                      >
                        {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                      </select>
                      <span className="text-[10px] text-zinc-600">change level</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Event log */}
        <section>
          <div className="flex items-center gap-2 mb-3 text-zinc-300">
            <ScrollText size={16} strokeWidth={1.5} />
            <h2 className="text-sm font-semibold">Event log</h2>
            <span className="text-[10px] text-zinc-600">live · polls every {POLL_MS / 1000}s</span>
          </div>
          {events.length === 0 ? (
            <p className="text-xs text-zinc-600">No events.</p>
          ) : (
            <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
              {events.map((e) => (
                <div key={e.seq} className="rounded border border-zinc-800/70 bg-zinc-900/30 px-2.5 py-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-zinc-300">#{e.seq} {e.type}</span>
                    <span className="text-[10px] text-zinc-600">{new Date(e.created_at).toLocaleTimeString()}</span>
                  </div>
                  {e.actor_id && <div className="text-[10px] text-zinc-600">by {e.actor_id}</div>}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Join dialog */}
      {joinOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => !joining && setJoinOpen(false)}>
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-zinc-100 mb-4">Join topic</h2>
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs text-zinc-500">Actor id</span>
                <input value={actorId} onChange={(e) => setActorId(e.target.value)} placeholder="e.g. alice"
                  className="mt-1 w-full rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600" />
              </label>
              <label className="block">
                <span className="text-xs text-zinc-500">Display name</span>
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Alice"
                  className="mt-1 w-full rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-zinc-500">Type</span>
                  <select value={actorType} onChange={(e) => setActorType(e.target.value)}
                    className="mt-1 w-full rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none">
                    <option value="ai">ai</option>
                    <option value="human">human</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-zinc-500">Level</span>
                  <select value={level} onChange={(e) => setLevel(e.target.value)}
                    className="mt-1 w-full rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none">
                    {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </label>
              </div>
              <p className="text-[11px] text-zinc-600">Non-owners joining above <code>execution</code> need a level grant (enforced server-side).</p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setJoinOpen(false)} disabled={joining}>Cancel</Button>
              <Button onClick={submitJoin} disabled={joining || !actorId.trim() || !displayName.trim()}>
                {joining ? "Joining…" : "Join"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Close dialog (custom — needs an actor_id input ConfirmDialog can't host) */}
      {closeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => !closing && setCloseTarget(false)}>
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-zinc-100 mb-2">Close this topic?</h2>
            <p className="text-xs text-zinc-500">Closing seals the event log and freezes the board — no new items can be posted. This cannot be undone.</p>
            <label className="block mt-3">
              <span className="text-xs text-zinc-500">Your actor id (must be a participant)</span>
              <input value={closeActor} onChange={(e) => setCloseActor(e.target.value)} placeholder="e.g. alice"
                className="mt-1 w-full rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600" />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setCloseTarget(false)} disabled={closing}>Cancel</Button>
              <Button onClick={submitClose} disabled={closing || !closeActor.trim()}>
                {closing ? "Closing…" : "Close topic"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
