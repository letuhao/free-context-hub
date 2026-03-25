---
id: CH-M05  status: done  phase: MVP  depends-on: M04, M01  updated: 2026-03-25
---

# Module Brief: M05 — Guardrails Engine

## Outcome
Translates guardrail-type lessons into pre-action checks. Enforces workflow
rules before risky MCP tool calls. Always auditable, never silent.

## Scope
IN: Guardrail rule evaluation, `needs_confirmation` responses, audit logging,
    trigger matching against action_context, verification_method execution
OUT: Arbitrary shell command execution, CI integration (post-MVP), ML risk scoring

## Acceptance
- [ ] AT-M05-01: `check_guardrails({action: "git push"})` triggers matching rules
- [ ] AT-M05-02: No matching rule → `{pass: true, rules_checked: 0}` (never error)
- [ ] AT-M05-03: Failed check → `{pass: false, needs_confirmation: true, prompt: "..."}`
- [ ] AT-M05-04: Every evaluation is audit-logged: `{rule_id, action, inputs, decision, timestamp}`
- [ ] AT-M05-05: No guardrail ever executes arbitrary shell commands (security invariant)
- [ ] AT-M05-06: Guardrail prompt text comes from lesson content — not from unvalidated input

## Guardrail Rule Shape
```
trigger:              "git push" | "deploy" | regex pattern against action_context.action
requirement:          human-readable condition (e.g., "Tests must have run")
verification_method:  "recorded_test_event" | "user_confirmation" | "cli_exit_code"
```

## Example Enforcement Flow
```
MCP client: check_guardrails({action: "git push", workspace: "proj-x"})
  → load guardrail rules for "proj-x" from M04
  → match trigger "git push"
  → verification_method: "recorded_test_event"
  → no recent test event found
  → return {pass: false, needs_confirmation: true,
            prompt: "Run tests locally or confirm you want to proceed anyway"}
  → audit log: {rule: "no-push-without-tests", decision: "blocked", ...}
```

## Sub-phases
| SP | Scope | Status |
|---|---|---|
| SP-1 | Rule loading from M04 guardrail store | done |
| SP-2 | Trigger matching logic (exact string + `/regex/` form) | done |
| SP-3 | Verification check + `needs_confirmation` response | done |
| SP-4 | Audit log write (`guardrail_audit_logs` table, all decisions) | done |

## Known Issues (post-MVP)
- `rules_checked` returns `0` when rules exist but none match trigger — misleading for clients trying to debug. Correct value should be `checked.length`. Low priority (no AT violated, but UX issue).

## Risks (closed)
- R-M05-01: Trigger patterns too broad → mitigated by exact-match default, regex opt-in
- R-M05-02: Prompt injection — prompt text is from `requirement` field (lesson content, not user input at call time)

## Recent Decisions
- MVP: `needsConfirmation = true` always when any rule is matched (simplest safe default) [2026-03-25]
