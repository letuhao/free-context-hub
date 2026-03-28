/**
 * Lesson search quality test — measures hybrid search score improvement.
 * Run: npx tsx src/qc/lessonQualityTest.ts
 */
import * as dotenv from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

dotenv.config();

const MCP_URL = process.env.MCP_SERVER_URL?.trim() || 'http://localhost:3000/mcp';
const PID = 'free-context-hub';

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const r = await client.request(
    { method: 'tools/call', params: { name, arguments: args } },
    CallToolResultSchema,
    { timeout: 60000 },
  );
  const text = (r.content as any)[0]?.text || '';
  try {
    const s = text.indexOf('{');
    const e = text.lastIndexOf('}');
    return JSON.parse(text.slice(s, e + 1));
  } catch {
    return text;
  }
}

const lessons = [
  { lesson_type: 'decision', title: 'Use 12-kind chunk classification for data types',
    content: 'We classify indexed code chunks into 12 kinds: source, type_def, test, migration, config, dependency, api_spec, doc, script, infra, style, generated. This allows agents to filter searches by data type. The classifier lives in src/utils/languageDetect.ts with priority order: generated > test > migration > api_spec > type_def > dependency > doc > style > config > infra > script > source.',
    tags: ['architecture', 'indexing', 'chunk-kind'], source_refs: ['src/utils/languageDetect.ts'] },
  { lesson_type: 'decision', title: 'Tiered search: deterministic first, semantic as fallback only',
    content: 'search_code_tiered uses a 4-tier pipeline: Tier 1 ripgrep (exact literal match on disk), Tier 2 symbol_name ILIKE lookup in DB, Tier 3 PostgreSQL FTS with camelCase expansion, Tier 4 semantic vector search (only if tiers 1-3 found fewer than threshold files). For coder agents, deterministic search is near-100% accurate for identifier queries. Semantic is only useful for natural language.',
    tags: ['architecture', 'search', 'tiered-retrieval'], source_refs: ['src/services/tieredRetriever.ts'] },
  { lesson_type: 'decision', title: 'Three search profiles auto-selected by kind parameter',
    content: 'search_code_tiered has 3 profiles: code-search (default) uses ripgrep > symbol > FTS > semantic. relationship (kind=test) uses convention path inference > KG imports > filtered ripgrep to find the test file FOR a function. semantic-first (kind=doc/script) runs semantic as primary at full weight. Mixed kind arrays fall back to code-search.',
    tags: ['architecture', 'search', 'profiles'], source_refs: ['src/services/tieredRetriever.ts'] },
  { lesson_type: 'decision', title: 'Persistent memory is the core value, not code search',
    content: 'The primary value of free-context-hub is persistent cross-session knowledge: decisions, preferences, workarounds, and guardrails that survive after conversations end. Code search is supplementary because agents already have Grep/Glob. What they lack is memory across sessions.',
    tags: ['architecture', 'priority', 'product-strategy'], source_refs: ['README.md', 'WHITEPAPER.md'] },
  { lesson_type: 'workaround', title: 'Docker build cache prevents new migration files from loading',
    content: 'When adding new SQL migration files, docker compose build may cache the COPY layer and not include the new file. Always use docker compose build --no-cache when migration files change, then docker compose up -d --force-recreate.',
    tags: ['docker', 'deployment', 'migrations'], source_refs: ['docker-compose.yml'] },
  { lesson_type: 'workaround', title: 'Redis cache must be flushed after retrieval logic changes',
    content: 'search_code and search_code_tiered cache results in Redis. After changing scoring, FTS logic, or retrieval pipeline, cached results become stale. Run: docker compose exec redis redis-cli FLUSHALL before testing.',
    tags: ['redis', 'cache', 'debugging'], source_refs: ['src/services/redisCache.ts'] },
  { lesson_type: 'workaround', title: 'CREATE INDEX CONCURRENTLY fails in migration runner',
    content: 'The migration runner wraps each SQL file in a transaction. CREATE INDEX CONCURRENTLY cannot run inside a transaction. Use regular CREATE INDEX instead. Safe at our scale under 100k chunks.',
    tags: ['postgresql', 'migrations', 'database'], source_refs: ['migrations/0018_trgm_symbol_name.sql'] },
  { lesson_type: 'preference', title: 'FTS uses AND mode for identifier queries, OR for natural language',
    content: 'When the query is classified as identifier or path, FTS query builder uses AND operator to require all terms match. This prevents over-broad matches like searching assertWorkspaceToken and matching every file with the word token. Natural language queries use OR for broader recall.',
    tags: ['search', 'fts', 'preference-search'], source_refs: ['src/utils/ftsTokenizer.ts'] },
  { lesson_type: 'guardrail', title: 'Always re-index after changing chunk classification logic',
    content: 'When the classifyKind function or languageDetect.ts patterns change, existing chunks in the DB have stale chunk_kind values. Must run index_project to re-classify all files. Without re-indexing, kind filters in search_code_tiered return incorrect results.',
    tags: ['indexing', 'guardrail', 'chunk-kind'],
    guardrail: { trigger: '/index|classify|chunk.kind|languageDetect/', requirement: 'Re-index project after changing classification logic', verification_method: 'user_confirmation' } },
  { lesson_type: 'decision', title: 'Guardrails must respect lesson lifecycle status',
    content: 'The guardrails engine queries the guardrails table joined with lessons table, filtering to status IN active and draft. Superseded and archived guardrail lessons are ignored. This was a bug fix previously checkGuardrails queried guardrails table directly without checking if the parent lesson was still active.',
    tags: ['guardrails', 'bug-fix', 'lifecycle'], source_refs: ['src/services/guardrails.ts'] },
];

type Query = { q: string; expect: string | null };

const easyQueries: Query[] = [
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
];

const hardQueries: Query[] = [
  { q: 'my search returns old results after I changed scoring weights', expect: 'Redis' },
  { q: 'why does the server crash on startup with new SQL file', expect: 'CONCURRENTLY' },
  { q: "I added a .sql file to migrations/ but docker doesn't see it", expect: 'Docker build cache' },
  { q: 'how does the system find test files for a function', expect: 'relationship' },
  { q: 'why is search still returning wrong file types after I changed the classifier', expect: 're-index' },
  { q: 'what should I do before git push', expect: null },
];

async function runQueries(client: Client, label: string, queries: Query[]) {
  console.log(`\n── ${label} ──`);
  let pass = 0;
  const scores: number[] = [];

  for (const { q, expect } of queries) {
    const r = await call(client, 'search_lessons', { project_id: PID, query: q, limit: 3, output_format: 'json_only' });
    const matches = (r as any)?.matches || [];
    const top = matches[0];
    const score = top?.score ?? 0;
    scores.push(score);

    let hit = false;
    if (expect === null) {
      hit = !top || top.score < 0.5;
    } else {
      hit = matches.some((m: any) => ((m.title || '') + ' ' + (m.content_snippet || '')).toLowerCase().includes(expect.toLowerCase()));
    }

    const icon = hit ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    const topTitle = (top?.title || '(none)').slice(0, 60);
    console.log(`  ${icon} [${score.toFixed(3)}] "${q}"`);
    console.log(`        → ${topTitle}`);
    if (!hit && expect) console.log(`        expected: ${expect}`);
    if (hit) pass++;
  }

  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const min = scores.length ? Math.min(...scores) : 0;
  const max = scores.length ? Math.max(...scores) : 0;
  console.log(`\n  ${pass}/${queries.length} passed | avg=${avg.toFixed(3)} min=${min.toFixed(3)} max=${max.toFixed(3)}`);
  return { pass, total: queries.length, avg, min, max };
}

async function main() {
  const client = new Client({ name: 'lesson-quality', version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), {}));

  // Step 1: Delete old data and re-seed with FTS-enabled lessons.
  console.log('Deleting old workspace...');
  await call(client, 'delete_workspace', { project_id: PID, output_format: 'json_only' });

  console.log('Re-indexing project...');
  const idx = await call(client, 'index_project', { project_id: PID, root: '/app', output_format: 'json_only' });
  console.log(`Indexed: ${(idx as any)?.files_indexed} files`);

  console.log(`Seeding ${lessons.length} lessons (with FTS)...`);
  for (const l of lessons) {
    await call(client, 'add_lesson', { lesson_payload: { project_id: PID, ...l }, output_format: 'json_only' });
  }

  // Step 2: Run queries.
  console.log('\n═══════════════════════════════════════════');
  console.log('  Lesson Search Quality Test (Hybrid)');
  console.log('═══════════════════════════════════════════');

  const easy = await runQueries(client, 'Easy Queries (12)', easyQueries);
  const hard = await runQueries(client, 'Hard Queries (6)', hardQueries);

  console.log('\n═══════════════════════════════════════════');
  console.log(`  Easy: ${easy.pass}/${easy.total} (avg=${easy.avg.toFixed(3)})`);
  console.log(`  Hard: ${hard.pass}/${hard.total} (avg=${hard.avg.toFixed(3)})`);
  console.log(`  Total: ${easy.pass + hard.pass}/${easy.total + hard.total}`);
  console.log('═══════════════════════════════════════════');

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
