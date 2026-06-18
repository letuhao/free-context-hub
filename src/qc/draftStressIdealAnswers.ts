/**
 * Draft ideal_answer + must_contain_facts for the rerank-stress candidates so
 * the hard band can be scored by ragas (gen-eval). The answer is grounded in the
 * SOURCE lesson (the labeled target), independent of the reranker under test.
 *
 * Output: qc/lessons-stress-geneval.json (full golden format). LLM-drafted →
 * needs human review before being treated as a shipped golden set; for the A/B
 * measurement it is sufficient that the answer is grounded in the source lesson.
 *
 * Run:
 *   DATABASE_URL=postgresql://contexthub:contexthub@localhost:5432/contexthub \
 *   GEN_BASE_URL=http://localhost:1234 GEN_MODEL=google/gemma-4-26b-a4b-qat \
 *   npx tsx src/qc/draftStressIdealAnswers.ts
 */
import * as dotenv from 'dotenv';
import { readFile, writeFile } from 'node:fs/promises';
import { getDbPool } from '../db/client.js';
import { resolveGenModel } from '../env.js';

dotenv.config();

const GEN_URL = (process.env.GEN_BASE_URL?.trim() || 'http://localhost:1234').replace(/\/$/, '');
const GEN_KEY = process.env.GEN_API_KEY ?? '';
// Single source of truth: GEN_MODEL override, else the canonical chat model.
const GEN_MODEL = resolveGenModel() ?? 'google/gemma-4-26b-a4b-qat';

type Cand = { id: string; query: string; target_lesson_ids: string[]; must_keywords?: string[] };

async function draft(query: string, lesson: { title: string; content: string; quick_action: string | null }) {
  const system =
    'You produce a gold reference answer for a RAG evaluation. Output ONLY valid JSON with keys ' +
    '"ideal_answer" (<= 90 words, a direct factual answer to the QUESTION, grounded ONLY in the ' +
    'given LESSON) and "must_contain_facts" (3-5 short atomic claims the answer must contain). ' +
    'No markdown, parseable JSON only.';
  const user =
    `QUESTION:\n${query}\n\nLESSON TITLE: ${lesson.title}\n\nLESSON CONTENT:\n${lesson.content.slice(0, 1500)}\n\n` +
    `${lesson.quick_action ? `QUICK ACTION: ${lesson.quick_action}\n\n` : ''}Return the JSON.`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 45000);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (GEN_KEY) headers.Authorization = `Bearer ${GEN_KEY}`;
    const res = await fetch(`${GEN_URL}/v1/chat/completions`, {
      method: 'POST', headers, signal: ac.signal,
      body: JSON.stringify({
        model: GEN_MODEL,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.2, max_tokens: 600,
        reasoning_effort: 'none', chat_template_kwargs: { enable_thinking: false },
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const raw = String(json?.choices?.[0]?.message?.content ?? '').trim();
    const first = raw.indexOf('{'); const last = raw.lastIndexOf('}');
    if (first < 0 || last <= first) return null;
    const parsed = JSON.parse(raw.slice(first, last + 1));
    const ideal = String(parsed.ideal_answer ?? '').trim();
    const facts = Array.isArray(parsed.must_contain_facts)
      ? parsed.must_contain_facts.map((s: any) => String(s).trim()).filter(Boolean)
      : [];
    return ideal && facts.length ? { ideal, facts } : null;
  } catch { return null; }
  finally { clearTimeout(t); }
}

async function main() {
  const pool = getDbPool();
  const set = JSON.parse(await readFile('qc/lessons-stress-candidates.json', 'utf8')) as { project_id_suggested?: string; queries: Cand[] };
  const out: any[] = [];
  let fail = 0;
  for (let i = 0; i < set.queries.length; i++) {
    const c = set.queries[i];
    const tid = c.target_lesson_ids[0];
    const { rows } = await pool.query<{ title: string; content: string; quick_action: string | null }>(
      `SELECT title, content, quick_action FROM lessons WHERE lesson_id = $1`, [tid],
    );
    if (!rows.length) { fail++; continue; }
    const d = await draft(c.query, rows[0]);
    if (!d) { fail++; process.stdout.write(`  [${i + 1}] FAIL «${c.query.slice(0, 50)}»\n`); continue; }
    out.push({
      id: c.id,
      group: 'rerank-stress-headroom',
      query: c.query,
      target_lesson_ids: c.target_lesson_ids,
      must_keywords: c.must_keywords ?? [],
      ideal_answer: d.ideal,
      must_contain_facts: d.facts,
      answer_category: 'standard',
      drafted_by: 'llm',
      reviewed_by: 'PENDING-REVIEW',
    });
    process.stdout.write(`  [${i + 1}/${set.queries.length}] ok facts=${d.facts.length} «${c.query.slice(0, 45)}»\n`);
  }
  await writeFile('qc/lessons-stress-geneval.json', JSON.stringify({
    surface: 'lessons',
    project_id_suggested: set.project_id_suggested ?? 'free-context-hub',
    version: '2026-06-16-rerank-stress-geneval',
    note: 'LLM-drafted ideal_answers for the hard-band A/B. reviewed_by=PENDING-REVIEW — measurement use only, not shipped.',
    queries: out,
  }, null, 2));
  console.log(`\n[draft] wrote ${out.length} gen-eval rows (fail=${fail}) → qc/lessons-stress-geneval.json`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
