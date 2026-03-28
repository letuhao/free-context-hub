/**
 * Seed realistic lessons from actual session work.
 * Then run lesson search quality test at 40+ lessons scale.
 *
 * Usage: npx tsx src/qc/seedSessionLessons.ts
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
  const txt = (r.content as any)[0]?.text || '';
  try {
    const s = txt.indexOf('{');
    return JSON.parse(txt.slice(s, txt.lastIndexOf('}') + 1));
  } catch {
    return txt;
  }
}

// ── All lessons from this session ──────────────────────────────────────

const LESSONS = [
  // === Architecture decisions ===
  { lesson_type: 'decision', title: 'Use 12-kind chunk classification for data types',
    content: 'We classify indexed code chunks into 12 kinds: source, type_def, test, migration, config, dependency, api_spec, doc, script, infra, style, generated. This allows agents to filter searches by data type. Priority order: generated > test > migration > api_spec > type_def > dependency > doc > style > config > infra > script > source.',
    tags: ['architecture', 'indexing', 'chunk-kind'], source_refs: ['src/utils/languageDetect.ts'] },

  { lesson_type: 'decision', title: 'Tiered search: deterministic first, semantic as fallback only',
    content: 'search_code_tiered uses a 4-tier pipeline: Tier 1 ripgrep (exact literal match on disk), Tier 2 symbol_name ILIKE lookup in DB, Tier 3 PostgreSQL FTS with camelCase expansion, Tier 4 semantic vector search (only when tiers 1-3 found fewer than threshold files). For coder agents, deterministic search is near-100% accurate for identifier queries.',
    tags: ['architecture', 'search', 'tiered-retrieval'], source_refs: ['src/services/tieredRetriever.ts'] },

  { lesson_type: 'decision', title: 'Three search profiles auto-selected by kind parameter',
    content: 'search_code_tiered has 3 profiles: code-search (default) uses ripgrep > symbol > FTS > semantic. relationship (kind=test) uses convention path inference > KG imports > filtered ripgrep to find the test file FOR a function. semantic-first (kind=doc/script) runs semantic as primary at full weight. Mixed kind arrays fall back to code-search.',
    tags: ['architecture', 'search', 'profiles'], source_refs: ['src/services/tieredRetriever.ts'] },

  { lesson_type: 'decision', title: 'Persistent memory is the core value, not code search',
    content: 'The primary value of free-context-hub is persistent cross-session knowledge: decisions, preferences, workarounds, and guardrails that survive after conversations end. Code search is supplementary because agents already have Grep/Glob. What they lack is memory across sessions.',
    tags: ['architecture', 'priority', 'product-strategy'], source_refs: ['README.md', 'WHITEPAPER.md'] },

  { lesson_type: 'decision', title: 'Guardrails must respect lesson lifecycle status',
    content: 'The guardrails engine queries the guardrails table joined with lessons table, filtering to status IN (active, draft). Superseded and archived guardrail lessons are ignored. Previously checkGuardrails queried guardrails table directly without checking if the parent lesson was still active — this was a bug.',
    tags: ['guardrails', 'bug-fix', 'lifecycle'], source_refs: ['src/services/guardrails.ts'] },

  { lesson_type: 'decision', title: 'Hybrid search for lessons: semantic + FTS keyword boost',
    content: 'Lesson search uses hybrid scoring: semantic embedding similarity as base score, plus 0.40 * FTS keyword rank. FTS catches exact keyword matches that semantic misses. Lessons store FTS tsvector with camelCase expansion via expandForFtsIndex. The blend formula is: LEAST(1.0, semantic_score + 0.40 * fts_rank).',
    tags: ['search', 'lessons', 'hybrid'], source_refs: ['src/services/lessons.ts', 'src/utils/ftsTokenizer.ts'] },

  { lesson_type: 'decision', title: 'Embed lesson title + content together for better query matching',
    content: 'When embedding lessons, we prepend the title to the content: embedTexts([title + ". " + content]). This improves query-document alignment because agents search with short phrases that match titles better than long content paragraphs.',
    tags: ['search', 'lessons', 'embeddings'], source_refs: ['src/services/lessons.ts'] },

  { lesson_type: 'decision', title: 'Query classification: identifier patterns take priority over NL words',
    content: 'classifyQuery checks for identifier patterns (camelCase, snake_case) before natural language keywords. Words like get, list, find are common identifier prefixes (getUser, findById). If the query contains a code identifier, classify as identifier or mixed, not natural_language. NL detection requires space-separated keywords.',
    tags: ['search', 'classification'], source_refs: ['src/services/tieredRetriever.ts'] },

  // === Embedding model decisions ===
  { lesson_type: 'decision', title: 'Use qwen3-embedding-0.6b as the embedding model',
    content: 'After benchmarking 8 embedding models on 18 lesson search queries, qwen3-embedding-0.6b (1024d) wins: 18/18 pass rate with highest average score (0.652). It beats bge-m3 (0.575), mxbai-large (0.648 but 17/18), and nomic-v2 (0.479). Code-specific models like nomic-embed-code performed worst (0.381) because our primary use is text lesson search, not code-to-code matching.',
    tags: ['embeddings', 'model-selection', 'benchmark'], source_refs: ['docs/benchmarks/2026-03-28-embedding-model-benchmark.md'] },

  { lesson_type: 'decision', title: 'Code embedding models are wrong for lesson search',
    content: 'Code-specific embedding models (nomic-embed-code, jina-code) perform poorly for lesson search because lessons are natural language text, not code. Our embedding model primarily serves lesson and doc search — code search uses ripgrep/FTS (deterministic, no embeddings). A general-purpose multilingual text model is the correct choice.',
    tags: ['embeddings', 'model-selection'], source_refs: ['docs/benchmarks/2026-03-28-embedding-model-benchmark.md'] },

  { lesson_type: 'decision', title: 'Recommended model combo: qwen3-embedding + coder-7b + reranker-4b',
    content: 'Best tested model combination: Embeddings: qwen3-embedding-0.6b (1024d, lesson/doc search). Distillation: qwen2.5-coder-7b-instruct (reflect, compress, summarize). Reranker: qwen3-reranker-4b (thinking-based JSON reranking, needs RERANK_LLM_MAX_TOKENS=500).',
    tags: ['embeddings', 'model-selection', 'configuration'], source_refs: ['.env.example', 'README.md'] },

  // === Workarounds ===
  { lesson_type: 'workaround', title: 'Docker build cache prevents new migration files from loading',
    content: 'When adding new SQL migration files, docker compose build may cache the COPY . . layer and not include the new file. Always use docker compose build --no-cache when migration files change, then docker compose up -d --force-recreate.',
    tags: ['docker', 'deployment', 'migrations'] },

  { lesson_type: 'workaround', title: 'Redis cache must be flushed after retrieval logic changes',
    content: 'search_code and search_code_tiered cache results in Redis. After changing scoring, FTS logic, or retrieval pipeline, cached results become stale and tests show old behavior. Run: docker compose exec redis redis-cli FLUSHALL before testing.',
    tags: ['redis', 'cache', 'debugging'] },

  { lesson_type: 'workaround', title: 'CREATE INDEX CONCURRENTLY fails in migration runner',
    content: 'The migration runner wraps each SQL file in a transaction. CREATE INDEX CONCURRENTLY cannot run inside a transaction. Use regular CREATE INDEX instead. Safe at our scale (under 100k chunks). Same applies to IVFFlat indexes.',
    tags: ['postgresql', 'migrations', 'database'], source_refs: ['migrations/0018_trgm_symbol_name.sql'] },

  { lesson_type: 'workaround', title: 'pgvector HNSW index limited to 2000 dimensions',
    content: 'pgvector HNSW and IVFFlat indexes only support up to 2000 dimensions. For models with >2000d output (like qwen3-embedding-4b at 2560d), use halfvec type which supports HNSW up to 4000 dims. Or choose a model with <=2000d output to avoid the hassle.',
    tags: ['postgresql', 'pgvector', 'embeddings'] },

  { lesson_type: 'workaround', title: 'MCP tool add_lesson requires lesson_payload wrapper',
    content: 'The add_lesson MCP tool expects arguments nested inside a lesson_payload object, not flat: { lesson_payload: { project_id, lesson_type, title, content, tags } }. Similarly, check_guardrails needs project_id inside action_context, not at root level.',
    tags: ['mcp', 'api', 'debugging'] },

  { lesson_type: 'workaround', title: 'Qwen3 reranker needs max_tokens=500 for thinking mode',
    content: 'qwen.qwen3-reranker-4b uses thinking mode — reasoning tokens consume max_tokens budget before the actual JSON answer. With default 250 tokens, the JSON output gets truncated. Set RERANK_LLM_MAX_TOKENS=500 or higher. Also append /no_think to system prompt to disable thinking (but ranking quality drops).',
    tags: ['reranker', 'model-configuration', 'debugging'] },

  { lesson_type: 'workaround', title: 'Embedding dimension mismatch crashes index_project silently',
    content: 'If the embedding model output dimension does not match EMBEDDINGS_DIM in .env, index_project returns files_indexed: 0 with no visible error. Check docker logs for: Embedding dimension mismatch: got=X expected=Y. Always verify dimension matches after switching models.',
    tags: ['embeddings', 'debugging', 'configuration'] },

  // === Preferences ===
  { lesson_type: 'preference', title: 'FTS uses AND mode for identifier queries, OR for natural language',
    content: 'When the query is classified as identifier or path, FTS query builder uses AND (&) operator to require all terms match. This prevents over-broad matches like searching assertWorkspaceToken and matching every file with the word token. Natural language queries use OR (|) for broader recall.',
    tags: ['search', 'fts', 'preference-search'], source_refs: ['src/utils/ftsTokenizer.ts'] },

  { lesson_type: 'preference', title: 'Ripgrep ignore patterns should cover all ecosystems',
    content: 'Default ripgrep ignore patterns must cover JavaScript (node_modules, dist, .next), Python (__pycache__, .venv), Go (vendor), Rust (target), Java (.gradle, build), and general (.cache, coverage, *.min.js, *.lock). The defaults are in DEFAULT_IGNORE_PATTERNS in ripgrepSearch.ts.',
    tags: ['search', 'ripgrep', 'multi-language'], source_refs: ['src/utils/ripgrepSearch.ts'] },

  { lesson_type: 'preference', title: 'Test files should be excluded from search by default',
    content: 'search_code_tiered excludes test files (kind=test) by default. When kind filter includes test, includeTests is auto-enabled. This prevents test files from cluttering code search results while still allowing explicit test discovery via kind=test (relationship profile).',
    tags: ['search', 'test-files'], source_refs: ['src/services/tieredRetriever.ts'] },

  { lesson_type: 'preference', title: 'Short identifiers (2-3 chars) should be extractable as search tokens',
    content: 'Token extraction minimum length was lowered from 4 to 2 characters. Tokens like env, db, pg, api are valid search identifiers. They are kept unless they appear in the EXTRACT_STOP_WORDS set (common English words like get, set, new, old).',
    tags: ['search', 'token-extraction'], source_refs: ['src/services/tieredRetriever.ts'] },

  // === Guardrails ===
  { lesson_type: 'guardrail', title: 'Always re-index after changing chunk classification logic',
    content: 'When the classifyKind function or languageDetect.ts patterns change, existing chunks in the DB have stale chunk_kind values. Must run index_project to re-classify all files. Without re-indexing, kind filters in search_code_tiered return incorrect results.',
    tags: ['indexing', 'guardrail', 'chunk-kind'],
    guardrail: { trigger: '/index|classify|chunk.kind|languageDetect/', requirement: 'Re-index project after changing classification logic', verification_method: 'user_confirmation' } },

  { lesson_type: 'guardrail', title: 'Flush Redis after changing search scoring or retrieval pipeline',
    content: 'search_code and search_code_tiered results are cached in Redis. Any change to scoring weights, FTS logic, tier ordering, or profile behavior requires flushing Redis before testing. Stale cache masks real behavior changes.',
    tags: ['redis', 'guardrail', 'testing'],
    guardrail: { trigger: '/retriev|scoring|fts|search.*tier|search.*profile/', requirement: 'Flush Redis cache before testing search changes', verification_method: 'user_confirmation' } },

  { lesson_type: 'guardrail', title: 'Run integration tests after any MCP tool or search changes',
    content: 'npm run test:integration runs 13 automated tests covering lessons, guardrails, bootstrap, and tiered search. Must pass before merging changes to core features. Tests use live MCP tool calls so require the server running.',
    tags: ['testing', 'guardrail', 'ci'],
    guardrail: { trigger: '/push|merge|deploy|release/', requirement: 'Run npm run test:integration and verify all 13 tests pass', verification_method: 'user_confirmation' } },

  // === Testing insights ===
  { lesson_type: 'general_note', title: 'Integration tests caught guardrails bug on first run',
    content: 'The guardrail-superseded integration test failed on first run because checkGuardrails did not check lesson lifecycle status. Superseded guardrails still blocked actions. The test revealed the bug, which was fixed by joining guardrails with lessons table and filtering to active/draft status. Tests pay for themselves.',
    tags: ['testing', 'guardrails', 'quality'] },

  { lesson_type: 'general_note', title: 'Tiered search and semantic search are complementary, not replacements',
    content: 'Golden set QC shows tiered search (kind=source) fixes worst semantic groups: config jumped from 0.250 to 1.000 recall, mcp-auth from 0.333 to 1.000, kg from 0.375 to 0.875. But tiered loses on groups where kind=source filter excludes expected targets (migrations, scripts). Use tiered with kind filter for precision, semantic without filter for broad recall.',
    tags: ['search', 'quality', 'benchmark'] },

  { lesson_type: 'general_note', title: 'Bare .sql files should not be classified as migrations',
    content: 'The original MIGRATION_PATTERNS included /\\.sql$/ which classified any standalone SQL file as migration kind. This caused src/queries/analytics.sql to be misclassified. Fixed: only match SQL files in migrations/ directories or with numbered prefixes like 0001_init.sql.',
    tags: ['classification', 'bug-fix'], source_refs: ['src/utils/languageDetect.ts'] },

  { lesson_type: 'general_note', title: 'Convention-based test path inference supports 6 languages',
    content: 'The relationship search profile generates test file path patterns for: TypeScript/JavaScript (auth.test.ts, auth.spec.ts), Go (auth_test.go), Python (test_auth.py, auth_test.py), Java/Kotlin (AuthTest.java), Ruby (auth_spec.rb). Also checks __tests__/ directories and tests/ mirror paths.',
    tags: ['search', 'test-discovery', 'multi-language'], source_refs: ['src/services/tieredRetriever.ts'] },

  { lesson_type: 'general_note', title: 'Ripgrep circuit breaker detects binary availability once',
    content: 'isRipgrepAvailable() in ripgrepSearch.ts checks if the rg binary exists on first call, then caches the result. If ripgrep is not installed (common in Docker), all tier 1 calls skip silently with a warning instead of spawning failing processes. Concurrent checks are coalesced via rgCheckPromise.',
    tags: ['search', 'ripgrep', 'resilience'], source_refs: ['src/utils/ripgrepSearch.ts'] },
];

// ── Queries to test at scale ──────────────────────────────────────────

type Q = { q: string; expect: string | null };

const QUERIES: Q[] = [
  // Direct matches (should be easy)
  { q: 'how does search work in this project', expect: 'tiered search' },
  { q: 'what types of data chunks exist', expect: '12-kind' },
  { q: 'docker deployment issues', expect: 'Docker build cache' },
  { q: 'caching problems after code changes', expect: 'Redis cache' },
  { q: 'database migration gotchas', expect: 'CREATE INDEX CONCURRENTLY' },
  { q: 'what is the main purpose of this project', expect: 'Persistent memory' },
  { q: 'how are guardrails enforced', expect: 'lifecycle status' },
  { q: 'what embedding model should I use', expect: 'qwen3-embedding-0.6b' },
  { q: 'how does lesson search scoring work', expect: 'Hybrid search' },
  { q: 'what search profiles are available', expect: 'Three search profiles' },

  // Indirect / paraphrase queries (harder)
  { q: 'my search returns old results after I changed scoring weights', expect: 'Redis' },
  { q: 'why does the server crash on startup with new SQL file', expect: 'CONCURRENTLY' },
  { q: 'I added a migration file but docker does not see it', expect: 'Docker build cache' },
  { q: 'how does the system find test files for a function', expect: 'convention' },
  { q: 'why is search returning wrong file types after I changed the classifier', expect: 're-index' },
  { q: 'which models were benchmarked for embeddings', expect: 'qwen3-embedding' },
  { q: 'why not use a code-specific embedding model', expect: 'Code embedding models are wrong' },
  { q: 'what model combo do you recommend', expect: 'qwen3-embedding' },
  { q: 'how to debug dimension mismatch error', expect: 'dimension mismatch' },
  { q: 'why does reranker output get truncated', expect: 'max_tokens' },

  // Cross-topic queries (test discrimination at scale)
  { q: 'how does FTS query building work', expect: 'AND mode' },
  { q: 'what languages does test file discovery support', expect: 'convention' },
  { q: 'how does ripgrep handle missing binary in Docker', expect: 'circuit breaker' },
  { q: 'what ignore patterns does ripgrep use', expect: 'ecosystem' },
  { q: 'should short tokens like db and env be searchable', expect: 'Short identifiers' },
  { q: 'how does the MCP add_lesson API work', expect: 'lesson_payload wrapper' },
  { q: 'what happens to guardrails when a lesson is archived', expect: 'lifecycle status' },
  { q: 'what did the integration tests catch', expect: 'guardrails bug' },
  { q: 'are tiered search and semantic search the same thing', expect: 'complementary' },
  { q: 'why did we change from bare .sql classification', expect: 'Bare .sql' },

  // Negative tests (no matching lesson expected)
  { q: 'how to set up kubernetes deployment', expect: null },
  { q: 'what frontend framework does this project use', expect: null },
  { q: 'how to configure OAuth2 authentication', expect: null },
];

async function main() {
  const client = new Client({ name: 'scale-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), {}));

  // Seed lessons
  console.log(`Seeding ${LESSONS.length} lessons...\n`);
  let seeded = 0;
  for (const l of LESSONS) {
    const r = await call(client, 'add_lesson', {
      lesson_payload: { project_id: PID, ...l },
      output_format: 'json_only',
    }) as any;
    if (r?.lesson_id) seeded++;
    else console.log(`  WARN: failed to seed "${l.title.slice(0, 50)}": ${JSON.stringify(r).slice(0, 100)}`);
  }

  // Count total lessons in DB
  const list = await call(client, 'list_lessons', {
    project_id: PID,
    page: { limit: 1 },
    output_format: 'json_only',
  }) as any;

  console.log(`Seeded: ${seeded}/${LESSONS.length}`);
  console.log(`Total lessons in DB: checking...\n`);

  // Run queries
  console.log('='.repeat(60));
  console.log(`  Lesson Search Quality at Scale`);
  console.log(`  ${QUERIES.length} queries, ${seeded} new lessons seeded`);
  console.log('='.repeat(60));

  let pass = 0;
  let fail = 0;
  const scores: number[] = [];
  const failures: string[] = [];

  for (const { q, expect } of QUERIES) {
    const r = await call(client, 'search_lessons', {
      project_id: PID,
      query: q,
      limit: 3,
      output_format: 'json_only',
    }) as any;

    const matches = r?.matches || [];
    const top = matches[0];
    const score: number = top?.score ?? 0;
    scores.push(score);

    let hit: boolean;
    if (expect === null) {
      hit = !top || top.score < 0.5;
    } else {
      hit = matches.some((m: any) =>
        ((m.title || '') + ' ' + (m.content_snippet || '')).toLowerCase().includes(expect.toLowerCase()),
      );
    }

    const icon = hit ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    console.log(`  ${icon} [${score.toFixed(3)}] ${q}`);
    console.log(`        → ${(top?.title || '(none)').slice(0, 65)}`);
    if (!hit && expect) {
      console.log(`        expected: ${expect}`);
      failures.push(`"${q}" → expected "${expect}", got "${top?.title?.slice(0, 50) || 'none'}"`);
    }
    if (hit) pass++;
    else fail++;
  }

  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const min = scores.length ? Math.min(...scores) : 0;
  const max = scores.length ? Math.max(...scores) : 0;
  const positiveScores = scores.filter((_, i) => QUERIES[i].expect !== null);
  const negativeScores = scores.filter((_, i) => QUERIES[i].expect === null);
  const avgPositive = positiveScores.length ? positiveScores.reduce((a, b) => a + b, 0) / positiveScores.length : 0;
  const avgNegative = negativeScores.length ? negativeScores.reduce((a, b) => a + b, 0) / negativeScores.length : 0;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Results: ${pass}/${pass + fail} passed`);
  console.log(`  Scores: avg=${avg.toFixed(3)} min=${min.toFixed(3)} max=${max.toFixed(3)}`);
  console.log(`  Positive queries avg: ${avgPositive.toFixed(3)} (should be high)`);
  console.log(`  Negative queries avg: ${avgNegative.toFixed(3)} (should be <0.5)`);
  console.log(`  Discrimination gap: ${(avgPositive - avgNegative).toFixed(3)} (higher = better)`);
  if (failures.length) {
    console.log(`\n  Failures:`);
    for (const f of failures) console.log(`    - ${f}`);
  }
  console.log('='.repeat(60));

  await client.close();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
