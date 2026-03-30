# Multi-Repo Strategy for free-context-hub

## Context

The user operates multiple repositories across different systems (not just microservices within one system). These systems integrate with each other (e.g., Order system integrates with Payment system), but they are distinct bounded contexts — possibly owned by different teams.

**Key distinction:** Microservices are internal parts of a system. Integration is how separate systems communicate across boundaries. They share contracts, not internals.

## Current Capability

free-context-hub already supports multi-repo natively:

- `project_id` scopes all data (lessons, guardrails, embeddings, code chunks)
- `project_workspaces` table supports multiple filesystem roots per project
- `project_sources` table supports remote git repo URLs per project
- All queries are isolated by `project_id` — no cross-contamination

## Chosen Strategy: Option C — Hybrid (Multi-Layer)

```
┌─────────────────────────────────────────────────┐
│            Shared Knowledge Layer                │
│  (API contracts, integration patterns, auth)     │
├────────────────────┬────────────────────────────┤
│   Order System     │     Payment System          │
│  ┌──────────────┐  │  ┌───────────────────────┐  │
│  │ order-api    │  │  │ payment-gateway       │  │
│  │ order-worker │──┼──│ payment-processor     │  │
│  │ order-db     │  │  │ payment-ledger        │  │
│  └──────────────┘  │  └───────────────────────┘  │
│   (system lessons) │   (system lessons)          │
└────────────────────┴────────────────────────────┘
```

### Project ID Mapping

| Level | project_id example | What it stores |
|---|---|---|
| Global shared | `platform-shared` | Auth standards, logging conventions, deployment guardrails |
| System | `order-system` | Domain decisions, internal event schemas |
| System | `payment-system` | Domain decisions, compliance rules |
| Integration | `order-payment-integration` | API contracts, retry policies, error mapping |
| Microservice | `order-api`, `order-worker`... | Service-specific workarounds, config quirks |

### CLAUDE.md Template (per repo)

Each repo's `CLAUDE.md` should call `search_lessons` across relevant layers:

```markdown
# CLAUDE.md — order-api (example)
MCP: http://localhost:3000/mcp

## Session Start
1. search_lessons(query: "<task>", project_id: "order-api")
2. search_lessons(query: "<task>", project_id: "order-system")
3. search_lessons(query: "<task>", project_id: "platform-shared")
4. check_guardrails(action_context: {action: "<what>"}, project_id: "order-api")
```

When working on integration code, also search the integration project:
```
search_lessons(query: "<task>", project_id: "order-payment-integration")
```

## TODO — Next Session

1. Define the actual system names and project IDs for the user's repos
2. Create a CLAUDE.md template with multi-layer search_lessons
3. Register workspace roots for each repo
4. Seed shared guardrails in `platform-shared`
5. Seed integration contracts as lessons in integration projects
6. Consider whether `search_lessons` should support querying multiple project_ids in one call (feature enhancement)

## Limitation

- Single auth token (`CONTEXT_HUB_WORKSPACE_TOKEN`) — no per-project auth in MVP
- All projects share the same server instance
