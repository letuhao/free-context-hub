# User Guide

A task-oriented walkthrough of **free-context-hub** for both audiences it serves:
**humans** (through the web GUI) and **AI agents** (through the MCP server). For a map
of every feature see [`FEATURES.md`](../FEATURES.md); for per-area detail see
[`docs/features/`](features/README.md).

---

## 1. The mental model

free-context-hub gives AI coding agents **persistent memory** and **guardrails**, with
a **human-in-the-loop** GUI to review what they store.

- **Agents** connect over MCP and call tools (`add_lesson`, `search_lessons`,
  `check_guardrails`, …).
- **Humans** open the GUI to review, approve, edit, and analyze that knowledge.
- Everything lives under a **project** (tenant) and is **searchable** (semantic +
  lexical).

```
Agent stores a decision ──▶ Human reviews/approves ──▶ Next agent retrieves it
        (MCP)                      (GUI)                        (MCP)
```

---

## 2. Getting started

### 2.1 Run the stack

See [QUICKSTART.md](QUICKSTART.md) for the full setup. In short:

```bash
git clone https://github.com/letuhao/free-context-hub.git
cd free-context-hub && npm install
cp .env.example .env          # set DATABASE_URL and EMBEDDINGS_BASE_URL
docker compose up -d          # Postgres (+ optional services)
npm run dev                   # MCP :3000 + REST :3001
npm run smoke-test            # verify
cd gui && npm install && npm run dev   # GUI :3002
```

Open the GUI at **http://localhost:3002**. New here? Start at the in-app
**Feature Guide** (`/guide`) and the **Getting Started** learning path
(`/getting-started`).

### 2.2 Connect an AI tool

Point your agent's MCP settings at:

```
http://localhost:3002/mcp     # single-port gateway (recommended)
```

Then, at the start of an agent session, do two things:

1. `search_lessons(query: "<your task intent>")` — load prior decisions.
2. `check_guardrails(action_context: { action: "<what you plan to do>" })` — if doing
   anything risky.

---

## 3. For humans (GUI)

### "I want to review what agents stored"
Open **Review Inbox** (`/review`). AI-generated lessons land in `pending-review`;
approve, edit, or return them. Approved lessons become retrievable by every agent.

### "I want to find a past decision"
Use **Lessons** (`/lessons`) with search/filter, or **Cmd+K** global search anywhere.
Open a lesson to see content, comments, and version history.

### "I want to add a team rule that blocks risky actions"
Create a lesson of type **guardrail** (in `/lessons`), or use **Guardrails**
(`/guardrails`) to test what a rule would block before relying on it.

### "I want to bring in external knowledge"
Use **Documents** (`/documents`) to upload PDFs/DOCX/images or ingest a URL. The
system extracts, chunks, and indexes it, and can generate lessons from it.

### "I want to see how knowledge is being used"
**Analytics** (`/analytics`) shows retrieval trends, approval rates, and dead
knowledge. **Activity** (`/activity`) is the unified event timeline. **Agent Audit**
(`/agents`) shows what each agent has done.

### "I want to manage access"
**Access Control** (`/settings/access`) for API keys and roles; **Sessions**
(`/settings/sessions`) to revoke logins; **Access Review**
(`/governance/access-review`) for credential rotation.

### "I want to move a project's knowledge"
**Project Settings** (`/projects/settings`) → Knowledge Exchange: export a bundle,
import one (with conflict policy + dry-run), or pull from another instance.

---

## 4. For agents (MCP)

### Session start (do these two)
```jsonc
search_lessons({ query: "<task intent>" })
check_guardrails({ action_context: { action: "<plan>" } })
```

### Capture a decision
```jsonc
add_lesson({
  lesson_payload: {
    project_id: "free-context-hub",
    lesson_type: "decision",
    title: "Use JWT not sessions",
    content: "Legal requires stateless auth; standardize on JWT.",
    tags: ["auth", "architecture"]
  }
})
```

### Before a risky action
```jsonc
check_guardrails({ action_context: { action: "git push to main" } })
// pass:false → show the prompt to the user and wait for approval
```

### Find code / tests / docs
```jsonc
search_code_tiered({ query: "rate limiter", kind: "code" })  // or kind: "test" | "doc"
```

### Knowing what you can do
- `help(output_format: "json_pretty")` — full, always-current tool reference.
- `whoami` — your authenticated principal and scope.
- `get_context` / `get_project_summary` — bootstrap a session.

> **Rule of thumb:** use MCP for *knowledge* (lessons, guardrails, docs) and your
> built-in Grep/Glob for plain *code navigation*.

---

## 5. Multi-agent coordination (advanced)

When several agents share a project, use the coordination and governance primitives
to avoid collisions and record collective decisions:

- **Claim before you work**: `claim_artifact` / `claim_task` (fencing-tokened leases).
- **Organize an initiative**: `charter_topic` → `join_topic` → `post_task` → board.
- **Decide as a group**: `submit_request` (approval routing) or `propose_motion` →
  `cast_vote` → `tally_motion`.
- **Raise an issue**: `submit_intake` → `triage_intake`; or `open_dispute`.

See [features/06-coordination.md](features/06-coordination.md) and
[features/07-governance-decisions.md](features/07-governance-decisions.md).

---

## 6. Where to go next

- **Feature map:** [`FEATURES.md`](../FEATURES.md)
- **Per-area detail:** [`docs/features/`](features/README.md)
- **Setup & config:** [`docs/QUICKSTART.md`](QUICKSTART.md)
- **The bigger picture:** [`ROADMAP.md`](../ROADMAP.md), [`WHITEPAPER.md`](../WHITEPAPER.md)
- **Contributing:** [`CONTRIBUTING.md`](../CONTRIBUTING.md)
