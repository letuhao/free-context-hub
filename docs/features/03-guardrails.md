# Guardrails

Guardrails prevent repeated mistakes by checking team rules **before** a risky
action runs — git push, deploy, schema migration, deleting data.

## Key concepts

- **Guardrails are lessons.** A guardrail is a lesson with `lesson_type:
  "guardrail"`. Capture one with `add_lesson`, and it becomes an enforceable rule.
- **Pre-action check.** Agents call `check_guardrails` with an action context before
  doing something risky. The response is `pass: true|false` plus a prompt to show the
  user when blocked.
- **Group-level checks.** A check can evaluate guardrails across a project group, not
  just one project.
- **Simulate mode.** "What Would Block?" lets you test an action against current
  rules without performing it.
- **Audit.** Every check is recorded (see [Access Control & audit](08-access-control-identity.md)
  and the Agent Audit GUI).

## How to use it

### MCP (agents)

| Tool | Purpose |
|------|---------|
| `check_guardrails` | Evaluate guardrails for a planned action; returns `pass` + prompt |
| `add_lesson` (type `guardrail`) | Define a new rule |

```jsonc
// before pushing
check_guardrails({ action_context: { action: "git push to main" } })
// → { pass: false, prompt: "Run check_guardrails before push; needs approval" }
```

If `pass: false`, **show the prompt to the user and wait for approval** — do not proceed.

### REST

- `GET /api/guardrails/rules` — list active rules
- `POST /api/guardrails/check` — evaluate an action
- `POST /api/guardrails/simulate` — "what would block?" without acting

### GUI

- **Guardrails** (`/guardrails`) — browse active rules, test presets, run simulate
  mode, and review in-session test history.

## When to check

Always run `check_guardrails` before: **git push, deploy, schema migration, deleting
data**, or any action your team has flagged. This is the enforcement half of the
memory loop — lessons capture the rule, guardrails enforce it.

## Related

- [Memory & Lessons](01-memory-lessons.md) — guardrails are a lesson type
- [Governance & Decisions](07-governance-decisions.md) — for approval routing beyond a binary check
