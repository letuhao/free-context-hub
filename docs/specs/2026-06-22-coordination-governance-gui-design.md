# DESIGN — Coordination & Governance GUI (FIX-1 / FIX-2)

**Decision (2026-06-22):** build **full create/act CRUD** GUI for every coordination
and governance primitive before v0.1.0. The REST surface already exists (verified);
this is primarily GUI work + a few missing **list** endpoints.

Scope owner: release/v0.1.0-prep. Tracker: [`../qc/RELEASE_READINESS.md`](../qc/RELEASE_READINESS.md).

---

## 1. Navigation

Two new sidebar groups (admin/scope-gated like the existing Governance group):

```
Coordination
  ├ Topics            /coordination                 (list)
  ├ Topic detail      /coordination/topics/[id]      (roster, event log, board, close)
  └ Artifact Leases   /coordination/leases           (active claims, renew/release)

Governance
  ├ Decision Bodies   /governance/decision-bodies     (+ /[id])
  ├ Motions           /governance/motions             (per-topic; propose/vote/tally)
  ├ Requests          /governance/requests            (DoA approval routing)
  ├ Intake            /governance/intake              (mailbox triage)
  └ Disputes          /governance/disputes
  (existing) Review Inbox /review · Access Review /governance/access-review
```

## 2. Page → endpoint mapping

### Coordination

| Page | Action | Endpoint | Status |
|------|--------|----------|--------|
| Topics list | list topics for project | `GET /api/topics?project_id=` | **NEW endpoint needed** |
| | charter topic | `POST /api/topics` | exists |
| Topic detail | get topic + roster | `GET /api/topics/:id` | exists |
| | join | `POST /api/topics/:id/join` | exists |
| | grant level | `POST /api/topics/:id/grant-level` | exists |
| | event log | `GET /api/topics/:id/events` | exists |
| | live updates | `GET /api/topics/:id/stream` (SSE) | exists |
| | close | `POST /api/topics/:id/close` | exists |
| Board (in topic detail) | list board | `GET /api/topics/:id/board` | exists |
| | post task | `POST /api/topics/:id/tasks` | exists |
| | claim/release/complete | `POST /api/tasks/:id/{claim,release,complete}` | exists |
| | write/baseline artifact | `PUT /api/artifacts/:id`, `POST /api/artifacts/:id/baseline` | exists |
| Leases | list active claims | `GET /api/projects/:id/artifact-leases` | exists |
| | claim/renew/release | (artifact-leases endpoints) | exists |

### Governance

| Page | Action | Endpoint | Status |
|------|--------|----------|--------|
| Decision Bodies | list / get | `GET /api/decision-bodies`, `/:id` | exists |
| | create / add member | `POST /api/decision-bodies`, `/:id/members` | exists |
| | proxies (grant/revoke/list) | `POST/DELETE/GET /api/decision-bodies/:id/proxies` | exists |
| Motions | list per topic | `GET /api/topics/:id/motions` | exists |
| | propose | `POST /api/topics/:id/motions` | exists |
| | get | `GET /api/motions/:id` | exists |
| | second / vote / veto / tally | `POST /api/motions/:id/{second,votes,veto,tally}` | exists |
| Requests | list / get per topic | `GET /api/topics/:id/requests`, `GET /api/requests/:id` | exists |
| | submit | `POST /api/topics/:id/requests` | exists |
| | decide step | `POST /api/requests/:id/steps/:n/decide` | exists |
| Intake | list per project | `GET /api/projects/:id/intake` | exists |
| | submit / get | `POST /api/intake`, `GET /api/intake/:id` | exists |
| | triage / dismiss | `POST /api/intake/:id/{triage,dismiss}` | exists |
| Disputes | list per topic | `GET /api/topics/:id/disputes` | exists |
| | open / get / resolve | `POST /api/disputes`, `GET /api/disputes/:id`, `POST /api/disputes/:id/resolve` | exists |

### Missing list endpoints to add (small BE work)

- `GET /api/topics?project_id=` — list topics (currently only create + get-by-id).
- Confirm a project-level **motions** and **requests** listing exists for a "my open
  items" view; if not, add `GET /api/projects/:id/{motions,requests}` (optional, P2).

## 3. Reusable components

- Existing UI kit: `PageHeader`, `Breadcrumb`, `DataTable`, `Badge`, `SearchBar`,
  `SlideOver`, `EmptyState`, `ConfirmDialog`, `StatCard`, `useToast`.
- New shared bits: `StatusPill` (topic/task/motion/request/dispute states),
  `ActorChip` (principal display), `EventLogStream` (SSE-backed, falls back to
  cursor replay), `VoteTally` (weighted bar + quorum/threshold markers).
- API client: extend `gui/src/lib/api.ts` with coordination + governance calls
  (mirror existing patterns; thread project scope + Bearer auth).

## 4. Build sprints (each: design→build→typecheck+build→scenario tests)

| Sprint | Deliverable | Scenarios it satisfies |
|--------|-------------|------------------------|
| **G1** | BE: `GET /api/topics` list (+ optional project-level lists) + api.ts client methods | prerequisite |
| **G2** | Coordination: Topics list + Topic detail (roster, event log + SSE, close) | SCN-COORD topic/replay/close |
| **G3** | Coordination: Board (tasks + artifacts) + Leases page | SCN-COORD board/claim/fencing/lease |
| **G4** | Governance: Decision Bodies + Motions/voting (propose→second→vote→veto→tally) | SCN-COORD motions/quorum/veto/proxy |
| **G5** | Governance: Requests (DoA routing, decide steps) | SCN-COORD request/DoA |
| **G6** | Governance: Intake (triage) + Disputes (open/resolve) | SCN-COORD intake/dispute |
| **M1** | FIX-3: MCP `ingest_document` tool (URL + base64) | SCN-MCP doc-ingest |
| **M2** | FIX-4: `reflect`/`compress_context` GUI surface (panel) | SCN-GUI reflect |

Each sprint ends with: GUI `next build` green, the relevant Playwright scenario(s)
authored + run, RELEASE_READINESS updated, checkpoint commit.

## 5. Non-goals (v0.1.0)

- No redesign of existing pages. No new governance *primitives* (UI over existing
  ones only). SSE is best-effort with cursor-replay fallback.
