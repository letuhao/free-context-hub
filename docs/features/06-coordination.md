# Coordination

When multiple agents (and humans) work the same project, coordination primitives
stop them from colliding, duplicating work, or losing track of who owns what. This
is the operational half of the **multi-actor** model.

## Key concepts

- **Topic** — a bounded collaborative initiative with a durable, append-only **event
  log** and a participant roster. Actors join a topic, receive an induction pack, and
  can replay the log to re-enter context.
- **Board** — a topic's task list. Each task produces an **artifact**. Tasks are
  claimed with a time-bounded, **fencing-tokened** lease so only one actor writes at
  a time.
- **Artifact versions & baselines** — writing an artifact requires a live claim and
  a valid fencing token; checkpoints can be **baselined** (draft → working →
  baselined).
- **Artifact leasing** — beyond the board, any artifact can be leased to prevent two
  agents doing the same work. Leases have a TTL, can be renewed (capped), and are
  swept when abandoned.

## How to use it

### MCP (agents)

**Topics**

| Tool | Purpose |
|------|---------|
| `charter_topic` | Create a new coordination topic |
| `join_topic` | Join (auto-register + induction pack) |
| `get_topic` | Topic record + participant roster |
| `grant_level` | Raise/lower a participant's level |
| `close_topic` | Close the topic and seal the event log |
| `replay_topic_events` | Replay the log from a cursor (re-entry) |

**Board**

| Tool | Purpose |
|------|---------|
| `post_task` | Post a task (creates task + output artifact) |
| `list_board` | List all tasks + artifact ids |
| `claim_task` / `release_task` / `complete_task` | Lease lifecycle |
| `write_artifact` | Write a new artifact version (needs claim + fencing token) |
| `baseline_artifact` | Mark an artifact checkpoint |

**Artifact leasing**

| Tool | Purpose |
|------|---------|
| `claim_artifact` / `release_artifact` / `renew_artifact` | Exclusive lease lifecycle |
| `list_active_claims` | All active leases in a project |
| `check_artifact_availability` | Is an artifact currently leased? |

### REST

- `/api/topics`, `/api/topics/:id/tasks`, `GET /api/topics/:id/events`
- `/api/projects/:id/artifact-leases`

### GUI

Coordination is primarily an **agent-facing** protocol; there is no dedicated GUI
board in this release. Activity surfaces in the [Activity timeline](10-gui.md) and
[Jobs](11-jobs-operations.md).

## Related

- [Governance & Decisions](07-governance-decisions.md) — approvals, motions, disputes layered on topics
- [Access Control & Identity](08-access-control-identity.md) — actors are principals with scope
