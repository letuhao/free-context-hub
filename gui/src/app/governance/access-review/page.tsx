"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Breadcrumb, Button, StatCard } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/cn";
import { relTime } from "@/lib/rel-time";
import { AlertTriangle, Copy, X, Clock, ShieldAlert } from "lucide-react";
import {
  nhiApi,
  type AccessReviewKey,
  type AccessReviewStats,
} from "@/lib/nhiApi";

const ROLE_BADGE: Record<string, string> = {
  admin: "bg-blue-500/10 text-blue-400",
  writer: "bg-emerald-500/10 text-emerald-400",
  reader: "bg-zinc-700 text-zinc-400",
};

const OVERLAP_OPTIONS = [
  { label: "24 hours", ms: 24 * 60 * 60 * 1000 },
  { label: "7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  { label: "No overlap (revoke now)", ms: 0 },
];

const TTL_OPTIONS = [
  { label: "15 minutes", ms: 15 * 60 * 1000 },
  { label: "1 hour", ms: 60 * 60 * 1000 },
  { label: "8 hours", ms: 8 * 60 * 60 * 1000 },
];

function ageLabel(days: number): string {
  if (days < 1) return "today";
  return `${days}d`;
}

export default function AccessReviewPage() {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [stats, setStats] = useState<AccessReviewStats | null>(null);
  const [keys, setKeys] = useState<AccessReviewKey[]>([]);
  const [loading, setLoading] = useState(true);

  // Rotate modal
  const [rotateKey, setRotateKey] = useState<AccessReviewKey | null>(null);
  const [overlapMs, setOverlapMs] = useState<number>(OVERLAP_OPTIONS[1].ms);
  const [rotating, setRotating] = useState(false);

  // Ephemeral mint card
  const [ephName, setEphName] = useState("");
  const [ephTtl, setEphTtl] = useState<number>(TTL_OPTIONS[1].ms);
  const [minting, setMinting] = useState(false);

  // Revealed key (rotate successor / ephemeral)
  const [revealed, setRevealed] = useState<{ title: string; key: string; note?: string } | null>(null);

  // Revoke confirm
  const [revokeTarget, setRevokeTarget] = useState<AccessReviewKey | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await nhiApi.accessReview();
      setStats(res.stats);
      setKeys(res.keys);
    } catch (err) {
      toastRef.current("error", err instanceof Error ? err.message : "Failed to load access review");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRotate = async () => {
    if (!rotateKey) return;
    setRotating(true);
    try {
      const res = await nhiApi.rotateKey(rotateKey.key_id, overlapMs);
      setRotateKey(null);
      setRevealed({
        title: `Rotated "${rotateKey.name}"`,
        key: res.key,
        note: overlapMs === 0
          ? "The previous key was revoked immediately."
          : `The previous key stays valid until ${res.old_expires_at ? relTime(res.old_expires_at) : "the overlap window ends"}.`,
      });
      toastRef.current("success", "Key rotated");
      load();
    } catch (err) {
      toastRef.current("error", err instanceof Error ? err.message : "Rotation failed");
    } finally {
      setRotating(false);
    }
  };

  const handleMintEphemeral = async () => {
    if (!ephName.trim()) return;
    setMinting(true);
    try {
      const res = await nhiApi.mintEphemeral({ name: ephName.trim(), ttlMs: ephTtl });
      setEphName("");
      setRevealed({
        title: "Ephemeral key minted",
        key: res.key,
        note: `Auto-revokes ${relTime(res.expires_at)}. No review, no rotation, no cleanup.`,
      });
      toastRef.current("success", "Ephemeral key minted");
      load();
    } catch (err) {
      toastRef.current("error", err instanceof Error ? err.message : "Mint failed");
    } finally {
      setMinting(false);
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await nhiApi.revokeKey(revokeTarget.key_id);
      toastRef.current("success", "Key revoked");
      setRevokeTarget(null);
      load();
    } catch (err) {
      toastRef.current("error", err instanceof Error ? err.message : "Revoke failed");
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <Breadcrumb items={[{ label: "Governance" }, { label: "NHI Access Review" }]} />

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Non-Human Identity — Access Review</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Agents and service keys reviewed from the logs, not by asking. Surface stale credentials for rotation or revocation.
          </p>
        </div>
        <Button size="sm" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard value={stats?.total_active ?? 0} label="Active keys" />
        <StatCard value={stats?.unused_90d ?? 0} label="Unused ≥90 days" highlight={!!stats && stats.unused_90d > 0} />
        <StatCard value={stats?.never_expires ?? 0} label="Never expire" highlight={!!stats && stats.never_expires > 0} />
        <StatCard value={stats?.ownerless ?? 0} label="Ownerless (legacy)" highlight={!!stats && stats.ownerless > 0} />
      </div>

      {/* Review table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden mb-10">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left px-4 py-3 text-zinc-500 font-medium">Key / principal</th>
              <th className="text-left px-4 py-3 text-zinc-500 font-medium">Age</th>
              <th className="text-left px-4 py-3 text-zinc-500 font-medium">Last used</th>
              <th className="text-left px-4 py-3 text-zinc-500 font-medium">Expiry</th>
              <th className="text-left px-4 py-3 text-zinc-500 font-medium">Flags</th>
              <th className="text-right px-4 py-3 text-zinc-500 font-medium">Review</th>
            </tr>
          </thead>
          <tbody>
            {!loading && keys.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-600">
                  No active keys to review.
                </td>
              </tr>
            )}
            {keys.map((k) => (
              <tr key={k.key_id} className="border-b border-zinc-800/50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-300">{k.name}</span>
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded", ROLE_BADGE[k.role] ?? "bg-zinc-700 text-zinc-400")}>{k.role}</span>
                  </div>
                  <div className="text-[10px] text-violet-400 mt-0.5">
                    {k.principal_name ?? <span className="text-amber-400">ownerless</span>}
                  </div>
                </td>
                <td className={cn("px-4 py-3", k.age_days > 120 ? "text-amber-400" : "text-zinc-400")}>{ageLabel(k.age_days)}</td>
                <td className={cn("px-4 py-3", k.unused_90d ? "text-amber-400" : k.days_since_used === null ? "text-zinc-600" : "text-emerald-400")}>
                  {k.last_used_at ? relTime(k.last_used_at) : "never"}
                </td>
                <td className={cn("px-4 py-3", k.never_expires ? "text-red-400" : "text-zinc-400")}>
                  {k.expires_at ? relTime(k.expires_at) : "never"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {k.unused_90d && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">unused 90d</span>}
                    {k.never_expires && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">never expires</span>}
                    {k.ownerless && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">ownerless</span>}
                    {!k.unused_90d && !k.never_expires && !k.ownerless && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">keep</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => { setRotateKey(k); setOverlapMs(OVERLAP_OPTIONS[1].ms); }}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20"
                    >
                      rotate
                    </button>
                    <button
                      onClick={() => { setRotateKey(k); setOverlapMs(0); }}
                      title="Set expiry / revoke-and-replace now"
                      className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                    >
                      set expiry
                    </button>
                    <button
                      onClick={() => setRevokeTarget(k)}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                    >
                      revoke
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Ephemeral mint card */}
      <h2 className="text-sm font-medium text-zinc-400 mb-3 flex items-center gap-2">
        <Clock size={14} className="text-blue-400" /> Mint ephemeral key (CI / one-shot agents)
      </h2>
      <div className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-lg p-5 mb-10">
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-zinc-600 mb-1">Name</label>
            <input
              type="text"
              value={ephName}
              onChange={(e) => setEphName(e.target.value)}
              placeholder="e.g. ci-indexer-run"
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-zinc-600 mb-1">TTL</label>
            <select
              value={ephTtl}
              onChange={(e) => setEphTtl(Number(e.target.value))}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 outline-none appearance-none cursor-pointer focus:border-zinc-600"
            >
              {TTL_OPTIONS.map((o) => <option key={o.ms} value={o.ms}>{o.label}</option>)}
            </select>
          </div>
        </div>
        <p className="text-[11px] text-zinc-600 mb-3">Auto-revokes at TTL — no review, no rotation, no cleanup.</p>
        <button
          onClick={handleMintEphemeral}
          disabled={minting || !ephName.trim()}
          className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md text-white font-medium"
        >
          {minting ? "Minting…" : "Mint & reveal once"}
        </button>
      </div>

      {/* Rotate modal */}
      {rotateKey && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={() => !rotating && setRotateKey(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div role="dialog" aria-modal="true" aria-labelledby="rotate-title" className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl pointer-events-auto" onClick={(e) => e.stopPropagation()}>
              <div className="px-6 pt-5 pb-4 border-b border-zinc-800 flex items-start justify-between">
                <div>
                  <h2 id="rotate-title" className="text-base font-semibold text-zinc-100">Rotate &ldquo;{rotateKey.name}&rdquo;</h2>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Mint a successor bound to the same principal &amp; grants. The old key keeps working during the overlap, then auto-expires.
                  </p>
                </div>
                <button onClick={() => setRotateKey(null)} aria-label="Close" className="text-zinc-500 hover:text-zinc-300 p-1"><X size={18} /></button>
              </div>
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">Overlap window (old key valid until)</label>
                  <select
                    value={overlapMs}
                    onChange={(e) => setOverlapMs(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 outline-none appearance-none cursor-pointer focus:border-zinc-600"
                  >
                    {OVERLAP_OPTIONS.map((o) => <option key={o.ms} value={o.ms}>{o.label}</option>)}
                  </select>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded-md p-2.5 text-[11px] text-zinc-500">
                  Successor inherits: <span className="text-zinc-300">{rotateKey.principal_name ?? "ownerless"}</span> · role {rotateKey.role} · grants unchanged. No grant edits happen during rotation.
                </div>
              </div>
              <div className="px-6 py-4 border-t border-zinc-800 flex justify-end gap-2">
                <button onClick={() => setRotateKey(null)} className="px-3 py-1.5 text-xs border border-zinc-700 rounded-md text-zinc-400">Cancel</button>
                <button onClick={handleRotate} disabled={rotating} className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md text-white font-medium">
                  {rotating ? "Rotating…" : "Rotate"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Revealed-key modal (rotate successor / ephemeral) */}
      {revealed && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={() => setRevealed(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div role="dialog" aria-modal="true" aria-labelledby="reveal-title" className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl pointer-events-auto" onClick={(e) => e.stopPropagation()}>
              <div className="px-6 pt-5 pb-4 border-b border-zinc-800 flex items-center justify-between">
                <h2 id="reveal-title" className="text-base font-semibold text-zinc-100">{revealed.title}</h2>
                <button onClick={() => setRevealed(null)} aria-label="Close" className="text-zinc-500 hover:text-zinc-300 p-1"><X size={18} /></button>
              </div>
              <div className="px-6 py-5">
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-4 mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle size={16} className="text-amber-400" />
                    <span className="text-xs text-amber-400 font-medium">Copy this key now — it won&apos;t be shown again</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-sm font-mono text-zinc-200 bg-zinc-950 px-3 py-2 rounded-md border border-zinc-800 break-all select-all">{revealed.key}</code>
                    <button
                      onClick={() => { navigator.clipboard.writeText(revealed.key); toastRef.current("success", "Copied to clipboard"); }}
                      className="px-3 py-2 text-xs bg-zinc-800 border border-zinc-700 rounded-md text-zinc-300 hover:bg-zinc-700 transition-colors shrink-0"
                    >
                      <Copy size={14} />
                    </button>
                  </div>
                </div>
                {revealed.note && (
                  <p className="text-[11px] text-zinc-500 flex items-center gap-1.5 mb-4">
                    <ShieldAlert size={12} className="text-zinc-600" /> {revealed.note}
                  </p>
                )}
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => setRevealed(null)}>Done</Button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Revoke confirm */}
      <ConfirmDialog
        open={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onConfirm={handleRevoke}
        title="Revoke API Key"
        description={`This immediately invalidates "${revokeTarget?.name ?? ""}". Any agent or service using it loses access.`}
        confirmText="Revoke"
        destructive
      />
    </div>
  );
}
