# Phase 13: Multi-Agent Coordination Protocol — Design Document

**Status:** Design (in progress — 2026-05-14)
**Branch:** `phase-13-dlf-coordination`
**Migrations:** 0048–0050
**Motivating case:** Dead Light Framework Phase 0 audit (LoreWeave case study)

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

Phase 13 adds three features to close these gaps. The solutions are general; DLF provides the reference implementation.

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

An agent that is about to work on a named artifact calls `claim_artifact`. This creates a **lease**: a time-bounded, agent-attributed record in the database. Other agents calling `claim_artifact` on the same artifact receive a `conflict` response with the incumbent's identity and remaining time. The human can see all active claims in the GUI.

Leases are **optimistic**: they do not block writes at the DB level. A conflicting agent that ignores the `conflict` response can still write — the system surfaces the conflict, it does not enforce a lock. This keeps the system useful under partial failures (e.g., an agent crashes without releasing its lease) while still making coordination visible.

### Database — migration 0048

```sql
-- 0048_artifact_leases.sql
CREATE TABLE artifact_leases (
  lease_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   TEXT        NOT NULL,
  agent_id     TEXT        NOT NULL,
  artifact_type TEXT       NOT NULL,   -- 'lesson' | 'document' | 'report-section' | 'custom'
  artifact_id  TEXT        NOT NULL,   -- lesson UUID, document UUID, or free-form string
  task_description TEXT   NOT NULL,
  ttl_minutes  INT         NOT NULL DEFAULT 30,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active (non-expired) lease per artifact per project
CREATE UNIQUE INDEX artifact_leases_active_uniq
  ON artifact_leases (project_id, artifact_type, artifact_id)
  WHERE expires_at > now();

-- Cleanup index for expired lease sweep
CREATE INDEX artifact_leases_expires_at_idx ON artifact_leases (expires_at);
```

**Notes:**
- The partial UNIQUE INDEX enforces one-active-lease-per-artifact without blocking expired lease rows.
- Expired leases are not deleted immediately — they stay as audit record until a background sweep removes them (or until next `claim_artifact` on the same artifact cleans lazily).

### Lease acquisition logic

```
claim_artifact(project_id, agent_id, artifact_type, artifact_id, task_description, ttl_minutes):
  1. DELETE FROM artifact_leases
       WHERE project_id = $1 AND artifact_type = $3 AND artifact_id = $4
         AND expires_at <= now()                          -- lazy cleanup of expired

  2. SELECT * FROM artifact_leases
       WHERE project_id = $1 AND artifact_type = $3 AND artifact_id = $4
         AND expires_at > now()                           -- check for active lease

  3. If row found → return CONFLICT {
       incumbent_agent_id, task_description, expires_at, seconds_remaining
     }

  4. If no row → INSERT lease, return SUCCESS {
       lease_id, expires_at
     }
```

### MCP tools

**`claim_artifact`**
```
Input:
  artifact_type: 'lesson' | 'document' | 'report-section' | string
  artifact_id: string  (UUID for lessons/docs; free string for sections e.g. "reckoning-record-§2")
  task_description: string  (what this agent intends to do)
  ttl_minutes?: number  (default 30, max 240)

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
```

**`release_artifact`**
```
Input:
  lease_id: UUID

Output:
  status: 'released' | 'not_found' | 'not_owner'
  (agents can only release their own leases; admin API key can release any)
```

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
```

### REST API

```
GET    /api/projects/:id/artifact-leases          list active leases (human GUI)
POST   /api/projects/:id/artifact-leases          claim (mirrors MCP tool)
DELETE /api/projects/:id/artifact-leases/:leaseId release
GET    /api/projects/:id/artifact-leases/:leaseId status check
```

Admin override (requires admin API key):
```
DELETE /api/admin/artifact-leases/:leaseId        force-release any lease
```

### TTL enforcement

Two mechanisms:
1. **Lazy cleanup on `claim_artifact`** — DELETE expired leases for the same artifact before attempting to claim (already in the acquisition logic above).
2. **Background sweep job** — new job type `leases.sweep` runs every 15 minutes via the existing async_jobs worker, deleting all leases where `expires_at < now() - interval '1 hour'` (keeps expired leases briefly for audit, then purges).

New job type added to `JobType` enum: `'leases.sweep'`.

### GUI: Active Work panel

New section in the existing **Agents** page (`/agents`), added below the agent trust table:

**"Active Work" table:**
| Artifact | Type | Agent | Task | Time remaining | Action |
|---|---|---|---|---|---|
| `reckoning-record-§2` | report-section | `claude-code-sonnet-4.6` | Filling Past Decisions Catalog | 18 min | Force-release (admin) |

- Refresh every 30s (or manual refresh button)
- "Force-release" visible only to admin API key holders

---

## Feature 2: Review-Request State

Closes F3.

### Concept

Today an agent signals "this needs human review" by setting `status: draft`. This is ambiguous — draft also means "still being worked on." Phase 13 adds `pending-review` as an explicit intermediate state: the agent is done; a human decision is required before the artifact can be promoted to `active`.

When an agent calls `submit_for_review`, the lesson transitions to `pending-review` and a `review_requests` record is created. The GUI surfaces these in a dedicated **"Submitted for Review"** tab in the existing Review Inbox page — separate from the auto-generated lessons queue.

### Status lifecycle update

```
Current:  draft → active → superseded
                         → archived

Extended: draft ──────────────────────────→ active → superseded
            │                                             → archived
            └──→ pending-review → active (approved)
                               → draft   (returned for revision)
```

Valid `update_lesson_status` transitions with `pending-review`:
- `draft → pending-review` ✓
- `pending-review → active` ✓ (human approves)
- `pending-review → draft` ✓ (human returns for revision)
- `active → pending-review` ✗ (already published; use `superseded` flow)
- `pending-review → superseded` ✗ (must be active first)

### Database — migration 0049

```sql
-- 0049_review_requests.sql

-- Extend lesson status check constraint to include pending-review
ALTER TABLE lessons DROP CONSTRAINT IF EXISTS lessons_status_check;
ALTER TABLE lessons ADD CONSTRAINT lessons_status_check
  CHECK (status IN ('draft', 'pending-review', 'active', 'superseded', 'archived'));

-- Review request records
CREATE TABLE review_requests (
  request_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      TEXT        NOT NULL,
  lesson_id       UUID        NOT NULL REFERENCES lessons(lesson_id) ON DELETE CASCADE,
  submitter_agent_id TEXT     NOT NULL,
  reviewer_note   TEXT,
  intended_reviewer TEXT,     -- optional: agent_id or human label (free text)
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'approved', 'returned')),
  resolved_at     TIMESTAMPTZ,
  resolved_by     TEXT,       -- agent_id or 'human' when resolved via GUI
  resolution_note TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX review_requests_project_status_idx
  ON review_requests (project_id, status, created_at DESC);

CREATE UNIQUE INDEX review_requests_lesson_pending_uniq
  ON review_requests (lesson_id)
  WHERE status = 'pending';    -- one pending request per lesson at a time
```

### MCP tools

**`submit_for_review`**
```
Input:
  lesson_id: UUID
  reviewer_note?: string    (context for the human reviewer)
  intended_reviewer?: string (free text — "project-owner", an agent_id, etc.)

Preconditions (validated, return error if violated):
  - lesson must exist in this project
  - lesson.status must be 'draft'
  - no existing pending review_request for this lesson

Side effects:
  1. UPDATE lessons SET status = 'pending-review' WHERE lesson_id = $1
  2. INSERT INTO review_requests (...)
  3. INSERT INTO audit_log (action_type = 'lesson.submitted-for-review', ...)

Output:
  request_id: UUID
  lesson_id: UUID
  lesson_title: string
  status: 'pending'
  created_at: ISO timestamp
```

**`list_review_requests`**
```
Input:
  status?: 'pending' | 'approved' | 'returned'  (default: 'pending')
  limit?: number   (default 20, max 100)
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
GET  /api/projects/:id/review-requests         list (filters: status, agent_id, limit, offset)
GET  /api/projects/:id/review-requests/:reqId  detail + full lesson content
POST /api/projects/:id/review-requests/:reqId/approve   { resolution_note? }
POST /api/projects/:id/review-requests/:reqId/return    { resolution_note }
```

Approve side effects: UPDATE lesson status → `active`; UPDATE review_request status → `approved`; audit log entry.
Return side effects: UPDATE lesson status → `draft`; UPDATE review_request status → `returned`; audit log entry.

### GUI: Review Inbox update

The existing Review Inbox page (`/review`) gets a second tab:

**Tab 1 — "Auto-Generated"** (existing behavior): lessons in `draft` status auto-proposed by distillation or git intelligence.

**Tab 2 — "Submitted for Review"** (new): lessons in `pending-review` status with a linked `review_requests` record.

Tab 2 card layout (per request):
```
[ Lesson title ]                           [Type badge]  [Pending-review badge]
Submitted by: claude-code-sonnet-4.6 · 14 min ago
Intended reviewer: project-owner
Note: "This is a candidate decision from Phase 0 §2 — needs confirmation before
       it can be promoted to active."

[ View full lesson ]  [ Approve → Active ]  [ Return to draft ]
```

Resolution actions trigger the REST API endpoints above.

---

## Feature 3: Domain Taxonomy Extension

Closes F4.

### Concept

A **taxonomy profile** is a named set of lesson types that replaces or extends the built-in `decision|preference|guardrail|workaround|general_note` vocabulary for a project. When a profile is active on a project:

- The GUI shows profile type labels instead of generic ones.
- MCP `add_lesson` and `list_lessons` accept the profile's types as valid `lesson_type` values.
- `search_lessons` supports type-filtered queries using profile types.
- Export/import preserves profile type strings verbatim.

Built-in profiles are bundled with the server and seeded on startup. Projects can activate a built-in profile or define their own via the API.

### Profile format

`config/taxonomy-profiles/dlf-phase0.json`:
```json
{
  "slug": "dlf-phase0",
  "name": "Dead Light Framework — Phase 0 Reckoning",
  "description": "Lesson types for structured Phase 0 (Reckoning) audits per Dead Light Framework. Each type maps to a section of the Reckoning Record output artifact.",
  "version": "1.0",
  "lesson_types": [
    {
      "type": "reckoning-finding",
      "label": "Reckoning Finding",
      "description": "Current state observation (§1 Current State Audit). Describes what exists now — topology, contracts, discrepancies, external integrations.",
      "color": "#6366f1"
    },
    {
      "type": "candidate-decision",
      "label": "Candidate Decision",
      "description": "Past decision candidate for §2 Past Decisions Catalog. Marked [AI candidate] until confirmed by project owner.",
      "color": "#f59e0b"
    },
    {
      "type": "failure-candidate",
      "label": "Failure Candidate",
      "description": "Architect-rot or failure pattern for §3 Failure Inventory. Covers context rot, conflicting refactors, scope drift, and decision reversals.",
      "color": "#ef4444"
    },
    {
      "type": "implicit-principle",
      "label": "Implicit Principle",
      "description": "\"Of course we'll...\" pattern surfaced for §4 Implicit Principles Surface. Written independently by AI aide before project owner contribution.",
      "color": "#10b981"
    },
    {
      "type": "codex-guardrail",
      "label": "Codex Guardrail",
      "description": "Hard Stop (HS-*) or Notify Trigger (N-*) derived from an agent Codex. Enforced via check_guardrails before relevant AI actions.",
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
  slug          TEXT        NOT NULL UNIQUE,
  name          TEXT        NOT NULL,
  description   TEXT,
  version       TEXT        NOT NULL DEFAULT '1.0',
  lesson_types  JSONB       NOT NULL,   -- array of {type, label, description, color}
  is_builtin    BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-project profile activation (a project can activate one profile at a time)
CREATE TABLE project_taxonomy_profiles (
  project_id    TEXT        NOT NULL,
  profile_id    UUID        NOT NULL REFERENCES taxonomy_profiles(profile_id),
  activated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_by  TEXT,       -- agent_id or 'human'
  PRIMARY KEY   (project_id)
);
```

**Seed on startup:** server reads all `*.json` files in `config/taxonomy-profiles/`, upserts them into `taxonomy_profiles` with `is_builtin = true`. Slug is the unique key — built-in profiles cannot be deleted via API.

### REST API

```
GET  /api/taxonomy-profiles                        list all available profiles (built-in + custom)
GET  /api/taxonomy-profiles/:slug                  profile detail + lesson_types
POST /api/taxonomy-profiles                        create custom profile  { slug, name, description, lesson_types[] }

GET  /api/projects/:id/taxonomy-profile            active profile for this project (null if none)
POST /api/projects/:id/taxonomy-profile/activate   { slug }  → activate profile
DELETE /api/projects/:id/taxonomy-profile          deactivate (revert to built-in vocabulary)
```

### Search and add_lesson integration

When a project has an active taxonomy profile:

1. **`add_lesson` validation:** `lesson_type` is validated against `[...built_in_types, ...profile.lesson_types.map(t => t.type)]`. Profile types are additive — built-in types remain valid.

2. **`list_lessons` and `search_lessons` MCP tools:** `lesson_type` filter parameter accepts profile types. No code change needed (filters are passed through as TEXT equality checks).

3. **`reflect` and `get_context`:** when building project summary, group lessons by type using profile labels when profile is active.

4. **Type validation service** (new `src/services/taxonomyService.ts`):
   ```
   getValidLessonTypes(project_id) → string[]
   getProfileForProject(project_id) → TaxonomyProfile | null
   getLessonTypeLabel(project_id, type) → string  (falls back to type itself if not in profile)
   ```

### GUI: Project Settings → Taxonomy tab

New tab in the existing Project Settings page:

```
[ Overview ]  [ Knowledge Exchange ]  [ Taxonomy ]  [ Access ]

─── Active Taxonomy Profile ─────────────────────────────────
  ○ No profile (built-in vocabulary only)
  ● Dead Light Framework — Phase 0 Reckoning        v1.0  [Deactivate]

─── Lesson Types in this profile ────────────────────────────
  ● Reckoning Finding     — Current state observation (§1)
  ● Candidate Decision    — Past decision candidate (§2)
  ● Failure Candidate     — Architect-rot / failure (§3)
  ● Implicit Principle    — "Of course we'll..." (§4)
  ● Codex Guardrail       — HS-* / N-* rule

─── Available Profiles ──────────────────────────────────────
  Dead Light Framework — Phase 0 Reckoning   [Activate]
  + Create custom profile
```

---

## Migration Index

| Migration | Feature | Description |
|---|---|---|
| 0048 | F1 | `artifact_leases` table + partial unique index + expiry index |
| 0049 | F2 | `review_requests` table + extend `lessons.status` check constraint |
| 0050 | F3 | `taxonomy_profiles` table + `project_taxonomy_profiles` join table |

---

## Inter-feature integration

**F1 + F2:** When an agent calls `submit_for_review`, it should also `release_artifact` for any active lease on the same lesson — the work is done. This is recommended in MCP tool documentation but not enforced (agent may be submitting a partial draft for interim review while retaining the lease).

**F2 + F3:** `review_requests` list in GUI shows lesson type labels using the active taxonomy profile when one is set. A `candidate-decision` pending review renders with the DLF label, not the raw type string.

**F1 + F3:** `claim_artifact` `task_description` is free text — the agent can mention the lesson type in its description (e.g., "filling candidate-decision entries for §2"). No structural integration needed.

---

## Sprint Plan

| Sprint | Deliverable | Key outputs |
|---|---|---|
| **13.1** | F1 core | Migration 0048 · `claim_artifact`, `release_artifact`, `list_active_claims`, `check_artifact_availability` MCP tools · REST `/artifact-leases` CRUD · unit tests |
| **13.2** | F1 TTL + GUI | `leases.sweep` background job · Active Work panel on Agents page · MCP smoke tests |
| **13.3** | F2 core | Migration 0049 · `submit_for_review`, `list_review_requests` MCP tools · REST `/review-requests` CRUD (approve / return actions) · status transition validation · unit tests |
| **13.4** | F2 GUI | "Submitted for Review" tab in Review Inbox page · approve/return actions · audit log entries · MCP smoke tests |
| **13.5** | F3 core | Migration 0050 · taxonomy profile DB + seeding on startup · `dlf-phase0.json` bundled profile · REST profile management · `taxonomyService.ts` · lesson_type validation extended |
| **13.6** | F3 GUI + search | Project Settings → Taxonomy tab · profile activation UI · `list_lessons` / `search_lessons` label rendering · `reflect` grouping by profile type |
| **13.7** | E2E + integration | Full E2E suite: concurrent claim conflict · TTL expiry + auto-release · review-request → human-approval flow · taxonomy profile activation + type-filtered search · zero regressions on Phase 1–12 flows |

---

## Acceptance Criteria

**Feature 1 complete when:**
- [ ] `claim_artifact` returns `conflict` when active lease exists; returns `claimed` when available or after expiry
- [ ] `release_artifact` deletes lease and returns `released`; returns `not_owner` when agent_id doesn't match
- [ ] `list_active_claims` returns only non-expired leases; expired leases excluded
- [ ] `leases.sweep` job deletes leases older than 1 hour past expiry
- [ ] Active Work panel in GUI shows live lease state; admin can force-release

**Feature 2 complete when:**
- [ ] `submit_for_review` transitions lesson `draft → pending-review` and creates `review_requests` record
- [ ] `submit_for_review` returns error if lesson status is not `draft`, or if pending request already exists
- [ ] REST approve action: lesson `pending-review → active`; review_request `pending → approved`
- [ ] REST return action: lesson `pending-review → draft`; review_request `pending → returned`
- [ ] "Submitted for Review" tab in Review Inbox shows only pending-review lessons; counts separately from auto-generated queue
- [ ] `update_lesson_status` rejects `active → pending-review` (with descriptive error)

**Feature 3 complete when:**
- [ ] Server seeds `dlf-phase0` profile on startup; profile persists across restarts (upsert by slug)
- [ ] `POST /api/projects/:id/taxonomy-profile/activate` activates profile; subsequent `add_lesson` accepts profile types
- [ ] `add_lesson` with a profile type that is NOT in the active profile returns validation error listing valid types
- [ ] Built-in types remain valid regardless of active profile
- [ ] Project Settings Taxonomy tab shows active profile and its types; activate/deactivate controls work
- [ ] `search_lessons` with `lesson_type: "candidate-decision"` returns matching lessons when DLF profile is active

**Phase 13 complete when:** all three feature criteria above pass + Sprint 13.7 E2E suite passes with zero Phase 1–12 regressions.
