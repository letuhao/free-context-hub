/**
 * Quick model A/B benchmark — tests lesson search quality with different embedding models.
 * Requires: MCP server running, models loaded in LM Studio.
 *
 * Usage: MODELS=model1,model2 npx tsx src/qc/modelBenchmark.ts
 */
import * as dotenv from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

dotenv.config();

const MCP_URL = process.env.MCP_SERVER_URL?.trim() || 'http://localhost:3000/mcp';
const PID = 'free-context-hub';

async function call(client: Client, name: string, args: Record<string, unknown>, timeout = 600000) {
  const r = await client.request(
    { method: 'tools/call', params: { name, arguments: args } },
    CallToolResultSchema,
    { timeout },
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

async function benchmarkModel(client: Client, modelName: string): Promise<{ pass: number; total: number; avg: number; min: number; max: number; failures: string[] }> {
  // Delete, re-index, seed
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Model: ${modelName}`);
  console.log('='.repeat(60));

  console.log('  Deleting workspace...');
  await call(client, 'delete_workspace', { project_id: PID, output_format: 'json_only' });

  console.log('  Indexing...');
  const idxStart = Date.now();
  const idx = await call(client, 'index_project', { project_id: PID, root: '/app', output_format: 'json_only' });
  const idxTime = ((Date.now() - idxStart) / 1000).toFixed(1);
  console.log(`  Indexed: ${(idx as any)?.files_indexed} files in ${idxTime}s`);

  console.log(`  Seeding ${LESSONS.length} lessons...`);
  for (const l of LESSONS) {
    await call(client, 'add_lesson', { lesson_payload: { project_id: PID, ...l }, output_format: 'json_only' }, 60000);
  }

  // Run queries
  console.log(`  Running ${QUERIES.length} queries...\n`);
  let pass = 0;
  const scores: number[] = [];
  const failures: string[] = [];

  for (const { q, expect } of QUERIES) {
    const r = await call(client, 'search_lessons', { project_id: PID, query: q, limit: 3, output_format: 'json_only' }, 60000);
    const matches = (r as any)?.matches || [];
    const top = matches[0];
    const score = top?.score ?? 0;
    scores.push(score);

    let hit: boolean;
    if (expect === null) {
      hit = !top || top.score < 0.5;
    } else {
      hit = matches.some((m: any) => ((m.title || '') + ' ' + (m.content_snippet || '')).toLowerCase().includes(expect.toLowerCase()));
    }

    const icon = hit ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    console.log(`  ${icon} [${score.toFixed(3)}] ${q}`);
    console.log(`        → ${(top?.title || '(none)').slice(0, 60)}`);
    if (!hit && expect) {
      console.log(`        expected: ${expect}`);
      failures.push(`"${q}" → expected "${expect}"`);
    }
    if (hit) pass++;
  }

  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const min = Math.min(...scores);
  const max = Math.max(...scores);

  console.log(`\n  Result: ${pass}/${QUERIES.length} | avg=${avg.toFixed(3)} min=${min.toFixed(3)} max=${max.toFixed(3)} | index=${idxTime}s`);

  return { pass, total: QUERIES.length, avg, min, max, failures };
}

async function main() {
  const models = (process.env.MODELS || 'text-embedding-bge-m3').split(',').map(s => s.trim()).filter(Boolean);

  console.log('Model Benchmark — Lesson Search Quality');
  console.log(`Models to test: ${models.join(', ')}`);
  console.log(`MCP: ${MCP_URL}\n`);

  const results: Array<{ model: string; pass: number; total: number; avg: number; min: number; max: number; failures: string[] }> = [];

  for (const model of models) {
    // Update the server's embedding model via env — but we can't change .env dynamically.
    // Instead, we rely on the caller to set the model in .env before starting the server.
    // For multi-model comparison, restart server between models.
    console.log(`\nConnecting for model: ${model}...`);
    const client = new Client({ name: 'benchmark', version: '1.0.0' }, { capabilities: {} });
    await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), {}));

    const r = await benchmarkModel(client, model);
    results.push({ model, ...r });

    await client.close();
  }

  // Summary table
  console.log('\n' + '='.repeat(60));
  console.log('  SUMMARY');
  console.log('='.repeat(60));
  console.log('  Model                         | Pass  | Avg   | Min   | Max   ');
  console.log('  ' + '-'.repeat(56));
  for (const r of results) {
    const name = r.model.padEnd(30);
    console.log(`  ${name} | ${r.pass}/${r.total}  | ${r.avg.toFixed(3)} | ${r.min.toFixed(3)} | ${r.max.toFixed(3)}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
