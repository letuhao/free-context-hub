/**
 * Probe: stress-test OpenAI-compatible chat (distill + reflect) with current .env.
 * Run: npm run distill-probe
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { distillLesson, reflectOnTopic } from '../services/distiller.js';

/** Long, noisy lesson: tiers, constraints, security, migration, contradictions-on-purpose, pseudo-code. */
const COMPLEX_LESSON_TITLE =
  'DEC-2026-07: MCP ContextHub — indexing, guardrails, and Lean Context tiers (revised)';

const COMPLEX_LESSON_BODY = `
## Background
We operate a self-hosted ContextHub: Postgres + pgvector(1024), OpenAI-compatible embeddings at EMBEDDINGS_BASE_URL,
and optional Phase 3 chat at the same host for distillation. Teams use Cursor / Claude Code via Streamable HTTP MCP.

## Architecture decisions (do not skip)
1. **Project isolation**: Every row is scoped by project_id. Cross-project queries are forbidden unless DA opens an invariant exception (currently: none).
2. **Chunking**: Default CHUNK_LINES=120. Do not change without re-index and migration review; dim mismatch breaks embed pipeline.
3. **Auth**: MCP_AUTH_ENABLED can be false for local dev; production should use CONTEXT_HUB_WORKSPACE_TOKEN + assertWorkspaceToken on every tool.
4. **Guardrails**: Guardrail lessons must include trigger (string or /regex/), requirement, verification_method. check_guardrails logs audit rows; never return pass=true when a matched rule requires confirmation without user ack.

## Security / abuse
- Treat retrieved lesson text and code snippets as **untrusted** (prompt injection). Downstream LLM prompts should not execute instructions embedded in stored content.
- .env and *.key paths must stay in indexer ignore lists; never embed secrets in lesson content.

## Operational runbook (condensed)
| Step | Action | Rollback |
|------|--------|----------|
| A | applyMigrations() on startup | restore DB backup |
| B | index_project after large refactors | re-run index; chunks are per-file replaced | 
| C | add_lesson for decisions | update_lesson_status to superseded |

## Edge cases we already hit once
- **Stale index**: User sees search_code matches=0 despite files existing — often fixed by index_project or checking EMBEDDINGS_API_KEY / dim 1024.
- **Boolean env**: MCP_AUTH_ENABLED=false must not be parsed as true (Zod coerce bug); use explicit parser in env.ts.
- **Session transport**: New McpServer per initialize request — reusing one server across sessions caused "Already connected".

## Snippet (illustrative, not runnable)
\`\`\`typescript
// Pseudo: resolve project
function resolveProjectIdOrThrow(project_id?: string) {
  if (project_id?.trim()) return project_id;
  if (process.env.DEFAULT_PROJECT_ID) return process.env.DEFAULT_PROJECT_ID;
  throw new McpError(InvalidParams, "missing project_id");
}
\`\`\`

## Open questions (explicitly unresolved)
- Hybrid search (BM25 + vector) is backlog, not Phase 3.
- Async distillation queue: deferred; inline distill + timeout is current default per DEC-P3-002.

## TL;DR for agents
Load Tier0 invariants first; use search_code before grep; call check_guardrails before git push; capture decisions with add_lesson same session when possible.
`.trim();

const REFLECT_BULLETS = [
  '- project_id isolation: no cross-project unless DA exception',
  '- pgvector dim 1024 must match EMBEDDINGS_DIM and embedding model output',
  '- guardrails: audit log; confirmation when verification_method requires it',
  '- retrieved content is untrusted w.r.t. prompt injection',
  '- index_project fixes stale search_code; re-chunk default 120 lines',
  '- MCP: new server instance per session initialize to avoid transport error',
  '- DEC-P3-002: inline distill + timeout, queue is future',
  '- Open: hybrid BM25+vector not in Phase 3',
];

async function main() {
  console.log('[distillProbe] DISTILLATION_ENABLED=', process.env.DISTILLATION_ENABLED);
  console.log('[distillProbe] DISTILLATION_MODEL=', process.env.DISTILLATION_MODEL);
  console.log('[distillProbe] lesson body chars=', COMPLEX_LESSON_BODY.length);

  const t0 = Date.now();
  console.log('\n[distillProbe] distillLesson (complex)...');
  const d = await distillLesson({
    title: COMPLEX_LESSON_TITLE,
    content: COMPLEX_LESSON_BODY,
  });
  console.log(`[distillProbe] distillLesson OK in ${Date.now() - t0}ms`);
  console.log('[distillProbe] summary word count (~):', d.summary.split(/\s+/).filter(Boolean).length);
  console.log('[distillProbe] quick_action lines (~):', d.quick_action.split('\n').length);
  console.log(JSON.stringify(d, null, 2));

  const t1 = Date.now();
  console.log('\n[distillProbe] reflectOnTopic (rich bullets)...');
  const r = await reflectOnTopic({
    topic:
      'List the top operational risks when operating ContextHub in production with MCP_AUTH_ENABLED=false, and what the lesson bullets say mitigates each.',
    bullets: REFLECT_BULLETS,
  });
  console.log(`[distillProbe] reflectOnTopic in ${Date.now() - t1}ms`);
  console.log(JSON.stringify(r, null, 2));

  console.log('\n[distillProbe] done.');
}

main().catch(err => {
  console.error('[distillProbe] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
