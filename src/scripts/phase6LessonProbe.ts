/**
 * Optional Phase 6 step: add_lesson, then search_lessons + search_code via MCP (coder-agent smoke).
 * Facts live in lesson embeddings — use search_lessons to verify; search_code only hits code chunks.
 *
 *   QC_PROJECT_ID=phase6-qc-free-context-hub MCP_SERVER_URL=http://localhost:3000/mcp npm run verify:phase6:lesson-probe
 */
import * as dotenv from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

dotenv.config();

function extractJson(result: unknown) {
  const content = (result as { content?: Array<{ type?: string; text?: string }> })?.content ?? [];
  const firstText = content.find(c => c?.type === 'text')?.text;
  if (typeof firstText !== 'string') throw new Error('Tool result missing text payload');
  const raw = firstText.trim();
  try {
    return JSON.parse(raw);
  } catch {
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    if (s >= 0 && e >= s) return JSON.parse(raw.slice(s, e + 1));
    throw new Error(`Cannot parse json: ${raw.slice(0, 200)}`);
  }
}

async function callTool(client: Client, name: string, args: Record<string, unknown>) {
  const out = await client.request(
    { method: 'tools/call', params: { name, arguments: args } },
    CallToolResultSchema,
  );
  return extractJson(out);
}

async function main() {
  const token = process.env.CONTEXT_HUB_WORKSPACE_TOKEN;
  const tokenArgs = token && token.trim().length ? { workspace_token: token } : {};
  const serverUrl = process.env.MCP_SERVER_URL ?? 'http://localhost:3000/mcp';
  const projectId = process.env.QC_PROJECT_ID?.trim() || 'phase6-qc-free-context-hub';

  const client = new Client({ name: 'phase6-lesson-probe', version: '0.1.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {});
  await client.connect(transport);

  const factTitle = 'RAG QC verify probe fact';
  const factBody =
    'For RAG/QC verification: the canonical probe token is RAG_QC_PROBE_TOKEN_z9x8.';
  const lesson = await callTool(client, 'add_lesson', {
    ...tokenArgs,
    // project_id must live inside lesson_payload (MCP schema has no top-level project_id for add_lesson).
    lesson_payload: {
      project_id: projectId,
      lesson_type: 'general_note',
      title: factTitle,
      content: factBody,
      tags: ['phase6', 'probe'],
      source_refs: ['docs/phase6-verification.md'],
    },
    output_format: 'json_only',
  });
  console.log('[phase6-lesson-probe] add_lesson:', JSON.stringify(lesson).slice(0, 500));

  const q = 'What is RAG_QC_PROBE_TOKEN_z9x8 used for?';
  const lessons = await callTool(client, 'search_lessons', {
    ...tokenArgs,
    project_id: projectId,
    query: q,
    limit: 5,
    output_format: 'json_only',
  });
  console.log('[phase6-lesson-probe] search_lessons matches:', JSON.stringify(lessons).slice(0, 2000));

  const matches = (lessons as { matches?: Array<{ content_snippet?: string }> })?.matches ?? [];
  const hit = matches.some(m => String(m?.content_snippet ?? '').includes('RAG_QC_PROBE_TOKEN_z9x8'));
  if (!hit && matches.length === 0) {
    console.warn(
      '[phase6-lesson-probe] WARN: no lesson matches yet (embedding/index may lag); retry in a few seconds.',
    );
  } else if (!hit) {
    console.warn('[phase6-lesson-probe] WARN: probe token not in top snippets; check semantic match.');
  } else {
    console.log('[phase6-lesson-probe] OK: probe token found in search_lessons results.');
  }

  const code = await callTool(client, 'search_code', {
    ...tokenArgs,
    project_id: projectId,
    query: q,
    limit: 5,
    output_format: 'json_only',
  });
  console.log('[phase6-lesson-probe] search_code matches (optional; often empty for lesson-only facts):', JSON.stringify(code).slice(0, 800));
}

main().catch(err => {
  console.error('[phase6-lesson-probe]', err instanceof Error ? err.message : err);
  process.exit(1);
});
