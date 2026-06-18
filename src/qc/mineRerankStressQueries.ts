/**
 * Mine "rerank-stress" candidate golden queries (M1 headroom mining + M4 diversity).
 *
 * For a deterministic sample of lessons, an LLM (gemma, reasoning off) writes ONE
 * *indirect* question whose answer is that lesson. We then run RAW retrieval
 * (the MCP server MUST be in no-rerank mode) and record the rank of the source
 * lesson. Queries where the target lands at rank 4..20 form the HEADROOM band —
 * the only band where a reranker can actually act. The reranker under test never
 * participates in selection or labeling → non-circular (see
 * docs/specs/2026-06-16-rerank-stress-goldenset-methodology.md).
 *
 * PREREQ: run the MCP server in no-rerank mode so callLessons returns raw order:
 *   RERANK_TYPE=generative DISTILLATION_ENABLED=false docker compose up -d mcp
 *
 * Run:
 *   STRESS_SAMPLE=80 npx tsx src/qc/mineRerankStressQueries.ts
 * Output: qc/lessons-stress-candidates.json  (candidates — REQUIRE human review)
 */
import * as dotenv from 'dotenv';
import { writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getDbPool } from '../db/client.js';
import { callLessons } from './surfaces.js';
import { embedTexts } from '../services/embedder.js';
import { resolveGenModel } from '../env.js';

dotenv.config();

const MCP_URL = process.env.MCP_SERVER_URL?.trim() || 'http://localhost:3000/mcp';
const GEN_URL = (process.env.GEN_BASE_URL?.trim() || 'http://localhost:1234').replace(/\/$/, '');
const GEN_KEY = process.env.GEN_API_KEY ?? '';
// Single source of truth: GEN_MODEL override, else the canonical chat model.
const GEN_MODEL = resolveGenModel() ?? 'google/gemma-4-26b-a4b-qat';
const PID = process.env.QC_PROJECT_ID?.trim() || 'free-context-hub';
const SAMPLE = Number(process.env.STRESS_SAMPLE ?? '80');
const POOL_K = 20;                 // candidate pool depth
const DIVERSITY_MAX_COS = 0.93;    // drop a query too similar to an already-kept one

type LessonRow = { lesson_id: string; title: string; content: string; quick_action: string | null; lesson_type: string };

/** Generate ONE indirect question whose answer is this lesson. */
async function genIndirectQuery(row: LessonRow): Promise<string | null> {
  const system =
    'You write ONE hard search query for an internal engineering knowledge base. Output ONLY the ' +
    'question text, no quotes, no preamble. Rules: (1) the answer must be the GIVEN lesson; ' +
    '(2) describe ONLY the observable SYMPTOM or end-goal a confused developer would see/want — ' +
    'as if they do NOT yet know the cause; (3) do NOT name any function, file, table, env var, ' +
    'technology, or distinctive technical noun that appears in the lesson (force semantic, not ' +
    'lexical, matching); (4) <= 16 words.';
  const user =
    `LESSON TITLE: ${row.title}\n\nLESSON CONTENT (excerpt):\n${row.content.slice(0, 1200)}\n\n` +
    `${row.quick_action ? `QUICK ACTION: ${row.quick_action}\n\n` : ''}Write the indirect question.`;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 30000);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (GEN_KEY) headers.Authorization = `Bearer ${GEN_KEY}`;
    const res = await fetch(`${GEN_URL}/v1/chat/completions`, {
      method: 'POST', headers, signal: ac.signal,
      body: JSON.stringify({
        model: GEN_MODEL,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.4,
        max_tokens: 120,
        reasoning_effort: 'none',
        chat_template_kwargs: { enable_thinking: false },
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const msg = json?.choices?.[0]?.message ?? {};
    let q = String(msg.content ?? '').trim() || String(msg.reasoning_content ?? '').trim();
    q = q.replace(/^["'`]|["'`]$/g, '').replace(/\s+/g, ' ').trim();
    // Strip any leading "Question:" style prefixes.
    q = q.replace(/^(question|query)\s*[:\-]\s*/i, '').trim();
    return q.length >= 8 ? q : null;
  } catch { return null; }
  finally { clearTimeout(t); }
}

function rankOf(items: Array<{ id: string }>, targetId: string): number {
  const idx = items.findIndex(it => (it.id || '').toLowerCase() === targetId.toLowerCase());
  return idx < 0 ? -1 : idx + 1; // 1-based; -1 = absent from pool
}

function band(rank: number): 'easy' | 'headroom' | 'ceiling' {
  if (rank >= 1 && rank <= 3) return 'easy';
  if (rank >= 4 && rank <= POOL_K) return 'headroom';
  return 'ceiling'; // -1 (absent) or > POOL_K
}

/** A couple of distinctive lowercase tokens from the title (metadata only, NOT used for labeling). */
function keywordsFrom(title: string): string[] {
  return Array.from(new Set(
    title.toLowerCase().match(/[a-z_][a-z0-9_]{3,}/g) ?? [],
  )).filter(w => !['with', 'when', 'must', 'this', 'that', 'from', 'into', 'lesson'].includes(w)).slice(0, 3);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d > 0 ? dot / d : 0;
}

async function main() {
  const pool = getDbPool();
  const { rows } = await pool.query<LessonRow>(
    `SELECT lesson_id::text, title, content, quick_action, lesson_type
       FROM lessons
      WHERE project_id = $1 AND status = 'active' AND length(content) > 200
      ORDER BY md5(lesson_id::text)
      LIMIT $2`,
    [PID, SAMPLE],
  );
  console.log(`[mine] sampled ${rows.length} lessons from project=${PID}`);

  const client = new Client({ name: 'rerank-stress-miner', version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), {}));

  const candidates: any[] = [];
  const dist = { easy: 0, headroom: 0, ceiling: 0, genFail: 0 };
  const keptEmbeddings: number[][] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const q = await genIndirectQuery(row);
    if (!q) { dist.genFail++; continue; }
    const r = await callLessons(client, PID, q, POOL_K);
    const rank = rankOf(r.items, row.lesson_id);
    const b = band(rank);
    dist[b]++;
    process.stdout.write(`  [${i + 1}/${rows.length}] rank=${rank === -1 ? 'absent' : rank} ${b}  «${q.slice(0, 60)}»\n`);

    if (b !== 'headroom') continue; // keep only the headroom band

    // M4 diversity gate (best-effort; skip if embeddings unavailable)
    try {
      const [emb] = await embedTexts([q]);
      const tooSimilar = keptEmbeddings.some(e => cosine(e, emb) > DIVERSITY_MAX_COS);
      if (tooSimilar) { process.stdout.write('       ↳ dropped (near-duplicate query)\n'); continue; }
      keptEmbeddings.push(emb);
    } catch { /* embeddings down — keep without diversity gate */ }

    candidates.push({
      id: `lesson-stress-${row.lesson_id.slice(0, 8)}`,
      group: 'rerank-stress-headroom',
      query: q,
      target_lesson_ids: [row.lesson_id],
      must_keywords: keywordsFrom(row.title),
      answer_category: 'standard',
      drafted_by: 'llm',
      // reviewed_by intentionally absent — REQUIRES human review before ship.
      _raw_rank: rank,                 // provenance: rank under no-rerank retrieval
      _source_title: row.title,        // for the reviewer to sanity-check the label
      _lesson_type: row.lesson_type,
    });
  }

  await client.close();

  const out = {
    surface: 'lessons',
    project_id_suggested: PID,
    version: '2026-06-16-rerank-stress-candidates',
    note: 'CANDIDATES from M1 headroom mining. REQUIRE human review (set reviewed_by, fix/drop bad labels) before merging into qc/lessons-queries.json. _raw_rank/_source_title are provenance fields to strip on merge.',
    queries: candidates,
  };
  await writeFile('qc/lessons-stress-candidates.json', JSON.stringify(out, null, 2));

  console.log('\n[mine] distribution:', JSON.stringify(dist));
  console.log(`[mine] kept ${candidates.length} headroom candidates → qc/lessons-stress-candidates.json`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
