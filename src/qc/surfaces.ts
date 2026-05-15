/**
 * Phase 12 Sprint 12.0 — per-surface retrieval adapters.
 *
 * Four adapters, one uniform contract. The baseline runner treats every
 * surface as `(query) => SurfaceResult`, so metric computation never
 * branches on surface type. Per-call latency is always recorded, even
 * on error, so p95 reflects real-world failure paths.
 *
 * lessons → MCP search_lessons
 * code    → MCP search_code_tiered  (kind=source)
 * chunks  → MCP search_document_chunks
 * global  → REST GET /api/search/global   (no MCP tool; ILIKE-only, not semantic)
 */

import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

import { normalizePath } from './goldenTypes.js';

export type SurfaceItem = {
  /** Normalized key used for duplication-rate calculation. */
  key: string;
  /** Stable id within the surface namespace. */
  id: string;
  title?: string;
  snippet?: string;
  /** Global-surface only: 'lesson'|'document'|'chunk'|'guardrail'|'commit'. */
  type?: string;
};

export type SurfaceResult = {
  items: SurfaceItem[];
  latencyMs: number;
  error?: string;
};

/** Extract a JSON payload from an MCP tool response (handles the text-wrap
 *  dance also used by ragQcRunner / tieredBaseline). */
function extractMcpJson(result: any): any {
  const content = result?.content ?? [];
  const firstText = content.find((c: any) => c?.type === 'text')?.text;
  if (typeof firstText !== 'string') throw new Error('MCP tool result missing text payload');
  const raw = firstText.trim();
  try {
    return JSON.parse(raw);
  } catch {
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    if (s >= 0 && e >= s) return JSON.parse(raw.slice(s, e + 1));
    throw new Error(`Cannot parse JSON from MCP output: ${raw.slice(0, 200)}`);
  }
}

async function callMcp(client: McpClient, name: string, args: Record<string, unknown>, timeoutMs = 60_000): Promise<any> {
  const out = await client.request(
    { method: 'tools/call', params: { name, arguments: args } },
    CallToolResultSchema,
    { timeout: timeoutMs },
  );
  return extractMcpJson(out);
}

export async function callLessons(
  client: McpClient,
  projectId: string,
  query: string,
  k: number,
): Promise<SurfaceResult> {
  const t0 = Date.now();
  try {
    const r = await callMcp(client, 'search_lessons', {
      project_id: projectId,
      query,
      limit: k,
      output_format: 'json_only',
    });
    const matches = Array.isArray(r?.matches) ? r.matches : [];
    const items: SurfaceItem[] = matches.slice(0, k).map((m: any) => ({
      key: String(m.lesson_id ?? '').toLowerCase(),
      id: String(m.lesson_id ?? ''),
      title: m.title,
      snippet: m.content_snippet,
    }));
    return { items, latencyMs: Date.now() - t0 };
  } catch (e: any) {
    return { items: [], latencyMs: Date.now() - t0, error: String(e?.message ?? e) };
  }
}

export async function callCode(
  client: McpClient,
  projectId: string,
  query: string,
  k: number,
): Promise<SurfaceResult> {
  const t0 = Date.now();
  try {
    const r = await callMcp(client, 'search_code_tiered', {
      project_id: projectId,
      query,
      kind: 'source',
      max_files: k,
      output_format: 'json_only',
    });
    const files = Array.isArray(r?.files) ? r.files : [];
    const items: SurfaceItem[] = files.slice(0, k).map((f: any) => {
      const p = normalizePath(String(f.path ?? ''));
      // Sprint 12.0.1 HIGH-1 fix: search_code_tiered returns `sample_lines`
      // (an array of code snippets from the matched file), NOT a single
      // `snippet` field. Populate title=path and snippet=joined sample
      // lines so nearSemanticKey has real content to key on. Without
      // this, every code item has (title=undefined, snippet=undefined),
      // nearSemanticKey → "||" for every item, and dup@10 nearsem
      // reports a spurious 1.0 across all code queries.
      const sampleLines = Array.isArray(f.sample_lines) ? f.sample_lines.join(' ') : '';
      return { key: p, id: p, title: p, snippet: sampleLines || undefined };
    });
    return { items, latencyMs: Date.now() - t0 };
  } catch (e: any) {
    return { items: [], latencyMs: Date.now() - t0, error: String(e?.message ?? e) };
  }
}

export async function callChunks(
  client: McpClient,
  projectId: string,
  query: string,
  k: number,
): Promise<SurfaceResult> {
  const t0 = Date.now();
  try {
    const r = await callMcp(client, 'search_document_chunks', {
      project_id: projectId,
      query,
      limit: k,
      output_format: 'json_only',
    });
    const matches = Array.isArray(r?.matches) ? r.matches : [];
    const items: SurfaceItem[] = matches.slice(0, k).map((m: any) => ({
      key: String(m.chunk_id ?? ''),
      id: String(m.chunk_id ?? ''),
      title: m.doc_name ? `${m.doc_name}${m.heading ? ' / ' + m.heading : ''}` : undefined,
      snippet: m.content_snippet,
    }));
    return { items, latencyMs: Date.now() - t0 };
  } catch (e: any) {
    return { items: [], latencyMs: Date.now() - t0, error: String(e?.message ?? e) };
  }
}

export async function callGlobal(
  apiUrl: string,
  projectId: string,
  query: string,
  k: number,
): Promise<SurfaceResult> {
  const t0 = Date.now();
  try {
    const base = apiUrl.replace(/\/$/, '');
    // limitPerGroup caps each of the 5 groups; total items up to 5*k. We then
    // interleave-merge to form a single ranked list, capped at k for the
    // runner's benefit. Interleaving preserves per-group ordering from the
    // server, which is the closest we can get to a unified rank (global
    // surface has no cross-group score at REST level).
    const limit = Math.min(k, 10);
    const url = `${base}/api/search/global?project_id=${encodeURIComponent(projectId)}&q=${encodeURIComponent(query)}&limit=${limit}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 30_000);
    let res: Response;
    try {
      res = await fetch(url, { signal: ac.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      return { items: [], latencyMs: Date.now() - t0, error: `HTTP ${res.status}` };
    }
    const r = (await res.json()) as any;

    const lessons = (r?.lessons ?? []).map((x: any) => ({
      type: 'lesson',
      key: `lesson:${String(x.lesson_id).toLowerCase()}`,
      id: String(x.lesson_id),
      title: x.title,
      snippet: x.snippet,
    }));
    const docs = (r?.documents ?? []).map((x: any) => ({
      type: 'document',
      key: `document:${String(x.doc_id).toLowerCase()}`,
      id: String(x.doc_id),
      title: x.name,
      snippet: x.snippet,
    }));
    const chunks = (r?.chunks ?? []).map((x: any) => ({
      type: 'chunk',
      key: `chunk:${String(x.chunk_id).toLowerCase()}`,
      id: String(x.chunk_id),
      title: x.doc_name + (x.heading ? ' / ' + x.heading : ''),
      snippet: x.snippet,
    }));
    const guardrails = (r?.guardrails ?? []).map((x: any) => ({
      type: 'guardrail',
      key: `guardrail:${String(x.lesson_id).toLowerCase()}`,
      id: String(x.lesson_id),
      title: x.title,
    }));
    const commits = (r?.commits ?? []).map((x: any) => ({
      type: 'commit',
      key: `commit:${String(x.sha)}`,
      id: String(x.sha),
      title: x.message,
    }));

    // Interleave groups in priority order so surface ranking has *some* meaning.
    const groups = [lessons, docs, chunks, guardrails, commits];
    const merged: SurfaceItem[] = [];
    const maxLen = Math.max(...groups.map((g) => g.length), 0);
    for (let i = 0; i < maxLen && merged.length < k; i++) {
      for (const g of groups) {
        if (i < g.length && merged.length < k) merged.push(g[i]);
      }
    }
    return { items: merged, latencyMs: Date.now() - t0 };
  } catch (e: any) {
    return { items: [], latencyMs: Date.now() - t0, error: String(e?.message ?? e) };
  }
}
