"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import { relTime } from "@/lib/rel-time";
import { PageHeader, DataTable, Badge, Button, EmptyState, TableSkeleton, type Column } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { AddLessonDialog } from "../lessons/add-lesson-dialog";
import type { Lesson } from "../lessons/types";

export default function GuardrailsPage() {
  const { projectId } = useProject();
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [guardrails, setGuardrails] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  // Test panel state
  const [testAction, setTestAction] = useState("");
  const [testResult, setTestResult] = useState<{ pass: boolean; violations: any[] } | null>(null);
  const [testing, setTesting] = useState(false);

  const fetchGuardrails = useCallback(async () => {
    try {
      const result = await api.listLessons({
        project_id: projectId,
        lesson_type: "guardrail",
        status: "active",
        limit: 100,
        offset: 0,
        sort: "created_at",
        order: "desc",
      });
      setGuardrails(result.items ?? []);
    } catch {
      toastRef.current("error", "Failed to load guardrails");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchGuardrails(); }, [fetchGuardrails]);

  const handleTest = async () => {
    if (!testAction.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.checkGuardrails({
        project_id: projectId,
        action_context: { action: testAction.trim() },
      });
      setTestResult(result);
    } catch (err) {
      toastRef.current("error", err instanceof Error ? err.message : "Check failed");
    } finally {
      setTesting(false);
    }
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
    <div className="p-6 max-w-[1000px]">
      <PageHeader
        title="Guardrails"
        subtitle="Enforce rules and check actions before execution"
        actions={
          <Button variant="primary" onClick={() => setAddOpen(true)}>+ Add Guardrail</Button>
        }
      />

      {/* Test Action Panel */}
      <div className="border border-zinc-800 rounded-lg bg-zinc-900 p-4 mb-5">
        <div className="text-xs text-zinc-500 mb-2">Test an action against guardrails</div>
        <div className="flex gap-2">
          <input
            type="text"
            value={testAction}
            onChange={(e) => setTestAction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleTest()}
            placeholder="e.g. git push --force to main"
            className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-md text-sm text-zinc-100 outline-none focus:border-zinc-600"
          />
          <Button variant="primary" onClick={handleTest} disabled={testing || !testAction.trim()}>
            {testing ? "Checking..." : "Check ▶"}
          </Button>
        </div>

        {testResult && (
          <div className={`mt-3 p-3 rounded-md border ${testResult.pass ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5"}`}>
            <div className={`text-sm font-semibold ${testResult.pass ? "text-emerald-400" : "text-red-400"}`}>
              {testResult.pass ? "✓ PASSED — no guardrails violated" : "✕ BLOCKED"}
            </div>
            {testResult.violations?.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {testResult.violations.map((v: any, i: number) => (
                  <div key={i} className="text-xs text-zinc-400">
                    <span className="text-red-400 font-medium">Rule:</span> {v.trigger ?? v.rule_id}
                    {v.requirement && <span className="text-zinc-500"> — {v.requirement}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

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
          <div className="text-xs text-zinc-600 mb-2">{guardrails.length} active guardrail{guardrails.length !== 1 ? "s" : ""}</div>
          <DataTable
            columns={columns}
            data={guardrails}
            rowKey={(r) => r.lesson_id}
          />
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
