# Sprint 15.7 — REVIEW-CODE round 1 (self-review, adversarial framing)

**Date:** 2026-05-20
**Reviewer:** main session (v2.2 self-review, hostile-actor framing)
**Subject:** Sprint 15.7 implementation on `phase-15-sprint-15.7` (uncommitted; ~16 files modified, 2 new files)
**Method:** "If you wanted to break this in production, where would you look?" — find exactly 3 problems.

---

## F1 (MED) — `claimTask` rolling-topology check passes vacuously when upstream artifact row is missing

**Where:** `src/services/board.ts` — claimTask rolling branch (after Sprint 15.7 topology
enforcement insert).

```ts
} else if (taskTopology === 'rolling') {
  const upRes = await client.query<{ task_id: string; state: string }>(
    `SELECT task_id, state FROM artifacts WHERE task_id = ANY($1::uuid[])`,
    [dependsOn],
  );
  const notBaselined = upRes.rows.filter((r) => r.state !== 'baselined');
  if (notBaselined.length > 0) {
    // ... reject
  }
}
```

**The problem:** the sequential branch explicitly catches missing predecessors via
`missing.length > 0 || incomplete.length > 0`. The rolling branch only filters for
`state !== 'baselined'` — if a referenced predecessor task's artifact row is missing
from the result, no row contributes to `notBaselined`, and the check passes vacuously.

In production today: postTask always co-creates a tasks row + artifact row + artifact_versions
row in one transaction, so this case shouldn't arise. Defensive depth says: the rolling
check should be symmetric to sequential — flag missing artifacts as a separate error
class (e.g., `upstream_missing`).

**Severity:** MED — defensive consistency, not a present-day reachable bug. Catches a
future code path that drops artifacts without dropping the referencing task.

**Recommended fix:**
```ts
const foundTaskIds = new Set(upRes.rows.map((r) => r.task_id));
const missingArtifacts = dependsOn.filter((d) => !foundTaskIds.has(d));
// merge into the rejection: either missing or not_baselined → upstream_not_baselined
```

Or accept-as-is and document: "rolling check assumes postTask invariant — every task
has exactly one artifact row".

**Decision for 15.7:** accept-as-is with a code comment noting the invariant dependency.
This is consistent with the existing postTask-invariant-driven design.

---

## F2 (MED) — `sweepStuckClosingTopics` per-cycle work is unbounded; advisory-lock hold scales with stuck-topic count

**Where:** `src/services/coordinationSweep.ts` — sweepStuckClosingTopics for-loop.

```ts
for (const row of stale.rows) {
  try {
    await closeTopic({ topic_id: row.topic_id, ..., statementTimeoutMs: 60_000 });
    recovered++;
  } catch (err) { ... }
}
```

**The problem:** the F3 fix from REVIEW-DESIGN bounded the **per-topic** call to 60s,
but the **outer loop** processes every stale topic in the scan. The cycle runs inside
the scheduler's advisory-lock hold. With N stuck topics, the worst-case hold is N*60s.

For N=10 → 10 min. For N=100 → 100 min. The other 3 sweeps cannot run during this
window. Recovery is sequential — there's no escape valve.

In normal operation, N is 0 (or 1 — a single fresh crash). The pathological case
requires sustained closeTopic failures, which is unlikely. But the design contract
should bound the worst-case hold.

**Severity:** MED — defensive bound; unlikely to bite in practice; high-impact when it
does.

**Recommended fix:** cap per-cycle work at K topics (e.g., K=10). The remaining stuck
topics are recovered on subsequent cycles.

```ts
const MAX_PER_CYCLE = 10;
for (const row of stale.rows.slice(0, MAX_PER_CYCLE)) { ... }
```

**Decision for 15.7:** ACCEPT — add the cap. One-line change, no test impact.

---

## F3 (LOW) — MCP `decide_step` + `tally_motion` outputSchema does not declare the new `chain` field

**Where:** `src/mcp/index.ts` — the outputSchemas for decide_step (around line 3500+)
and tally_motion (around line 3800+) were not updated to include the Sprint 15.7
`chain: { kind, ... }` field.

```ts
outputSchema: z.object({
  status: z.string(),
  // ... existing fields ...
  // MISSING: chain: z.object({...}).optional()
})
```

**The problem:** MCP responses go through `formatToolResponse(r, summary, output_format)`.
The `structuredContent` is shaped by the outputSchema. If `chain` isn't declared, it's
silently dropped from `structuredContent` even though the service-layer return value
contains it. The text summary still includes the status, so the caller knows "approved",
but loses the chained task_id reference.

Concrete impact: an MCP client calling `decide_step` and reading `structuredContent.chain`
gets `undefined` instead of `{kind:'posted', task_id:'...'}`. The caller can fall back
to text parsing or the REST API, but the MCP contract is incomplete.

**Severity:** LOW — recoverable via fallback paths; REST API and event log both still
carry the chain field; MCP-only callers are degraded but not broken.

**Recommended fix:** extend outputSchema to include `chain: z.object({...}).optional()`
on both tools.

**Decision for 15.7:** DEFER to 15.8. Adding to outputSchema requires a discriminated
union (chain.kind='posted' vs 'deferred') and the SDK has a known issue with
discriminated unions (DEFERRED-007). A flat optional shape works but is loose. Defer
the proper shape design.

---

## Summary

| F# | Severity | Where | Action |
|----|----------|-------|--------|
| F1 | MED | board.ts:claimTask rolling check | ACCEPT — invariant-driven; add code comment |
| F2 | MED | coordinationSweep.ts:sweepStuckClosingTopics outer loop | FIX — cap per-cycle at K=10 |
| F3 | LOW | mcp/index.ts decide_step + tally_motion outputSchema | DEFER to 15.8 |

**Verdict:** ACCEPTED with 1 fix-now (F2) + 1 accept-with-doc (F1) + 1 deferred (F3).

Will apply F2 fix + F1 doc comment before QC.
