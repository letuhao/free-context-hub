# Feature documentation

Detailed, per-area documentation for **free-context-hub**. This folder is the
"detail" layer; the one-page map lives in [`FEATURES.md`](../../FEATURES.md) at the
repo root, and the task-oriented walkthrough lives in
[`../USER_GUIDE.md`](../USER_GUIDE.md).

Each area doc follows the same shape: **what it is → key concepts → how to use it
(MCP / REST / GUI) → examples → configuration**.

| # | Area | Doc |
|---|------|-----|
| 1 | Memory & Lessons | [01-memory-lessons.md](01-memory-lessons.md) |
| 2 | Search & Retrieval | [02-search-retrieval.md](02-search-retrieval.md) |
| 3 | Guardrails | [03-guardrails.md](03-guardrails.md) |
| 4 | Code Intelligence | [04-code-intelligence.md](04-code-intelligence.md) |
| 5 | Documents & Ingestion | [05-documents-ingestion.md](05-documents-ingestion.md) |
| 6 | Coordination | [06-coordination.md](06-coordination.md) |
| 7 | Governance & Decisions | [07-governance-decisions.md](07-governance-decisions.md) |
| 8 | Access Control & Identity | [08-access-control-identity.md](08-access-control-identity.md) |
| 9 | Projects & Portability | [09-projects-portability.md](09-projects-portability.md) |
| 10 | Human-in-the-Loop GUI | [10-gui.md](10-gui.md) |
| 11 | Jobs & Operations | [11-jobs-operations.md](11-jobs-operations.md) |

**How to reach each feature:** features are exposed through up to three surfaces —
the **MCP** server (for AI agents), the **REST API** (for integrations and the GUI),
and the **GUI** (for humans). Not every feature is on every surface; each doc states
which apply.
