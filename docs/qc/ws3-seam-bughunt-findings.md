# WS3 — Cross-phase seam bug-hunt findings (milestone review)

**Date:** 2026-05-23
**Method:** read + targeted probes at seams where two independently-built phases meet.

## Verdict

One **significant cross-phase gap** (S3 — tenant-scope is REST-only, absent on the MCP
transport). Other probed seams are well-guarded.

## Findings

### S3 — Tenant isolation is asymmetric: enforced on REST, absent on MCP (SIGNIFICANT)
The tenant-scope work (DEFERRED-004, Sprint 15.12) was implemented as **Express middleware**
(`requireScope` / `requireProjectScope` / `requireResourceScope`). The MCP transport does not
run Express middleware, and the **service layer does not re-check caller scope**:
- `src/mcp/index.ts` resolves project via `resolveProjectIdOrThrow(project_id)` → falls back to
  `DEFAULT_PROJECT_ID`; `project_id` is just a free parameter on coordination/lesson tools.
- MCP auth is a **single shared `workspace_token`** (`MCP_AUTH_ENABLED` → `assertWorkspaceToken`),
  a binary gate. There is **no per-project scope** on MCP (grep for `apiKeyScope` in `src/mcp/`
  returns nothing).
- Coordination services (`topics.ts`, etc.) carry no internal `apiKeyScope` check.

**Consequence:** with `MCP_AUTH_ENABLED=true`, any caller holding the shared token can read or
mutate **any project's** lessons and coordination state by varying `project_id` — the
per-project isolation that scoped REST keys enforce does not exist on MCP. Note the split:
- **15.11 authorization levels** live in the service layer → they **do** apply on MCP. ✅
- **Tenant-scope (004 / 15.12)** lives in REST middleware → it does **not** apply on MCP. ❌

Since the system's primary clients are MCP agents, this is the more important path. Whether it's
a vulnerability or acceptable depends on intent: single-tenant-per-instance (fine) vs multi-tenant
isolation on a shared instance (gap). The tenant-scope investment implies the latter is a goal.
**Needs a product decision + likely service-layer scope enforcement.** → **DEFERRED-029**

(The same root affects the **exchange × tenant-scope** seam: export/import is guarded by REST
middleware but would be unscoped if driven via MCP/service directly. Folded into S3.)

## Probed and well-guarded

| Seam | Verdict | Evidence |
|---|---|---|
| **MCP transport × `outputSchema`** (DEFERRED-007 repeat) | ✅ PASS | `src/mcp/index.ts` deliberately uses flat `z.object` outputs; multiple comments cite DEFERRED-007; no `discriminatedUnion` in any tool output |
| **`lesson_types` deletion × `taxonomy_profiles`/lessons** | ✅ PASS (minor edge) | `deleteLessonType` blocks built-in, blocks profile-scoped, and blocks if any lesson uses the type. Minor unguarded edge: a `global` type referenced only inside a profile's `lesson_types` JSONB array can still be deleted (low severity — profiles validate at activation) |
| **Authz levels (15.11) on MCP** | ✅ PASS | `grantLevel`/level checks are service-layer → enforced on both REST and MCP |
| **Job-queue scope × worker** (starvation) | ✅ PASS (unit-tested) | `jobQueueScope.test.ts` — worker (no scope) drains all; scoped `run-next` skips null-project jobs |
| **closeTopic drain × concurrent writers** | ✅ PASS (unit-tested) | `coordinationSweep.test.ts` + closeTopic drain tests cover force-lapse + writer-rejects-`closing` |

## Triage summary
- Significant cross-phase gap → **DEFERRED-029** (tenant-scope on MCP; product decision + service-layer enforcement).
- All other probed seams: guarded (S1/S2 pass; queue + drain unit-tested).
- WS3 reinforces WS0-F5: authz/tenant-scope needs an **auth-ON E2E slice** (WS2), and that slice
  should explicitly cover the **MCP path**, not just REST.
