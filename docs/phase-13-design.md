# Phase 13: Multi-Agent Coordination Protocol — Design Document

**Status:** Design (revised after multi-perspective review — 2026-05-14)
**Branch:** `phase-13-dlf-coordination`
**Migrations:** 0048–0050
**Motivating case:** Dead Light Framework Phase 0 audit (LoreWeave case study)

> **Review decisions locked (2026-05-14):**
> - D1: `agent_id` in `claim_artifact` — passed explicitly by the agent (not derived from API key)
> - D2: `codex-guardrail` lesson type feeds into `check_guardrails` engine (treated same as `guardrail` type)
> - D3: F3 taxonomy uses full relational model (no simplification)

---

## Overview

Phases 1–12 treat agent coordination as implicit: multiple agents share `project_id`, search each other's lessons, and check the same guardrails. This works when agents run serially. It breaks when they run in parallel on the same artifacts.

Four failure modes observed during Dead Light Framework Phase 0 audit:

| # | Failure | Current behavior |
|---|---|---|
| F1 | **Concurrent write conflicts** | Two agents modify the same lesson; last write wins silently |
| F2 | **Duplicate effort** | Agent B starts work agent A is already doing; no signal prevents it |
| F3 | **Review queue opacity** | Agent sets `status: draft` to signal "ready for human review"; human cannot distinguish "still working" from "please decide" |
| F4 | **Taxonomy mismatch** | Governance/audit frameworks have domain-specific artifact types that don't map to `decision\|preference\|guardrail\|workaround\|general_note` |

Phase 13 adds three features to close these gaps. Solutions are general; DLF provides the reference implementation and acceptance criteria.

---

## Non-goals

- **Not a task orchestrator.** Phase 13 does not assign work to agents, schedule runs, or manage task dependencies. Agents decide what to work on; Phase 13 lets them signal that decision.
- **Not a messaging bus.** Agents do not send messages to each other. All coordination flows through the shared knowledge store and the human reviewer.
- **Not passive monitoring.** Agents call `claim_artifact` and `submit_for_review` explicitly — same design principle as `add_lesson` vs. passive collection.
- **Not hard serialization.** Leases are optimistic — they signal intent and detect conflicts; they do not prevent writes at the database level.

---

## Feature 1: Artifact Ownership / Leasing

Closes F1 and F2.

### Concept

An agent that is about to work on a named artifact calls `claim_artifact` with its own `agent_id`. This creates a **lease**: a time-bounded, agent-attributed record. Other agents calling `claim_artifact` on the same artifact receive a `conflict` response with the incumbent's identity and remaining time. The human can see all active claims in the GUI.

Leases are **optimistic**: they do not block writes at the DB level. A conflicting agent that ignores the `conflict` response can still write — the system surfaces the conflict, it does not enforce a lock. This keeps the system useful under partial failures (e.g., an agent crashes without releasing its lease) while still making coordination visible.

### Artifact ID convention

`artifact_id` is a free-text string, which creates a collision risk if agents use different strings for the same artifact. The following convention is required and must be documented in agent Codices and `CLAUDE.md`:

```
Format:  {artifact_type}/{normalized-slug}
Examples:
  report-section/reckoning-record-s1      (§1 of reckoning-record.md)
  report-section/reckoning-record-s2      (§2)
  lesson/{lesson-uuid}                    (specific lesson)
  document/{document-uuid}                (specific document)
  custom/loreweave-architecture-review    (free-form project artifact)
```

Rules:
- Lowercase only, hyphens for spaces, no special characters (no `§`, no `/` within the slug part)
- `artifact_type` prefix must match the `artifact_type` parameter
- Agents MUST call `list_active_claims()` at session start and follow existing conventions for the project

### Database — migration 0048

```sql
-- 0048_artifact_leases.sql
CREATE TABLE artifact_leases (
  lease_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        TEXT        NOT NULL,
  agent_id          TEXT        NOT NULL,
  artifact_type     TEXT        NOT NULL,
  artifact_id       TEXT        NOT NULL,
  task_description  TEXT        NOT NULL,
  ttl_minutes       INT         NOT NULL DEFAULT 30,
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active (non-expired) lease per artifact per project.
-- PostgreSQL evaluates the partial index predicate per-row at write time,
-- so expired leases (expires_at <= now()) are excluded from uniqueness enforcement.
CREATE UNIQUE INDEX artifact_leases_active_uniq
  ON artifact_leases (project_id, artifact_type, artifact_id)
  WHERE expires_at > now();

-- Sweep index for background cleanup
CREATE INDEX artifact_leases_expires_at_idx ON artifact_leases (expires_at);

-- Rate limiting support: count active leases per agent per project
CREATE INDEX artifact_leases_agent_project_idx
  ON artifact_leases (project_id, agent_id)
  WHERE expires_at > now();
```

### Lease acquisition logic

All 4 steps run inside a **single DB transaction**. The UNIQUE INDEX is the last-line-of-defense: if two concurrent transactions both pass step 2 and both attempt step 4, the second INSERT will fail with a unique constraint violation — this MUST be caught and returned as a `conflict` response, not a 500 error.

```
BEGIN TRANSACTION
  1. DELETE FROM artifact_leases
       WHERE project_id = $1 AND artifact_type = $3 AND artifact_id = $4
         AND expires_at <= now()                              -- lazy cleanup of expired

  2. SELECT COUNT(*) FROM artifact_leases
       WHERE project_id = $1 AND agent_id = $agent_id
         AND expires_at > now()
     IF count >= MAX_ACTIVE_LEASES_PER_AGENT (10)
       RETURN ERROR 'rate_limit: max active leases reached'

  3. SELECT * FROM artifact_leases
       WHERE project_id = $1 AND artifact_type = $3 AND artifact_id = $4
         AND expires_at > now()
     IF row found → ROLLBACK, return CONFLICT {
       incumbent_agent_id, task_description, expires_at, seconds_remaining
     }

  4. INSERT INTO artifact_leases (...) → return SUCCESS { lease_id, expires_at }
     ON UNIQUE VIOLATION → ROLLBACK, return CONFLICT (treat as race-condition conflict)
COMMIT
```

### MCP tools

**`claim_artifact`**
```
Input:
  agent_id: string          (caller's identity — passed explicitly per decision D1)
  artifact_type: string     ('lesson' | 'document' | 'report-section' | 'custom')
  artifact_id: string       (follows the artifact_id convention above)
  task_description: string  (what this agent intends to do — shown in GUI)
  ttl_minutes?: number      (default 30, max 240)

Output (success):
  status: 'claimed'
  lease_id: UUID
  expires_at: ISO timestamp

Output (conflict):
  status: 'conflict'
  incumbent_agent_id: string
  incumbent_task: string
  expires_at: ISO timestamp
  seconds_remaining: number

Output (rate_limited):
  status: 'rate_limited'
  reason: 'max_active_leases' | 'too_many_requests'
  retry_after_seconds: number
```

**`release_artifact`**
```
Input:
  agent_id: string   (must match lease owner)
  lease_id: UUID

Output:
  status: 'released' | 'not_found' | 'not_owner'
```

**`renew_artifact`**
```
Input:
  agent_id: string
  lease_id: UUID
  extend_by_minutes: number   (1–120; new TTL = current expires_at + extension, capped at 240min from now)

Output:
  status: 'renewed' | 'not_found' | 'not_owner' | 'expired'
  expires_at: ISO timestamp   (new expiry, on success)
```
*Rationale: long-running DLF audit sessions exceed the 30-min default TTL. `renew_artifact` allows the agent to extend before expiry without releasing and re-claiming (which creates a conflict window).*

**`list_active_claims`**
```
Input:
  artifact_type?: string   (filter; omit for all types)

Output:
  claims: Array<{
    lease_id, artifact_type, artifact_id,
    agent_id, task_description,
    expires_at, seconds_remaining
  }>
```

**`check_artifact_availability`**
```
Input:
  artifact_type: string
  artifact_id: string

Output:
  available: boolean
  lease?: { agent_id, task_description, expires_at, seconds_remaining }

Note: this is a snapshot, not a guarantee. The artifact may be claimed between this
call and the actual claim_artifact call. Always use claim_artifact as the
authoritative check — availability can change in the window between calls.
```

### REST API

```
GET    /api/projects/:id/artifact-leases            list active leases
POST   /api/projects/:id/artifact-leases            claim  { agent_id, artifact_type, artifact_id, task_description, ttl_minutes? }
PATCH  /api/projects/:id/artifact-leases/:leaseId   renew  { agent_id, extend_by_minutes }
DELETE /api/projects/:id/artifact-leases/:leaseId   release { agent_id }
POST   /api/projects/:id/artifact-leases/check       availability check { artifact_type, artifact_id }
# (Earlier draft had GET /:leaseId status check — superseded during Sprint 13.1
#  REVIEW-CODE r1; see docs/audit/findings-sprint-13.1-code-r1.md BLOCK 1.
#  POST /check mirrors the MCP check_artifact_availability tool 1:1.)
```

Admin override (requires `admin` role API key):
```
DELETE /api/admin/artifact-leases/:leaseId          force-release any lease (no agent_id check)
```

Rate limiting enforced at the service layer: max 10 active leases per `(agent_id, project_id)` and max 20 `claim_artifact` attempts per `(agent_id, project_id)` per minute.

### TTL enforcement

Two mechanisms:
1. **Lazy cleanup on `claim_artifact`** — DELETE expired leases for the same artifact inside the acquisition transaction (step 1 above).
2. **`setTimeout`-based scheduler in server process** — on server startup, register a repeating timer that enqueues a `leases.sweep` job every 15 minutes. The worker deletes leases where `expires_at < now() - interval '1 hour'` (keeps recently-expired leases briefly as audit record). This avoids an external cron dependency. New job type added to `JobType` enum: `'leases.sweep'`.

### GUI: Active Work panel

New section in the existing **Agents** page (`/agents`), added below the agent trust table.

**"Active Work" table:**
| Artifact | Type | Agent | Task | Time remaining | |
|---|---|---|---|---|---|
| `report-section/reckoning-record-s2` | report-section | `claude-code-sonnet-4.6` | Filling Past Decisions Catalog | 18 min | Force-release |

- **10-second** auto-refresh + manual refresh button + "Last updated X seconds ago" label
- "Force-release" column visible only to `admin` role API key holders
- Empty state: "No active work claims — agents are not currently claiming artifacts"

---

## Feature 2: Review-Request State

Closes F3.

### Concept

Today an agent signals "this needs human review" by setting `status: draft`. This is ambiguous — draft also means "still being worked on." Phase 13 adds `pending-review` as an explicit intermediate state: the agent is done; a human decision is required before the artifact can be promoted to `active`.

When an agent calls `submit_for_review`, the lesson transitions to `pending-review` and a `review_requests` record is created. The GUI surfaces these in a dedicated **"Submitted for Review"** tab in the existing Review Inbox page — separate from the auto-generated lessons queue.

**DLF mapping:** In Dead Light Framework context, a lesson with `lesson_type: 'candidate-decision'` (or any DLF profile type) and `status: 'pending-review'` is the ContextHub equivalent of `[AI candidate — awaiting project-owner confirmation]` in `reckoning-record.md`. When the project owner approves the request, the lesson becomes `active` — equivalent to confirming the entry and removing the `[AI candidate]` marker. This mapping is intentional and must be documented in the DLF profile description.

### Status lifecycle update

```
Current:  draft → active → superseded
                         → archived

Extended: draft ──────────────────────────→ active → superseded
            │                                             → archived
            └──→ pending-review → active (approved by human)
                               → draft   (returned for revision)
```

Valid `update_lesson_status` transitions with `pending-review`:
- `draft → pending-review` ✓ (via `submit_for_review` only — not via `update_lesson_status` directly)
- `pending-review → active` ✓ (human approves via REST)
- `pending-review → draft` ✓ (human returns for revision via REST)
- `active → pending-review` ✗ (already published — use `superseded` flow)
- `pending-review → superseded` ✗ (must be active first)
- `draft → pending-review` via `update_lesson_status` ✗ (only `submit_for_review` creates the `review_requests` record; direct status update is blocked)

### Implementation specification — status enum in `mcp/index.ts`

The lesson status enum is hardcoded at 4 locations in `src/mcp/index.ts`. Each has a different intent; the change differs per location.

**New shared constant** — create `src/constants/lessonStatus.ts`:
```typescript
export const LESSON_STATUS_WRITABLE = ['draft', 'active', 'superseded', 'archived'] as const;
export const LESSON_STATUS_ALL      = [...LESSON_STATUS_WRITABLE, 'pending-review'] as const;
export type LessonStatusWritable    = typeof LESSON_STATUS_WRITABLE[number];
export type LessonStatusAll         = typeof LESSON_STATUS_ALL[number];
```

**Per-location changes** (grep: `z.enum.*draft.*active.*superseded.*archived`):

| Line (approx) | Tool / context | Current | Change |
|---|---|---|---|
| ~954 | `add_lesson` output / reflection filter | `z.enum(['draft','active','superseded','archived'])` | → `z.enum(LESSON_STATUS_ALL)` (filter — `pending-review` must be visible) |
| ~982 | `list_lessons` `status` filter | same | → `z.enum(LESSON_STATUS_ALL).optional()` |
| ~1064 | `search_lessons` `status` filter | same | → `z.enum(LESSON_STATUS_ALL).optional()` |
| ~1617 | `update_lesson_status` **input** target | same | **Keep as `z.enum(LESSON_STATUS_WRITABLE)`** — `pending-review` excluded at Zod level |

Additionally, inside the `update_lesson_status` handler body, add an explicit runtime guard (belt-and-suspenders for raw REST callers that bypass Zod):
```typescript
if (params.status === 'pending-review') {
  throw new ContextHubError(
    'Cannot transition to pending-review via update_lesson_status. ' +
    'Use submit_for_review to create a review request.'
  );
}
```

### Database — migration 0049

```sql
-- 0049_review_requests.sql

-- Constraint name verified from migration 0003_lesson_intelligence.sql: 'lessons_status_check'
ALTER TABLE lessons DROP CONSTRAINT IF EXISTS lessons_status_check;
ALTER TABLE lessons ADD CONSTRAINT lessons_status_check
  CHECK (status IN ('draft', 'pending-review', 'active', 'superseded', 'archived'));

-- Rollback note: to reverse this migration, first ensure no lessons have
-- status = 'pending-review', then drop and re-add the constraint without 'pending-review'.

CREATE TABLE review_requests (
  request_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          TEXT        NOT NULL,
  lesson_id           UUID        NOT NULL REFERENCES lessons(lesson_id) ON DELETE CASCADE,
  submitter_agent_id  TEXT        NOT NULL,
  reviewer_note       TEXT,
  intended_reviewer   TEXT,
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'approved', 'returned')),
  resolved_at         TIMESTAMPTZ,
  resolved_by         TEXT,
  resolution_note     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX review_requests_project_status_idx
  ON review_requests (project_id, status, created_at DESC);

-- One pending request per lesson at a time.
-- Returned requests don't block re-submission (status != 'pending').
CREATE UNIQUE INDEX review_requests_lesson_pending_uniq
  ON review_requests (lesson_id)
  WHERE status = 'pending';
```

### MCP tools

**`submit_for_review`**
```
Input:
  lesson_id: UUID
  reviewer_note?: string
  intended_reviewer?: string   (free text — "project-owner", agent_id, etc.)

Preconditions (validated; error returned if violated):
  - lesson must exist in this project
  - lesson.status must be 'draft'
  - no existing pending review_request for this lesson

Side effects:
  1. UPDATE lessons SET status = 'pending-review'
  2. INSERT INTO review_requests (...)
  3. INSERT INTO audit_log (action_type = 'lesson.submitted-for-review', ...)

Output (result object, discriminated on `status`):
  status: 'submitted' | 'lesson_not_found' | 'wrong_lesson_status' | 'already_pending'
  on status='submitted':           request_id, lesson_id, lesson_title, created_at
  on status='wrong_lesson_status': current_status
  on status='already_pending':     existing_request_id
```

**`list_review_requests`**
```
Input:
  status?: 'pending' | 'approved' | 'returned'   (default: 'pending')
  submitted_by?: string                           (filter by submitter_agent_id)
  limit?: number                                  (default 20, max 100)
  offset?: number

Output:
  items: Array<{
    request_id, lesson_id, lesson_title, lesson_type,
    submitter_agent_id, reviewer_note, intended_reviewer,
    status, created_at
  }>
  total_count: number
```

### REST API

```
GET  /api/projects/:id/review-requests
     ?status=pending|approved|returned
     &submitted_by={agent_id}
     &limit=20&offset=0

GET  /api/projects/:id/review-requests/:reqId       detail + full lesson content
POST /api/projects/:id/review-requests/:reqId/approve   { resolution_note? }
POST /api/projects/:id/review-requests/:reqId/return    { resolution_note }
```

Approve side effects: `lesson.status → active`; `review_request.status → approved`; audit log.
Return side effects: `lesson.status → draft`; `review_request.status → returned`; audit log.

Re-submission after `returned`: lesson is back to `draft`; agent revises; calls `submit_for_review` again → new `review_requests` record created (partial unique index allows this — old record has `status = 'returned'`, not `'pending'`).

### GUI: Review Inbox update

The existing Review Inbox page (`/review`) gets a second tab. **Badge count = auto-generated count + pending-review count** (sum of both queues, not just one).

**Tab 1 — "Auto-Generated"** (existing): lessons in `draft` status proposed by distillation or git intelligence.

**Tab 2 — "Submitted for Review"** (new): lessons in `pending-review` status with a `review_requests` record.

Tab 2 card:
```
[ Lesson title ]                           [Type badge]  [pending-review badge]
Submitted by: claude-code-sonnet-4.6 · 14 min ago
Intended reviewer: project-owner
Note: "Candidate decision from Phase 0 §2 — needs confirmation."

[ View full lesson ]  [ Approve → Active ]  [ Return to draft ]
```

---

## Feature 3: Domain Taxonomy Extension

Closes F4.

### Concept

A **taxonomy profile** is a named set of lesson types that extends the built-in vocabulary for a project. When a profile is active:

- GUI shows profile type labels instead of generic ones.
- `add_lesson` accepts the profile's types as valid `lesson_type` values (additive with built-ins).
- `search_lessons` and `list_lessons` support type-filtered queries using profile types.
- Export/import preserves profile type strings verbatim.
- `check_guardrails` engine checks lessons with `lesson_type = 'codex-guardrail'` in addition to `lesson_type = 'guardrail'` (decision D2).

**Deactivation behavior:** deactivating a profile does NOT change existing lesson data. Lessons with profile types retain their `lesson_type` string. The GUI renders unknown types as their raw string. `add_lesson` with a deactivated profile's type will fail validation. This is documented in the GUI deactivation confirmation dialog.

Built-in profiles are bundled with the server and seeded on startup. Projects can activate a built-in profile or create their own custom profiles.

### Profile format

`config/taxonomy-profiles/dlf-phase0.json`:
```json
{
  "slug": "dlf-phase0",
  "name": "Dead Light Framework — Phase 0 Reckoning",
  "description": "Lesson types for Phase 0 (Reckoning) audits per Dead Light Framework. Each type maps to a Reckoning Record section. A lesson with type 'candidate-decision' and status 'pending-review' is the ContextHub equivalent of '[AI candidate — awaiting project-owner confirmation]' in reckoning-record.md.",
  "version": "1.0",
  "lesson_types": [
    {
      "type": "reckoning-finding",
      "label": "Reckoning Finding",
      "description": "Current state observation (§1 Current State Audit).",
      "color": "#6366f1"
    },
    {
      "type": "candidate-decision",
      "label": "Candidate Decision",
      "description": "Past decision candidate (§2). Status pending-review = [AI candidate] awaiting project-owner confirmation.",
      "color": "#f59e0b"
    },
    {
      "type": "failure-candidate",
      "label": "Failure Candidate",
      "description": "Architect-rot or failure pattern (§3 Failure Inventory).",
      "color": "#ef4444"
    },
    {
      "type": "implicit-principle",
      "label": "Implicit Principle",
      "description": "\"Of course we'll...\" pattern surfaced for §4. AI aide writes independently before project-owner contribution.",
      "color": "#10b981"
    },
    {
      "type": "codex-guardrail",
      "label": "Codex Guardrail",
      "description": "Hard Stop (HS-*) or Notify Trigger (N-*) from an agent Codex. Fed into check_guardrails engine same as 'guardrail' type.",
      "color": "#8b5cf6"
    }
  ]
}
```

### Database — migration 0050

```sql
-- 0050_taxonomy_profiles.sql

CREATE TABLE taxonomy_profiles (
  profile_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT        NOT NULL,
  name          TEXT        NOT NULL,
  description   TEXT,
  version       TEXT        NOT NULL DEFAULT '1.0',
  lesson_types  JSONB       NOT NULL,
  is_builtin    BOOLEAN     NOT NULL DEFAULT false,
  -- For custom profiles: owner project_id for slug scoping.
  -- Built-in profiles have owner_project_id = NULL (global, slug unique globally).
  -- Custom profiles: slug unique per owner_project_id.
  owner_project_id TEXT     DEFAULT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Built-in slugs are globally unique (owner_project_id IS NULL)
  CONSTRAINT taxonomy_profiles_builtin_slug_uniq
    UNIQUE NULLS NOT DISTINCT (slug, owner_project_id)
);

-- Per-project profile activation (one active profile per project)
CREATE TABLE project_taxonomy_profiles (
  project_id    TEXT        NOT NULL,
  profile_id    UUID        NOT NULL REFERENCES taxonomy_profiles(profile_id),
  activated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_by  TEXT,
  PRIMARY KEY   (project_id)
);
```

**Slug scoping:** Built-in profiles (`owner_project_id IS NULL`) have globally unique slugs. Custom profiles scope their slug to `owner_project_id` — two different projects can each have a `"my-profile"` custom profile without collision.

**Seed on startup:** server reads `config/taxonomy-profiles/*.json`, upserts into `taxonomy_profiles` with `is_builtin = true`, `owner_project_id = NULL`. Slug is the upsert key for built-ins.

### Validation rules (enforced in `taxonomyService.ts`)

1. **`is_builtin` immutable via API:** `POST /api/taxonomy-profiles` always sets `is_builtin = false` regardless of payload. API handler explicitly overrides any incoming `is_builtin` field.

2. **No shadowing of built-in type names:** Custom profile `lesson_types[].type` must not include any of: `decision`, `preference`, `guardrail`, `workaround`, `general_note`. Validation error returned if violated.

3. **`add_lesson` validation:** `getValidLessonTypes(project_id)` returns `[...BUILTIN_TYPES, ...activeProfile.lesson_types.map(t => t.type)]`. Profile types are additive.

### `codex-guardrail` → guardrail engine integration (decision D2)

The guardrail engine currently queries lessons where `lesson_type = 'guardrail'`. With Phase 13, it is extended to also include `lesson_type = 'codex-guardrail'`:

```sql
-- Existing guardrail query (conceptual):
SELECT * FROM lessons WHERE project_id = $1
  AND lesson_type = 'guardrail' AND status = 'active'

-- Phase 13 extended query:
SELECT * FROM lessons WHERE project_id = $1
  AND lesson_type IN ('guardrail', 'codex-guardrail') AND status = 'active'
```

This means HS-*/N-* rules from a DLF Codex, when added as `codex-guardrail` lessons, will be enforced by `check_guardrails` at AI action boundaries. This is the intended behavior: Codex rules become machine-checkable constraints, not just documentation.

### REST API

```
GET  /api/taxonomy-profiles
     ?owner_project_id=...    (filter custom profiles by owner; omit for built-ins)
GET  /api/taxonomy-profiles/:slug

POST /api/taxonomy-profiles
     { slug, name, description?, lesson_types[], owner_project_id }
     (is_builtin always forced to false; slug shadowing of built-in types validated)

GET    /api/projects/:id/taxonomy-profile             active profile (null if none)
POST   /api/projects/:id/taxonomy-profile/activate    { slug }
DELETE /api/projects/:id/taxonomy-profile             deactivate
```

### Implementation specification — `lesson_type` centralization

The lesson type enum is hardcoded at 3 locations in `src/mcp/index.ts` and 1 in `src/kg/linker.ts`. These must be replaced with dynamic validation routed through `taxonomyService`.

**New shared constant** — create `src/constants/lessonTypes.ts`:
```typescript
export const BUILTIN_LESSON_TYPES = [
  'decision', 'preference', 'guardrail', 'workaround', 'general_note'
] as const;

// Both types are treated as guardrail rules by check_guardrails engine
export const GUARDRAIL_LESSON_TYPES = ['guardrail', 'codex-guardrail'] as const;

export type BuiltinLessonType = typeof BUILTIN_LESSON_TYPES[number];
```

**Per-location changes** (grep: `z.enum.*decision.*preference.*guardrail.*workaround`):

| File | Line (approx) | Tool / context | Change |
|---|---|---|---|
| `mcp/index.ts` | ~948 | `add_lesson` input | `z.enum([...])` → `z.string()` + runtime validation (see below) |
| `mcp/index.ts` | ~1040 | `list_lessons` filter | `z.enum([...])` → `z.string().optional()` — no validation (pass-through WHERE) |
| `mcp/index.ts` | ~1309 | `suggest_lessons_from_commits` | `z.enum([...])` → `z.string()` + runtime validation |

**Runtime validation pattern** — add to every write-path handler after Zod parse:
```typescript
// In add_lesson handler and any tool that writes lesson_type:
const validTypes = await taxonomyService.getValidLessonTypes(params.project_id);
if (!validTypes.includes(params.lesson_type)) {
  throw new ContextHubError(
    `Invalid lesson_type '${params.lesson_type}'. ` +
    `Valid types: ${validTypes.join(', ')}`
  );
}
```

**`src/kg/linker.ts` — add `codex-guardrail` edge mapping** (line ~7):
```typescript
// Before:
if (t === 'guardrail') return 'CONSTRAINS';
if (t === 'preference') return 'PREFERS';

// After:
if (t === 'guardrail' || t === 'codex-guardrail') return 'CONSTRAINS';
if (t === 'preference') return 'PREFERS';
```

**Guardrail engine** — find the query in `src/services/` that fetches guardrail lessons and extend it:
```sql
-- Before:
WHERE lesson_type = 'guardrail' AND status = 'active'

-- After:
WHERE lesson_type = ANY($guardrail_types) AND status = 'active'
-- where guardrail_types = GUARDRAIL_LESSON_TYPES = ['guardrail', 'codex-guardrail']
```

**`src/services/analytics.ts`** — no changes needed. The analytics service does `GROUP BY lesson_type` from DB rows (no hardcoded type list). Profile types appear naturally in the breakdown.

### Search and `add_lesson` integration

New `src/services/taxonomyService.ts`:
```typescript
getValidLessonTypes(project_id: string): Promise<string[]>
  // returns [...BUILTIN_LESSON_TYPES, ...activeProfile.lesson_types.map(t => t.type)]
getProfileForProject(project_id: string): Promise<TaxonomyProfile | null>
getLessonTypeLabel(project_id: string, type: string): Promise<string>
  // falls back to type itself if not in active profile
```

`reflect` and `get_context`: when profile is active, group lessons by type using profile labels.

### GUI: Project Settings → Taxonomy tab

New tab added to Project Settings page (after "Knowledge Exchange"):

```
[ Overview ]  [ Knowledge Exchange ]  [ Taxonomy ]  [ Access ]

─── Active Taxonomy Profile ─────────────────────────────────────
  ○ No profile (built-in vocabulary only)
  ● Dead Light Framework — Phase 0 Reckoning     v1.0  [Deactivate]

  ⚠ Deactivating will not change existing lessons. Lessons with profile
    types will display their raw type string. New lessons will not accept
    profile types until a profile is reactivated.

─── Lesson Types in this profile ────────────────────────────────
  ■ Reckoning Finding     — Current state observation (§1)
  ■ Candidate Decision    — Past decision candidate (§2) · [AI candidate]
  ■ Failure Candidate     — Architect-rot / failure (§3)
  ■ Implicit Principle    — "Of course we'll..." (§4)
  ■ Codex Guardrail       — HS-*/N-* rule · enforced by check_guardrails

─── Available Profiles ──────────────────────────────────────────
  Dead Light Framework — Phase 0 Reckoning   [Activate]
  + Create custom profile
```

---

## DLF-specific workflow note

**ContextHub as review hub; reckoning-record.md as canonical artifact.**

Phase 13 positions ContextHub as the *collaboration and review layer* for DLF Phase 0, not the canonical artifact store. The `reckoning-record.md` file in the framework Git repository remains the canonical output. The integration workflow is:

1. AI aide adds findings/candidates as lessons (DLF profile types) in ContextHub.
2. Project owner reviews via "Submitted for Review" tab → approves or returns.
3. Approved lessons are read back by the AI aide and written to `reckoning-record.md` — confirmed entries without `[AI candidate]` marker.

**The sync path (step 3) is manual in Phase 13:** the AI aide reads `list_review_requests(status='approved')` and writes the entries to `reckoning-record.md`. Automated export (ContextHub → Markdown per DLF section) is deferred to a future phase if the workflow proves valuable at scale. This is an explicit known gap, not an oversight.

---

## Migration Index

| Migration | Feature | Description |
|---|---|---|
| 0048 | F1 | `artifact_leases` table · active partial unique index · sweep index · agent-project rate-limit index |
| 0049 | F2 | `review_requests` table · extend `lessons.status` check constraint (verify constraint name before running) |
| 0050 | F3 | `taxonomy_profiles` table (with `owner_project_id` for custom slug scoping) · `project_taxonomy_profiles` join table |

---

## Inter-feature integration

**F1 + F2:** When an agent calls `submit_for_review`, it should also call `release_artifact` for any active lease on the same lesson — the work is done. Recommended in documentation; not enforced by the system (agent may retain lease for partial-draft review).

**F2 + F3:** `review_requests` list in GUI shows lesson type labels using active taxonomy profile. A `candidate-decision` pending review renders with the DLF label, not raw type string.

**F3 + guardrail engine:** `check_guardrails` queries `lesson_type IN ('guardrail', 'codex-guardrail')`. No other feature integration required.

---

## Sprint Plan

| Sprint | Deliverable | Key outputs |
|---|---|---|
| **13.1** | F1 core | Migration 0048 · `claim_artifact` (with `agent_id`, rate limiting, atomic tx), `release_artifact`, `renew_artifact`, `list_active_claims`, `check_artifact_availability` MCP tools · REST `/artifact-leases` CRUD + admin force-release · artifact_id convention documented · unit tests |
| **13.2** | F1 TTL + GUI | `leases.sweep` job + setTimeout scheduler · Active Work panel on Agents page (10s refresh) · MCP smoke tests |
| **13.3** | F2 core | Migration 0049 · Create `src/constants/lessonStatus.ts` (LESSON_STATUS_WRITABLE / LESSON_STATUS_ALL) · Update 3 filter sites in `mcp/index.ts` → `z.enum(LESSON_STATUS_ALL)` · Keep `update_lesson_status` on WRITABLE + add runtime guard · `submit_for_review`, `list_review_requests` (with `submitted_by` filter) MCP tools · REST `/review-requests` CRUD (approve / return) · unit tests |
| **13.4** | F2 GUI | "Submitted for Review" tab in Review Inbox · badge count = sum of both queues · approve/return actions · audit log entries · MCP smoke tests |
| **13.5** | F3 core | Migration 0050 · Create `src/constants/lessonTypes.ts` (BUILTIN_LESSON_TYPES / GUARDRAIL_LESSON_TYPES) · `taxonomyService.ts` with `getValidLessonTypes` · Replace 2 write-path `z.enum([...lesson_type...])` in `mcp/index.ts` → `z.string()` + runtime validation · Replace 1 filter `z.enum` → `z.string().optional()` · Update `kg/linker.ts` line ~7 for `codex-guardrail → CONSTRAINS` · Extend guardrail engine query to `lesson_type = ANY(GUARDRAIL_LESSON_TYPES)` · Taxonomy profile DB + seeding + `dlf-phase0.json` · `is_builtin` enforcement · shadowing validation · REST profile management · **unit tests (taxonomyService, guardrail engine, linker edge mapping)** |
| **13.6** | F3 GUI + search | Project Settings → Taxonomy tab · deactivation confirmation dialog with behavior note · profile activation UI · `list_lessons`/`search_lessons` label rendering · `reflect` grouping by profile type |
| **13.7** | E2E + integration | Concurrent claim conflict · TTL expiry + auto-release · `renew_artifact` before expiry · `submit_for_review` → approve → `reckoning-record.md` write (DLF workflow) · taxonomy profile activation + `codex-guardrail` in `check_guardrails` · zero regressions on Phase 1–12 flows |

---

## Acceptance Criteria

**Feature 1 complete when:**
- [ ] `claim_artifact` (with `agent_id`) returns `conflict` when active lease exists; returns `claimed` when available
- [ ] `claim_artifact` returns `rate_limited` when agent has ≥ 10 active leases in project
- [ ] Concurrent `claim_artifact` calls on same artifact: exactly one succeeds, others get `conflict` (not 500)
- [ ] `release_artifact` returns `not_owner` when `agent_id` doesn't match lease owner
- [ ] `renew_artifact` extends `expires_at`; returns `expired` if lease already expired
- [ ] `list_active_claims` excludes expired leases
- [ ] `leases.sweep` job runs every 15 min via setTimeout scheduler; deletes leases expired > 1 hour ago
- [ ] Active Work panel shows 10s auto-refresh; admin can force-release

**Feature 2 complete when:**
- [ ] `submit_for_review` transitions `draft → pending-review` and creates `review_requests` record
- [ ] `submit_for_review` returns error if lesson not `draft`, or pending request already exists
- [ ] `list_review_requests` with `submitted_by` filter returns only that agent's requests
- [ ] REST approve: `pending-review → active`; `review_request → approved`
- [ ] REST return: `pending-review → draft`; `review_request → returned`
- [ ] Re-submission after `returned` creates new `review_requests` record (old `returned` record not blocking)
- [ ] `update_lesson_status` rejects `draft → pending-review` (must use `submit_for_review`)
- [ ] Review Inbox badge = auto-generated count + pending-review count

**Feature 3 complete when:**
- [ ] `dlf-phase0` profile seeded on startup; persists across restarts (upsert by slug)
- [ ] Custom profile with `is_builtin: true` in payload → server forces `false`
- [ ] Custom profile with `lesson_types[].type = 'guardrail'` → validation error (shadowing built-in)
- [ ] `add_lesson` with active DLF profile: accepts `candidate-decision`; rejects unknown types
- [ ] `check_guardrails` matches lessons with `lesson_type = 'codex-guardrail'` (D2)
- [ ] Deactivating profile: existing `candidate-decision` lessons retain type; GUI shows raw string; new `add_lesson` with that type fails
- [ ] Project Settings Taxonomy tab: activate/deactivate; deactivation dialog shows behavior warning
- [ ] Custom profiles scoped by `owner_project_id`: two projects can each have `slug = 'my-profile'`

**Phase 13 complete when:** all criteria above pass + Sprint 13.7 E2E suite passes with zero Phase 1–12 regressions.
