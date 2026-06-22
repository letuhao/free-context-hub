"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, type TopicWithRoster, type CoordinationEventRecord, type TaskSummary, type MotionRecord, type BodyRecord } from "@/lib/api";
import { useProject } from "@/contexts/project-context";
import { Breadcrumb, PageHeader, Button } from "@/components/ui";
import { TableSkeleton } from "@/components/ui/loading-skeleton";
import { useToast } from "@/components/ui/toast";
import { TopicStatusPill } from "../../page";
import { Users, ScrollText, UserPlus, Lock, ClipboardList, Plus, Vote } from "lucide-react";

type ClaimHandle = { claim_id: string; fencing_token: number };

const LEVELS = ["authority", "coordination", "execution"] as const;
const POLL_MS = 3000;

export default function TopicDetailPage() {
  const params = useParams<{ id: string }>();
  const topicId = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";
  const { projectId } = useProject();
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

  // Board
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [boardActor, setBoardActor] = useState("");
  const [claims, setClaims] = useState<Record<string, ClaimHandle>>({}); // task_id → claim
  const [taskTitle, setTaskTitle] = useState("");
  const [taskKind, setTaskKind] = useState("");
  const [posting, setPosting] = useState(false);

  // Motions (topic-scoped)
  const [motions, setMotions] = useState<MotionRecord[]>([]);
  const [bodies, setBodies] = useState<BodyRecord[]>([]);
  const [motionBody, setMotionBody] = useState("");
  const [motionSubject, setMotionSubject] = useState("");
  const [motionDeadline, setMotionDeadline] = useState("60");
  const [proposingMotion, setProposingMotion] = useState(false);

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

  const fetchBoard = useCallback(async () => {
    if (!topicId) return;
    try {
      const res = await api.listBoard(topicId);
      setTasks(res.data?.tasks ?? []);
    } catch {
      /* board may be empty / transient */
    }
  }, [topicId]);

  const fetchMotions = useCallback(async () => {
    if (!topicId) return;
    try {
      const res = await api.listMotions(topicId);
      setMotions(res.data?.motions ?? []);
    } catch { /* none yet */ }
  }, [topicId]);

  const fetchBodies = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await api.listBodies(projectId);
      setBodies(res.data?.bodies ?? []);
    } catch { /* none yet */ }
  }, [projectId]);

  useEffect(() => {
    fetchTopic();
    fetchBoard();
    fetchMotions();
    fetchBodies();
  }, [fetchTopic, fetchBoard, fetchMotions, fetchBodies]);

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

  const requireActor = (): string | null => {
    if (!boardActor.trim()) {
      toastRef.current("error", "Set 'Acting as (actor id)' first");
      return null;
    }
    return boardActor.trim();
  };

  const submitTask = async () => {
    if (!taskTitle.trim() || !taskKind.trim()) return;
    const actor = requireActor();
    if (!actor) return;
    setPosting(true);
    try {
      await api.postTask(topicId, { title: taskTitle.trim(), kind: taskKind.trim(), created_by: actor });
      toastRef.current("success", "Task posted");
      setTaskTitle(""); setTaskKind("");
      fetchBoard();
    } catch (e) {
      toastRef.current("error", e instanceof Error ? e.message : "Failed to post task");
    } finally {
      setPosting(false);
    }
  };

  const onClaim = async (task: TaskSummary) => {
    const actor = requireActor();
    if (!actor) return;
    try {
      const res = await api.claimTask(task.task_id, { actor_id: actor });
      const d = res.data;
      if (d.status === "claimed") {
        setClaims((prev) => ({ ...prev, [task.task_id]: { claim_id: d.claim_id, fencing_token: d.fencing_token } }));
        toastRef.current("success", `Claimed (token ${d.fencing_token})`);
      } else {
        toastRef.current("error", `Claim ${d.status}${"incumbent_actor_id" in d && d.incumbent_actor_id ? ` (held by ${d.incumbent_actor_id})` : ""}`);
      }
      fetchBoard();
    } catch (e) {
      toastRef.current("error", e instanceof Error ? e.message : "Claim failed");
    }
  };

  const onRelease = async (task: TaskSummary) => {
    const actor = requireActor();
    if (!actor) return;
    try {
      const res = await api.releaseTask(task.task_id, { actor_id: actor });
      toastRef.current(res.data.status === "released" ? "success" : "error", `Release: ${res.data.status}`);
      setClaims((prev) => { const n = { ...prev }; delete n[task.task_id]; return n; });
      fetchBoard();
    } catch (e) {
      toastRef.current("error", e instanceof Error ? e.message : "Release failed");
    }
  };

  const onComplete = async (task: TaskSummary) => {
    const actor = requireActor();
    if (!actor) return;
    try {
      const res = await api.completeTask(task.task_id, { actor_id: actor });
      toastRef.current(res.data.status === "completed" ? "success" : "error", `Complete: ${res.data.status}`);
      fetchBoard();
    } catch (e) {
      toastRef.current("error", e instanceof Error ? e.message : "Complete failed");
    }
  };

  const onBaseline = async (task: TaskSummary) => {
    const actor = requireActor();
    if (!actor) return;
    const handle = claims[task.task_id];
    if (!handle) { toastRef.current("error", "Claim the task first to get a fencing token"); return; }
    try {
      const res = await api.baselineArtifact(task.artifact_id, { claim_id: handle.claim_id, fencing_token: handle.fencing_token, actor_id: actor });
      toastRef.current(res.data.status?.includes("baselin") ? "success" : "error", `Baseline: ${res.data.status}`);
      fetchBoard();
    } catch (e) {
      toastRef.current("error", e instanceof Error ? e.message : "Baseline failed");
    }
  };

  const proposeMotion = async () => {
    const actor = requireActor();
    if (!actor || !motionBody || !motionSubject.trim()) return;
    setProposingMotion(true);
    try {
      const res = await api.proposeMotion(topicId, { body_id: motionBody, subject_ref: motionSubject.trim(), proposed_by: actor, deadline_minutes: Number(motionDeadline) || 60 });
      toastRef.current(res.data.status === "proposed" || res.data.motion_id ? "success" : "error", `Motion: ${res.data.status}`);
      setMotionSubject("");
      fetchMotions();
    } catch (e) {
      toastRef.current("error", e instanceof Error ? e.message : "Propose failed");
    } finally {
      setProposingMotion(false);
    }
  };

  const motionAction = async (m: MotionRecord, action: "second" | "veto" | "tally" | "for" | "against" | "abstain") => {
    const actor = requireActor();
    if (!actor) return;
    try {
      let label = action as string;
      if (action === "second") await api.secondMotion(m.motion_id, { actor_id: actor });
      else if (action === "veto") await api.vetoMotion(m.motion_id, { actor_id: actor });
      else if (action === "tally") await api.tallyMotion(m.motion_id);
      else { await api.castVote(m.motion_id, { actor_id: actor, choice: action }); label = `vote ${action}`; }
      toastRef.current("success", `${label} ok`);
      fetchMotions();
    } catch (e) {
      toastRef.current("error", e instanceof Error ? e.message : `${action} failed`);
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

      {/* Board */}
      <section className="mt-8">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 text-zinc-300">
            <ClipboardList size={16} strokeWidth={1.5} />
            <h2 className="text-sm font-semibold">Board — tasks ({tasks.length})</h2>
          </div>
          <label className="flex items-center gap-2">
            <span className="text-[11px] text-zinc-600">Acting as</span>
            <input value={boardActor} onChange={(e) => setBoardActor(e.target.value)} placeholder="actor id"
              className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-zinc-600 w-32" />
          </label>
        </div>

        {!isClosed && (
          <div className="flex items-center gap-2 mb-3">
            <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Task title"
              className="flex-1 rounded-md bg-zinc-900 border border-zinc-800 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-600" />
            <input value={taskKind} onChange={(e) => setTaskKind(e.target.value)} placeholder="kind (e.g. build)"
              className="w-40 rounded-md bg-zinc-900 border border-zinc-800 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-600" />
            <Button onClick={submitTask} disabled={posting || !taskTitle.trim() || !taskKind.trim()}>
              <Plus size={16} /> {posting ? "Posting…" : "Post task"}
            </Button>
          </div>
        )}

        {tasks.length === 0 ? (
          <p className="text-xs text-zinc-600">No tasks on the board.</p>
        ) : (
          <div className="space-y-2">
            {tasks.map((t) => {
              const held = claims[t.task_id];
              return (
                <div key={t.task_id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm text-zinc-100 truncate">{t.title}</div>
                      <div className="text-[11px] text-zinc-600 font-mono truncate">{t.artifact_id}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] rounded bg-zinc-800 text-zinc-300 px-1.5 py-0.5">{t.status}</span>
                      <span className="text-[10px] rounded bg-zinc-800/60 text-zinc-400 px-1.5 py-0.5">art: {t.artifact_state}</span>
                    </div>
                  </div>
                  {!isClosed && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <button onClick={() => onClaim(t)} className="text-[11px] rounded bg-blue-500/10 text-blue-300 px-2 py-0.5 hover:bg-blue-500/20">claim</button>
                      <button onClick={() => onRelease(t)} className="text-[11px] rounded bg-zinc-700/40 text-zinc-300 px-2 py-0.5 hover:bg-zinc-700/60">release</button>
                      <button onClick={() => onComplete(t)} className="text-[11px] rounded bg-emerald-500/10 text-emerald-300 px-2 py-0.5 hover:bg-emerald-500/20">complete</button>
                      <button onClick={() => onBaseline(t)} className="text-[11px] rounded bg-amber-500/10 text-amber-300 px-2 py-0.5 hover:bg-amber-500/20">baseline</button>
                      {held && <span className="text-[10px] text-zinc-600">claimed · token {held.fencing_token}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Motions */}
      <section className="mt-8">
        <div className="flex items-center gap-2 mb-3 text-zinc-300">
          <Vote size={16} strokeWidth={1.5} />
          <h2 className="text-sm font-semibold">Motions ({motions.length})</h2>
        </div>

        {!isClosed && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <select value={motionBody} onChange={(e) => setMotionBody(e.target.value)}
              className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-sm text-zinc-200 outline-none">
              <option value="">decision body…</option>
              {bodies.map((b) => <option key={b.body_id} value={b.body_id}>{b.name}</option>)}
            </select>
            <input value={motionSubject} onChange={(e) => setMotionSubject(e.target.value)} placeholder="subject (what is being decided)"
              className="flex-1 min-w-[12rem] rounded-md bg-zinc-900 border border-zinc-800 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-600" />
            <input value={motionDeadline} onChange={(e) => setMotionDeadline(e.target.value)} type="number" min="1" title="deadline minutes"
              className="w-20 rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-sm text-zinc-200 outline-none" />
            <Button onClick={proposeMotion} disabled={proposingMotion || !motionBody || !motionSubject.trim()}>
              <Plus size={16} /> {proposingMotion ? "Proposing…" : "Propose"}
            </Button>
          </div>
        )}
        {bodies.length === 0 && !isClosed && (
          <p className="text-[11px] text-amber-400/80 mb-2">No decision bodies yet — create one under Governance → Decision Bodies to propose a motion.</p>
        )}

        {motions.length === 0 ? (
          <p className="text-xs text-zinc-600">No motions.</p>
        ) : (
          <div className="space-y-2">
            {motions.map((m) => (
              <div key={m.motion_id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm text-zinc-100 truncate">{m.subject_ref}</div>
                    <div className="text-[11px] text-zinc-600">by {m.proposed_by}{m.seconded_by ? ` · seconded by ${m.seconded_by}` : ""} · {m.votes.length} votes</div>
                  </div>
                  <span className="text-[10px] rounded bg-zinc-800 text-zinc-300 px-1.5 py-0.5 shrink-0">{m.status}</span>
                </div>
                {m.tally && (
                  <div className="mt-1.5 text-[11px] text-zinc-500">
                    for {m.tally.for} · against {m.tally.against} · abstain {m.tally.abstain} ·{" "}
                    quorum {m.tally.quorum_met ? "met" : "not met"} ({m.tally.participating}/{m.tally.base})
                  </div>
                )}
                {!isClosed && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <button onClick={() => motionAction(m, "second")} className="text-[11px] rounded bg-zinc-700/40 text-zinc-300 px-2 py-0.5 hover:bg-zinc-700/60">second</button>
                    <button onClick={() => motionAction(m, "for")} className="text-[11px] rounded bg-emerald-500/10 text-emerald-300 px-2 py-0.5 hover:bg-emerald-500/20">vote for</button>
                    <button onClick={() => motionAction(m, "against")} className="text-[11px] rounded bg-red-500/10 text-red-300 px-2 py-0.5 hover:bg-red-500/20">against</button>
                    <button onClick={() => motionAction(m, "abstain")} className="text-[11px] rounded bg-zinc-700/40 text-zinc-300 px-2 py-0.5 hover:bg-zinc-700/60">abstain</button>
                    <button onClick={() => motionAction(m, "veto")} className="text-[11px] rounded bg-red-500/10 text-red-300 px-2 py-0.5 hover:bg-red-500/20">veto</button>
                    <button onClick={() => motionAction(m, "tally")} className="text-[11px] rounded bg-blue-500/10 text-blue-300 px-2 py-0.5 hover:bg-blue-500/20">tally</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

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
