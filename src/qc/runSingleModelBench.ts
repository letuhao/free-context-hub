/**
 * Single-model benchmark: delete → index → seed → test.
 * Usage: npx tsx src/qc/runSingleModelBench.ts
 */
import * as dotenv from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

dotenv.config();

const MCP_URL = process.env.MCP_SERVER_URL?.trim() || 'http://localhost:3000/mcp';
const PID = 'free-context-hub';
const MODEL = process.env.EMBEDDINGS_MODEL || '(unknown)';

async function call(c: Client, n: string, a: Record<string, unknown>, t = 60000) {
  const r = await c.request(
    { method: 'tools/call', params: { name: n, arguments: a } },
    CallToolResultSchema, { timeout: t },
  );
  const txt = (r.content as any)[0]?.text || '';
  try { const s = txt.indexOf('{'); return JSON.parse(txt.slice(s, txt.lastIndexOf('}') + 1)); }
  catch { return txt; }
}

const LESSONS = [
  { lesson_type: 'decision', title: 'Use 12-kind chunk classification for data types', content: 'We classify indexed code chunks into 12 kinds: source, type_def, test, migration, config, dependency, api_spec, doc, script, infra, style, generated. This allows agents to filter searches by data type.', tags: ['architecture'] },
  { lesson_type: 'decision', title: 'Tiered search: deterministic first, semantic as fallback only', content: 'search_code_tiered uses a 4-tier pipeline: Tier 1 ripgrep, Tier 2 symbol_name ILIKE, Tier 3 PostgreSQL FTS, Tier 4 semantic vector search as fallback only.', tags: ['architecture'] },
  { lesson_type: 'decision', title: 'Three search profiles auto-selected by kind parameter', content: 'search_code_tiered has 3 profiles: code-search uses ripgrep > symbol > FTS > semantic. relationship (kind=test) uses convention path inference to find test files. semantic-first (kind=doc/script) runs semantic as primary.', tags: ['architecture'] },
  { lesson_type: 'decision', title: 'Persistent memory is the core value, not code search', content: 'The primary value of free-context-hub is persistent cross-session knowledge: decisions, preferences, workarounds, and guardrails that survive after conversations end. Code search is supplementary.', tags: ['architecture'] },
  { lesson_type: 'workaround', title: 'Docker build cache prevents new migration files from loading', content: 'When adding new SQL migration files, docker compose build may cache the COPY layer. Always use docker compose build --no-cache when migration files change.', tags: ['docker'] },
  { lesson_type: 'workaround', title: 'Redis cache must be flushed after retrieval logic changes', content: 'search_code and search_code_tiered cache results in Redis. After changing scoring or retrieval pipeline, run docker compose exec redis redis-cli FLUSHALL.', tags: ['redis'] },
  { lesson_type: 'workaround', title: 'CREATE INDEX CONCURRENTLY fails in migration runner', content: 'The migration runner wraps each SQL file in a transaction. CREATE INDEX CONCURRENTLY cannot run inside a transaction. Use regular CREATE INDEX instead.', tags: ['postgresql'] },
  { lesson_type: 'preference', title: 'FTS uses AND mode for identifier queries, OR for natural language', content: 'When the query is classified as identifier or path, FTS uses AND operator. Natural language queries use OR for broader recall.', tags: ['search'] },
  { lesson_type: 'guardrail', title: 'Always re-index after changing chunk classification logic', content: 'When classifyKind or languageDetect.ts patterns change, must run index_project to re-classify all files.', tags: ['indexing'], guardrail: { trigger: '/index|classify/', requirement: 'Re-index after changing classification', verification_method: 'user_confirmation' } },
  { lesson_type: 'decision', title: 'Guardrails must respect lesson lifecycle status', content: 'The guardrails engine queries guardrails table joined with lessons table, filtering to active and draft status. Superseded and archived guardrails are ignored.', tags: ['guardrails'] },
];

type Q = { q: string; expect: string | null };
const QUERIES: Q[] = [
  { q: 'how does search work in this project', expect: 'tiered search' },
  { q: 'what types of data chunks exist', expect: '12-kind' },
  { q: 'authentication approach', expect: null },
  { q: 'docker deployment issues', expect: 'Docker build cache' },
  { q: 'caching problems after code changes', expect: 'Redis cache' },
  { q: 'database migration gotchas', expect: 'CREATE INDEX CONCURRENTLY' },
  { q: 'what is the main purpose of this project', expect: 'Persistent memory' },
  { q: 'how are guardrails enforced', expect: 'lifecycle status' },
  { q: 'should I re-index after changing code classification', expect: 're-index' },
  { q: 'how does FTS query building work', expect: 'AND mode' },
  { q: 'what search profiles are available', expect: 'Three search profiles' },
  { q: 'stale results after changing retrieval logic', expect: 'Redis' },
  { q: 'my search returns old results after I changed scoring weights', expect: 'Redis' },
  { q: 'why does the server crash on startup with new SQL file', expect: 'CONCURRENTLY' },
  { q: 'I added a .sql file to migrations/ but docker does not see it', expect: 'Docker build cache' },
  { q: 'how does the system find test files for a function', expect: 'relationship' },
  { q: 'why is search still returning wrong file types after I changed the classifier', expect: 're-index' },
  { q: 'what should I do before git push', expect: null },
];

async function main() {
  const c = new Client({ name: 'bench', version: '1.0.0' }, { capabilities: {} });
  await c.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), {}));

  console.log(`\nModel: ${MODEL}`);
  console.log('='.repeat(60));

  // Delete
  console.log('Deleting workspace...');
  await call(c, 'delete_workspace', { project_id: PID, output_format: 'json_only' });

  // Index
  console.log('Indexing...');
  const idxStart = Date.now();
  const idx = await call(c, 'index_project', { project_id: PID, root: '/app', output_format: 'json_only' }, 600000);
  const idxSecs = ((Date.now() - idxStart) / 1000).toFixed(1);
  console.log(`Indexed: ${(idx as any)?.files_indexed} files in ${idxSecs}s`);

  // Seed
  console.log(`Seeding ${LESSONS.length} lessons...`);
  for (const l of LESSONS) {
    await call(c, 'add_lesson', { lesson_payload: { project_id: PID, ...l }, output_format: 'json_only' });
  }

  // Benchmark
  console.log(`\nRunning ${QUERIES.length} queries...\n`);
  let pass = 0;
  const scores: number[] = [];

  for (const { q, expect } of QUERIES) {
    const r = await call(c, 'search_lessons', { project_id: PID, query: q, limit: 3, output_format: 'json_only' });
    const m = (r as any)?.matches || [];
    const top = m[0];
    const score: number = top?.score ?? 0;
    scores.push(score);

    let hit: boolean;
    if (expect === null) {
      hit = !top || top.score < 0.5;
    } else {
      hit = m.some((x: any) => ((x.title || '') + ' ' + (x.content_snippet || '')).toLowerCase().includes(expect.toLowerCase()));
    }

    const icon = hit ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    console.log(`  ${icon} [${score.toFixed(3)}] ${q}`);
    console.log(`        -> ${(top?.title || '(none)').slice(0, 60)}`);
    if (!hit && expect) console.log(`        expected: ${expect}`);
    if (hit) pass++;
  }

  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const min = Math.min(...scores);
  const max = Math.max(...scores);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Model: ${MODEL}`);
  console.log(`  Result: ${pass}/${QUERIES.length} | avg=${avg.toFixed(3)} min=${min.toFixed(3)} max=${max.toFixed(3)} | index=${idxSecs}s`);
  console.log('='.repeat(60));

  await c.close();
}

main().catch(e => { console.error(e); process.exit(1); });
