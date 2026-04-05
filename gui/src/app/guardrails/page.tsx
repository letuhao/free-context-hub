"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import { relTime } from "@/lib/rel-time";
import { Breadcrumb, PageHeader, DataTable, Badge, Button, EmptyState, TableSkeleton, type Column } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { Pagination } from "@/components/ui/pagination";
import { AddLessonDialog } from "../lessons/add-lesson-dialog";
import type { Lesson } from "../lessons/types";

const PRESETS = [
  "deploy to production",
  "git push --force to main",
  "DROP TABLE migration",
  "delete workspace data",
  "npm publish",
];

type TestHistoryEntry = {
  action: string;
  pass: boolean;
  matchCount: number;
  timestamp: number;
};

type SimulateResult = {
  action: string;
  pass: boolean;
  matched_rules: Array<{ rule_id: string; requirement: string; verification_method: string }>;
};

export default function GuardrailsPage() {
  const { projectId } = useProject();
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [guardrails, setGuardrails] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 20;

  // Mode toggle
  const [mode, setMode] = useState<"test" | "block">("test");

  // Test Action state
  const [testAction, setTestAction] = useState("");
  const [testResult, setTestResult] = useState<{ pass: boolean; rules_checked?: number; matched_rules?: any[] } | null>(null);
  const [testing, setTesting] = useState(false);

  // Test history (in-memory)
  const [history, setHistory] = useState<TestHistoryEntry[]>([]);

  // "What Would Block?" state
  const [blockActions, setBlockActions] = useState("");
  const [simResults, setSimResults] = useState<SimulateResult[] | null>(null);
  const [simulating, setSimulating] = useState(false);

  const fetchGuardrails = useCallback(async () => {
    try {
      const result = await api.listLessons({
        project_id: projectId,
        lesson_type: "guardrail",
        status: "active",
        limit: pageSize,
        offset: (page - 1) * pageSize,
        sort: "created_at",
        order: "desc",
      });
      setGuardrails(result.items ?? []);
      setTotalCount(result.total_count ?? 0);
    } catch {
      toastRef.current("error", "Failed to load guardrails");
    } finally {
      setLoading(false);
    }
  }, [projectId, page]);

  useEffect(() => { fetchGuardrails(); }, [fetchGuardrails]);

  const handleTest = async (action?: string) => {
    const a = (action ?? testAction).trim();
    if (!a) return;
    if (!action) setTestAction(a);
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.checkGuardrails({
        project_id: projectId,
        action_context: { action: a },
      });
      setTestResult(result);
      setHistory((prev) => [
        { action: a, pass: result.pass, matchCount: result.matched_rules?.length ?? 0, timestamp: Date.now() },
        ...prev.slice(0, 19),
      ]);
    } catch (err) {
      toastRef.current("error", err instanceof Error ? err.message : "Check failed");
    } finally {
      setTesting(false);
    }
  };

  const handleSimulate = async () => {
    const lines = blockActions.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    setSimulating(true);
    setSimResults(null);
    try {
      const { results } = await api.simulateGuardrails({
        project_id: projectId,
        actions: lines,
      });
      setSimResults(results);
    } catch (err) {
      toastRef.current("error", err instanceof Error ? err.message : "Simulation failed");
    } finally {
      setSimulating(false);
    }
  };

  const handlePresetSelect = (value: string) => {
    if (value === "") return;
    setTestAction(value);
  };

  const columns: Column<Lesson>[] = [
    {
      key: "title",
      header: "Rule",
      className: "max-w-[400px]",
      render: (row) => <span className="text-zinc-200">{row.title}</span>,
    },
    {
      key: "tags",
      header: "Tags",
      render: (row) => (
        <div className="flex gap-1">
          {row.tags.slice(0, 3).map((t) => (
            <span key={t} className="px-1.5 py-0.5 rounded text-[11px] bg-zinc-800 text-zinc-500">{t}</span>
          ))}
          {row.tags.length > 3 && <span className="text-[11px] text-zinc-600">+{row.tags.length - 3}</span>}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <Badge value={row.status} variant="status" />,
    },
    {
      key: "created_at",
      header: "Created",
      render: (row) => <span className="text-zinc-600 text-xs">{relTime(row.created_at)}</span>,
    },
  ];

  return (
    <div className="p-6">
      <Breadcrumb items={[{ label: "Knowledge", href: "/lessons" }, { label: "Guardrails" }]} />
      <PageHeader
        title="Guardrails"
        subtitle="Enforce rules and check actions before execution"
        actions={
          <Button variant="primary" onClick={() => setAddOpen(true)}>+ Add Guardrail</Button>
        }
      />

      {/* Test Panel */}
      <div className="border border-zinc-800 rounded-lg bg-zinc-900 p-4 mb-5">
        {/* Mode toggle */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-zinc-300">
            {mode === "test" ? "Test Action" : "What Would Block?"}
          </h2>
          <div className="flex bg-zinc-800 border border-zinc-700 rounded-lg overflow-hidden">
            <button
              onClick={() => setMode("test")}
              className={`px-3 py-1.5 text-[10px] transition-colors ${mode === "test" ? "bg-zinc-700 text-zinc-200" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              Test Action
            </button>
            <button
              onClick={() => setMode("block")}
              className={`px-3 py-1.5 text-[10px] transition-colors ${mode === "block" ? "bg-zinc-700 text-zinc-200" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              What Would Block?
            </button>
          </div>
        </div>

        {/* Test Action mode */}
        {mode === "test" && (
          <div>
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value=""
                onChange={(e) => handlePresetSelect(e.target.value)}
                className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-300 outline-none appearance-none cursor-pointer sm:w-56 shrink-0"
              >
                <option value="">Select preset...</option>
                {PRESETS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <input
                type="text"
                value={testAction}
                onChange={(e) => setTestAction(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleTest()}
                placeholder="e.g. git push --force to main"
                className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-md text-sm text-zinc-100 outline-none focus:border-zinc-600"
              />
              <Button variant="primary" onClick={() => handleTest()} disabled={testing || !testAction.trim()}>
                {testing ? "Checking..." : "Check"}
              </Button>
            </div>

            {testResult && (
              <div className={`mt-3 p-3 rounded-lg border ${testResult.pass ? "border-emerald-800/50 bg-emerald-500/5" : "border-red-800/50 bg-red-500/5"}`}>
                <div className={`text-sm font-medium ${testResult.pass ? "text-emerald-400" : "text-red-400"}`}>
                  {testResult.pass ? "✓ PASSED" : "✕ BLOCKED"}
                </div>
                <p className="text-xs text-zinc-400 mt-1">
                  {testResult.pass
                    ? `Action "${testAction}" passed all ${testResult.rules_checked ?? 0} guardrails.`
                    : `Action "${testAction}" was blocked by ${testResult.matched_rules?.length ?? 0} guardrail(s):`}
                </p>
                {testResult.matched_rules && testResult.matched_rules.length > 0 && (
                  <div className="mt-2 ml-4 space-y-1">
                    {testResult.matched_rules.map((v: any, i: number) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-red-400 mt-0.5 shrink-0">✕</span>
                        <div>
                          <p className="text-xs text-zinc-300 font-medium">{v.requirement}</p>
                          {v.verification_method && (
                            <p className="text-[10px] text-zinc-500">Verification: {v.verification_method}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* "What Would Block?" mode */}
        {mode === "block" && (
          <div>
            <div className="flex gap-2">
              <textarea
                value={blockActions}
                onChange={(e) => setBlockActions(e.target.value)}
                placeholder={"Enter actions to simulate (one per line)...\ne.g.\ndeploy to production\ngit push --force\ndelete workspace data"}
                rows={3}
                className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-md text-sm text-zinc-100 outline-none focus:border-zinc-600 resize-none font-mono"
              />
              <Button
                variant="primary"
                onClick={handleSimulate}
                disabled={simulating || !blockActions.trim()}
              >
                {simulating ? "Analyzing..." : "Analyze"}
              </Button>
            </div>

            {simResults && (
              <div className="mt-3 space-y-2">
                {simResults.map((r, i) => (
                  <div
                    key={i}
                    className={`border rounded-lg p-3 ${r.pass ? "border-emerald-800/50 bg-emerald-500/5" : "border-red-800/50 bg-red-500/5"}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-zinc-300 font-mono">{r.action}</span>
                      <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${r.pass ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                        {r.pass ? "PASS" : `BLOCKED (${r.matched_rules.length})`}
                      </span>
                    </div>
                    {r.matched_rules.length > 0 && (
                      <div className="mt-1.5 space-y-1">
                        {r.matched_rules.map((rule, j) => (
                          <p key={j} className="text-[10px] text-zinc-500 ml-2">
                            <span className="text-red-400">•</span> {rule.requirement}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Test History */}
      {history.length > 0 && (
        <div className="border border-zinc-800 rounded-lg bg-zinc-900 p-4 mb-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-zinc-300">Recent Tests</h2>
            <button
              onClick={() => setHistory([])}
              className="text-[10px] text-zinc-500 hover:text-zinc-400 transition-colors"
            >
              Clear History
            </button>
          </div>
          <div className="space-y-1">
            {history.map((entry, i) => (
              <div key={i} className="flex items-center gap-3 py-1.5">
                <span className={`w-2 h-2 rounded-full shrink-0 ${entry.pass ? "bg-emerald-500" : "bg-red-500"}`} />
                <span className="text-xs text-zinc-300 font-mono flex-1 truncate">{entry.action}</span>
                <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded shrink-0 ${entry.pass ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                  {entry.pass ? "PASSED" : `BLOCKED (${entry.matchCount})`}
                </span>
                <span className="text-[10px] text-zinc-600 w-16 text-right shrink-0">
                  {relTime(new Date(entry.timestamp).toISOString())}
                </span>
                <button
                  onClick={() => { setTestAction(entry.action); setMode("test"); handleTest(entry.action); }}
                  className="text-[10px] text-zinc-500 hover:text-zinc-400 shrink-0 transition-colors"
                >
                  Re-run
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Guardrails List */}
      {loading ? (
        <TableSkeleton rows={5} />
      ) : guardrails.length === 0 ? (
        <EmptyState
          icon="🛡"
          title="No guardrails defined"
          description="Add guardrails to enforce rules before risky actions"
          action={<Button variant="primary" onClick={() => setAddOpen(true)}>+ Add Guardrail</Button>}
        />
      ) : (
        <>
          <div className="text-xs text-zinc-600 mb-2">{totalCount} active guardrail{totalCount !== 1 ? "s" : ""}</div>
          <DataTable
            columns={columns}
            data={guardrails}
            rowKey={(r) => r.lesson_id}
          />
          {totalCount > pageSize && (
            <Pagination page={page} totalPages={Math.ceil(totalCount / pageSize)} totalCount={totalCount} pageSize={pageSize} onPageChange={(p) => { setPage(p); window.scrollTo(0, 0); }} />
          )}
        </>
      )}

      <AddLessonDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={() => { fetchGuardrails(); setAddOpen(false); }}
        presetType="guardrail"
      />
    </div>
  );
}
