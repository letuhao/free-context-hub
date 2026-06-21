"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  governanceApi,
  type DecisionRow,
  type DecisionStats,
  type PrincipalSummary,
  type ExplainResult,
} from "@/lib/governanceApi";
import { Breadcrumb } from "@/components/ui";
import { Pagination } from "@/components/ui/pagination";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { relTime } from "@/lib/rel-time";
import { Search, Check, XCircle } from "lucide-react";

const LOG_TABS = [
  { key: "all", label: "All decisions" },
  { key: "deny", label: "Denied only" },
  { key: "root", label: "Root short-circuits" },
  { key: "reject", label: "Asserted-identity rejects" },
] as const;

const TIME_RANGES = [
  { label: "Last 24 hours", days: 1 },
  { label: "Last 7 days", days: 7 },
  { label: "All time", days: 0 },
] as const;

const ACTIONS = ["read", "write", "admin", "delegate"] as const;

function resultBadge(result: string): string {
  if (result === "allow") return "bg-emerald-500/15 text-emerald-300";
  if (result === "reject") return "bg-red-500/15 text-red-300";
  return "bg-red-500/15 text-red-300";
}

export default function AuthorizationPage() {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [stats, setStats] = useState<DecisionStats | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [principals, setPrincipals] = useState<PrincipalSummary[]>([]);

  const [tab, setTab] = useState<(typeof LOG_TABS)[number]["key"]>("all");
  const [days, setDays] = useState(1);
  const [principalFilter, setPrincipalFilter] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Why inspector
  const [whoPrincipal, setWhoPrincipal] = useState("");
  const [whoAction, setWhoAction] = useState<string>("write");
  const [whoResource, setWhoResource] = useState("lesson @ project:free-context-hub");
  const [explainResult, setExplainResult] = useState<ExplainResult | null>(null);
  const [explaining, setExplaining] = useState(false);

  const fetchDecisions = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await governanceApi.listDecisions({
        principal_id: principalFilter || undefined,
        result: tab === "all" ? undefined : (tab as "deny" | "reject" | "root"),
        days: days || undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      setDecisions(res.decisions ?? []);
      setStats(res.stats ?? null);
      setTotalCount(res.total_count ?? 0);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [tab, days, principalFilter, page]);

  useEffect(() => {
    fetchDecisions();
  }, [fetchDecisions]);

  useEffect(() => {
    governanceApi
      .listPrincipals()
      .then((r) => setPrincipals(r.principals ?? []))
      .catch(() => setPrincipals([]));
  }, []);

  const handleExplain = async () => {
    if (!whoResource.trim()) return;
    setExplaining(true);
    try {
      const res = await governanceApi.explain({
        principal_id: whoPrincipal || undefined,
        action: whoAction,
        resource: whoResource.trim(),
      });
      setExplainResult(res);
    } catch (err) {
      setExplainResult(null);
      toastRef.current("error", err instanceof Error ? err.message : "Explain failed");
    } finally {
      setExplaining(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <Breadcrumb items={[{ label: "Governance" }, { label: "Authorization" }]} />

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Authorization</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Every allow and deny, with its reason. No bare verdicts — an allow shows its matched grant; a
            deny shows which condition failed.
          </p>
        </div>
        <div className="flex gap-2">
          <select
            value={principalFilter}
            onChange={(e) => {
              setPrincipalFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-md text-xs text-zinc-300 outline-none appearance-none cursor-pointer"
          >
            <option value="">All principals</option>
            {principals.map((p) => (
              <option key={p.principal_id} value={p.principal_id}>
                {p.display_name}
              </option>
            ))}
          </select>
          <select
            value={days}
            onChange={(e) => {
              setDays(Number(e.target.value));
              setPage(1);
            }}
            className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-md text-xs text-zinc-300 outline-none appearance-none cursor-pointer"
          >
            {TIME_RANGES.map((r) => (
              <option key={r.days} value={r.days}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatBox value={stats?.total ?? "—"} label="Decisions" />
        <StatBox
          value={stats ? `${Math.round(stats.allow_rate * 100)}%` : "—"}
          label="Allowed"
          tone="text-emerald-400"
        />
        <StatBox value={stats?.denied ?? "—"} label="Denied" tone="text-red-400" />
        <StatBox value={stats?.root_short_circuits ?? "—"} label="Root short-circuits" tone="text-amber-400" />
      </div>

      {/* Why inspector */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-8">
        <div className="flex items-center gap-2 mb-3">
          <Search size={16} className="text-blue-400" />
          <h2 className="text-sm font-semibold text-zinc-200">Why inspector</h2>
          <span className="text-[10px] text-zinc-600">
            simulate a decision — read-only, mutates nothing · maps to MCP{" "}
            <code className="text-zinc-500">explain_authorization</code>
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-zinc-600 mb-1">Principal</label>
            <select
              value={whoPrincipal}
              onChange={(e) => setWhoPrincipal(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 outline-none appearance-none cursor-pointer focus:border-zinc-600"
            >
              <option value="">(self / caller)</option>
              {principals.map((p) => (
                <option key={p.principal_id} value={p.principal_id}>
                  {p.display_name} ({p.kind})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-zinc-600 mb-1">Action</label>
            <select
              value={whoAction}
              onChange={(e) => setWhoAction(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 outline-none appearance-none cursor-pointer focus:border-zinc-600"
            >
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-zinc-600 mb-1">Resource</label>
            <input
              type="text"
              value={whoResource}
              onChange={(e) => setWhoResource(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 outline-none focus:border-zinc-600"
            />
          </div>
        </div>
        <div className="flex justify-end mb-4">
          <button
            onClick={handleExplain}
            disabled={explaining || !whoResource.trim()}
            className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md text-white font-medium"
          >
            {explaining ? "Evaluating…" : "Explain"}
          </button>
        </div>

        {explainResult && (
          <div
            className={cn(
              "border rounded-lg p-4",
              explainResult.decision.allow
                ? "bg-emerald-500/5 border-emerald-500/20"
                : "bg-red-500/5 border-red-500/20",
            )}
          >
            <div className="flex items-center gap-2 mb-3">
              <span
                className={cn(
                  "text-[11px] px-2 py-0.5 rounded font-semibold",
                  explainResult.decision.allow
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "bg-red-500/15 text-red-300",
                )}
              >
                {explainResult.decision.allow ? "ALLOW" : "DENY"}
              </span>
              <span className="text-xs text-zinc-400">
                {whoAction} · {whoResource}
              </span>
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center gap-2">
                {explainResult.decision.allow ? (
                  <Check size={13} className="text-emerald-400 shrink-0" />
                ) : (
                  <XCircle size={13} className="text-red-400 shrink-0" />
                )}
                <span className="text-zinc-400">
                  reason{" "}
                  <code className={explainResult.decision.allow ? "text-emerald-300" : "text-red-300"}>
                    {explainResult.decision.reason}
                  </code>
                </span>
              </div>
              {explainResult.matched_grant && (
                <div className="flex items-center gap-2">
                  <Check size={13} className="text-emerald-400 shrink-0" />
                  <span className="text-zinc-400">
                    covering grant: <span className="text-blue-300">{explainResult.matched_grant.capability}</span>{" "}
                    @{" "}
                    <span className="text-blue-300">
                      {explainResult.matched_grant.scope_type}
                      {explainResult.matched_grant.scope_id
                        ? `:${explainResult.matched_grant.scope_id}`
                        : ""}
                    </span>{" "}
                    <code className="text-zinc-600">{explainResult.matched_grant.grant_id}</code>
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Decision log tabs */}
      <div className="flex gap-1 mb-4 border-b border-zinc-800 pb-px">
        {LOG_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              setPage(1);
            }}
            className={cn(
              "px-4 py-2 text-xs font-medium transition-colors",
              tab === t.key
                ? "text-blue-400 border-b-2 border-blue-400"
                : "text-zinc-500 hover:text-zinc-300",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Decision log */}
      {loadError ? (
        <div className="py-12 text-center text-xs text-zinc-600">
          Could not load the decision log. The governance API may not be available yet.
        </div>
      ) : loading ? (
        <div className="py-12 text-center text-xs text-zinc-600">Loading decisions…</div>
      ) : decisions.length === 0 ? (
        <div className="py-12 text-center text-xs text-zinc-600">
          No decisions recorded for this filter and time range.
        </div>
      ) : (
        <div className="space-y-2.5">
          {decisions.map((d) => {
            const isReject = d.result === "reject";
            const isDeny = d.result === "deny";
            return (
              <div
                key={d.decision_id}
                className={cn(
                  "bg-zinc-900 border rounded-lg p-3.5",
                  isDeny || isReject ? "border-red-500/20" : "border-zinc-800",
                )}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-semibold", resultBadge(d.result))}>
                    {isReject ? "REJECT" : d.result.toUpperCase()}
                  </span>
                  <span className="text-xs font-medium text-zinc-200">
                    {d.principal_display_name ?? d.principal_id ?? "—"}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {d.action} · {d.resource}
                  </span>
                  <span className="text-[10px] text-zinc-600 ml-auto">{relTime(d.created_at)}</span>
                </div>
                <p className="text-[11px] text-zinc-500 mt-1.5">
                  reason{" "}
                  <code className={isDeny || isReject ? "text-red-300" : "text-emerald-300"}>{d.reason}</code>
                  {d.matched_grant_id && (
                    <>
                      {" "}
                      · matched <code className="text-zinc-600">{d.matched_grant_id}</code>
                    </>
                  )}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {totalCount > pageSize && (
        <div className="mt-6">
          <Pagination
            page={page}
            pageSize={pageSize}
            totalPages={Math.ceil(totalCount / pageSize)}
            totalCount={totalCount}
            onPageChange={setPage}
          />
        </div>
      )}

      <p className="text-[11px] text-zinc-600 mt-6">
        Each row is one append-only <code className="text-zinc-500">coordination_events</code> entry tagged{" "}
        <code className="text-zinc-500">authz.decision</code> — the same log Phase-15 already writes. Nothing
        here is editable.
      </p>
    </div>
  );
}

function StatBox({ value, label, tone }: { value: number | string; label: string; tone?: string }) {
  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
      <p className={cn("text-2xl font-semibold", tone ?? "text-zinc-100")}>{value}</p>
      <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
    </div>
  );
}
