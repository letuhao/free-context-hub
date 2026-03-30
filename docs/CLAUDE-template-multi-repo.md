# CLAUDE.md Template for Multi-Repo Projects

Use this template for repos that share knowledge via project groups.

---

```markdown
# CLAUDE.md — [repo-name]

## Project
[description of this repo]
MCP: `http://localhost:3000/mcp` | project_id: `[repo-name]`

## Session Start
1. `search_lessons(query: "<your task intent>", project_id: "[repo-name]", include_groups: true)` — loads lessons from this repo + all groups it belongs to
2. `check_guardrails(action_context: {action: "<what you plan to do>"}, project_id: "[repo-name]", include_groups: true)` — checks guardrails from this repo + shared group rules

That's it. `include_groups: true` automatically includes knowledge from all groups this project belongs to.

## After Making Decisions
Call `add_lesson` with:
- `project_id: "[repo-name]"` for repo-specific knowledge
- `project_id: "[group-id]"` for shared knowledge (e.g. API contracts, integration rules)

## Before Risky Actions
Always `check_guardrails` before: git push, deploy, schema migration, delete data.
If `pass: false` → show prompt to user and wait for approval.
```

---

## How Groups Work

Groups are many-to-many. A project can belong to multiple groups:

```
Group: "backend-shared" (all backend services)
  └── order-api, payment-gateway, inventory-api

Group: "order-payment-integration" (shared API contracts)
  └── order-api, payment-gateway
```

When `order-api` calls `search_lessons(include_groups: true)`, it searches:
1. `order-api` — its own lessons
2. `backend-shared` — shared backend guardrails
3. `order-payment-integration` — payment integration contracts

## Setup

```bash
# 1. Create groups and add members
npx tsx src/scripts/seedProjectGroups.ts docs/example-group-seed.json

# 2. Copy this template to each repo's .claude/CLAUDE.md
# 3. Replace [repo-name] and [group-id] with actual values
```
