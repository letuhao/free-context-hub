import * as z from 'zod/v4';

function parseBooleanEnv(v: unknown): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).trim().toLowerCase();
  if (s === '') return undefined;
  if (['true', '1', 'yes', 'y', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(s)) return false;
  return undefined;
}

/** Copy deprecated `PHASE6_*` into canonical keys when the latter are unset (backward compatibility). */
function migrateLegacyEnvKeys(raw: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const pairs: Array<[string, string]> = [
    ['KNOWLEDGE_LOOP_ENABLED', 'PHASE6_KNOWLEDGE_LOOP_ENABLED'],
    ['QUALITY_EVAL_MIN_RECALL_AT3', 'PHASE6_MIN_RECALL_AT3'],
    ['QUALITY_EVAL_MIN_RECALL_DELTA', 'PHASE6_MIN_RECALL_DELTA'],
    ['QUALITY_EVAL_MAX_P95_MS', 'PHASE6_MAX_P95_MS'],
    ['QUALITY_EVAL_NO_REGRESS_GROUPS', 'PHASE6_NO_REGRESS_GROUPS'],
    ['QUALITY_EVAL_QUERIES_PATH', 'PHASE6_EVAL_QUERIES_PATH'],
    ['QUALITY_EVAL_KG_ASSIST', 'PHASE6_EVAL_KG_ASSIST'],
    ['QUALITY_EVAL_BASELINE_DOC_KEY', 'PHASE6_BASELINE_DOC_KEY'],
    ['BUILDER_MEMORY_ENABLED', 'PHASE6_BUILDER_MEMORY_ENABLED'],
    ['BUILDER_MEMORY_LARGE_REPO_LOC_THRESHOLD', 'PHASE6_LARGE_REPO_LOC_THRESHOLD'],
  ];
  const out: NodeJS.ProcessEnv = { ...raw };
  for (const [canonical, legacy] of pairs) {
    if (out[canonical] === undefined && out[legacy] !== undefined) {
      out[canonical] = out[legacy];
    }
  }
  return out;
}

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  EMBEDDINGS_BASE_URL: z
    .string()
    .min(1, 'EMBEDDINGS_BASE_URL is required')
    .default('http://127.0.0.1:1234'),

  EMBEDDINGS_API_KEY: z.string().optional(),

  // From your curl command (OpenAI-compatible embeddings endpoint).
  EMBEDDINGS_MODEL: z.string().min(1, 'EMBEDDINGS_MODEL is required').default('mixedbread-ai/text-embedding-mxbai-embed-large-v1'),

  // When enabled, every MCP tool call must include `workspace_token` matching `CONTEXT_HUB_WORKSPACE_TOKEN`.
  // When disabled (default), `workspace_token` becomes optional for easier agent compliance.
  MCP_AUTH_ENABLED: z
    .preprocess(v => parseBooleanEnv(v), z.boolean().optional())
    .default(false),

  // Single MVP workspace token for all MCP tool calls.
  // Optional unless MCP_AUTH_ENABLED=true.
  CONTEXT_HUB_WORKSPACE_TOKEN: z.string().min(1, 'CONTEXT_HUB_WORKSPACE_TOKEN is required').optional(),

  // When provided, MCP tools may omit project_id and fallback to this default.
  // If a tool allows missing project_id and this env is missing, the tool returns Bad Request.
  DEFAULT_PROJECT_ID: z.string().min(1).optional(),

  MCP_PORT: z.coerce.number().int().positive().optional().default(3000),

  // Vector dimension must match the embedding model configured above.
  EMBEDDINGS_DIM: z.coerce.number().int().positive().optional().default(1024),

  // Chunking: number of lines per chunk for MVP.
  CHUNK_LINES: z.coerce.number().int().positive().optional().default(120),
  /** Skip workspace files larger than this when indexing (bytes). Logged via getEnv / indexer. */
  INDEX_MAX_FILE_BYTES: z.coerce.number().int().positive().optional().default(2_000_000),
  /** Default batch size for embedding chunks when `index_project` omits `embedding_batch_size`. */
  INDEX_EMBEDDING_BATCH_SIZE: z.coerce.number().int().positive().optional().default(8),

  /** Single-pass builder memory: sample at most this many files for the repo prompt. */
  BUILDER_MEMORY_SAMPLE_MAX_FILES: z.coerce.number().int().positive().optional().default(64),
  /** Truncate each sampled file to this many characters before adding to the prompt. */
  BUILDER_MEMORY_SAMPLE_MAX_FILE_CHARS: z.coerce.number().int().positive().optional().default(6000),
  /** Total character budget for the concatenated repo sample. */
  BUILDER_MEMORY_SAMPLE_MAX_TOTAL_CHARS: z.coerce.number().int().positive().optional().default(90_000),
  /**
   * Single-pass builder memory: max repo-sample characters per **map** LLM call (split on `--- FILE:` blocks).
   * Set >= SAMPLE_MAX_TOTAL_CHARS to keep one-shot synthesis (legacy behavior).
   */
  BUILDER_MEMORY_MAP_CHUNK_MAX_CHARS: z.coerce.number().int().positive().optional().default(28_000),
  /** `max_tokens` for each map call (partial notes). */
  BUILDER_MEMORY_MAP_MAX_TOKENS: z.coerce.number().int().positive().optional().default(2048),
  /** Parallel map calls (1 = sequential). */
  BUILDER_MEMORY_MAP_CONCURRENCY: z.coerce.number().int().positive().optional().default(2),
  /** Max combined partial-note characters per merge LLM call; larger inputs are merged in batches. */
  BUILDER_MEMORY_MERGE_MAX_INPUT_CHARS: z.coerce.number().int().positive().optional().default(56_000),
  /** `max_tokens` for merge step(s). */
  BUILDER_MEMORY_MERGE_MAX_TOKENS: z.coerce.number().int().positive().optional().default(4096),

  /** Manifest / LOC scan: ignore files larger than this (bytes). */
  MANIFEST_MAX_FILE_BYTES: z.coerce.number().int().positive().optional().default(2_000_000),
  /** Read full file for exact line count when size <= this many bytes. */
  MANIFEST_LINE_READ_MAX_BYTES: z.coerce.number().int().positive().optional().default(512_000),

  /** `compressText` output length clamp (chars). */
  DISTILLATION_COMPRESS_MIN_OUTPUT_CHARS: z.coerce.number().int().positive().optional().default(200),
  DISTILLATION_COMPRESS_MAX_OUTPUT_CHARS: z.coerce.number().int().positive().optional().default(32_000),

  /** RAPTOR `scaledSummaryCharBudget` bounds (per level). */
  RAPTOR_L1_SUMMARY_MIN_CHARS: z.coerce.number().int().positive().optional().default(1800),
  RAPTOR_L1_SUMMARY_MAX_CHARS: z.coerce.number().int().positive().optional().default(14_000),
  RAPTOR_L2_SUMMARY_MIN_CHARS: z.coerce.number().int().positive().optional().default(2000),
  RAPTOR_L2_SUMMARY_MAX_CHARS: z.coerce.number().int().positive().optional().default(16_000),

  /** QA summarization answer length bounds (when caller does not fix `maxChars`). */
  QA_SUMMARY_SCALED_MIN_CHARS: z.coerce.number().int().positive().optional().default(1200),
  QA_SUMMARY_SCALED_MAX_CHARS: z.coerce.number().int().positive().optional().default(8000),
  QA_SUMMARY_HARD_MAX_CHARS: z.coerce.number().int().positive().optional().default(16_000),
  /** Lower clamp for `qaSummarize` output length (chars). */
  QA_SUMMARY_OUTPUT_MIN_CHARS: z.coerce.number().int().positive().optional().default(200),
  QA_EVIDENCE_SCALED_MIN_CHARS: z.coerce.number().int().positive().optional().default(2200),
  QA_EVIDENCE_SCALED_MAX_CHARS: z.coerce.number().int().positive().optional().default(8000),
  QA_EVIDENCE_ANSWER_HARD_MAX_CHARS: z.coerce.number().int().positive().optional().default(12_000),
  /** Lower clamp for `qaAnswerFromEvidence` output length (chars). */
  QA_EVIDENCE_OUTPUT_MIN_CHARS: z.coerce.number().int().positive().optional().default(300),

  /** Upper bound on source character length when scaling summary budgets (llmCompletionBudget). */
  LLM_SUMMARY_SOURCE_CHAR_CEILING: z.coerce.number().int().positive().optional().default(2_000_000),

  /** search_code: substring snippet length in results. */
  RETRIEVAL_SNIPPET_MAX_CHARS: z.coerce.number().int().positive().optional().default(400),
  /** search_code: candidate pool size lower bound before ranking (higher = better recall, slower). */
  RETRIEVAL_CANDIDATE_POOL_MIN: z.coerce.number().int().positive().optional().default(40),
  /** search_code: candidate pool multiplier relative to requested topK. */
  RETRIEVAL_CANDIDATE_POOL_MULTIPLIER: z.coerce.number().int().positive().optional().default(6),
  /** search_code: hard cap for candidate pool to bound latency/cost. */
  RETRIEVAL_CANDIDATE_POOL_MAX: z.coerce.number().int().positive().optional().default(200),
  /** search_code: minimum semantic score for lessons used as source_ref priors. */
  RETRIEVAL_LESSON_PRIOR_MIN_SCORE: z.coerce.number().min(0).max(1).optional().default(0.62),
  /** search_code: MMR trade-off between relevance (1.0) and diversity (0.0). */
  RETRIEVAL_MMR_LAMBDA: z.coerce.number().min(0).max(1).optional().default(0.82),
  /** search_code: number of top candidates to apply MMR diversification on. */
  RETRIEVAL_MMR_WINDOW: z.coerce.number().int().positive().optional().default(80),
  /** LLM rerank JSON completion budget. */
  RERANK_LLM_MAX_TOKENS: z.coerce.number().int().positive().optional().default(250),

  /** Max generated documents processed per `indexGeneratedDocuments` pass. */
  GENERATED_INDEX_MAX_DOCS: z.coerce.number().int().positive().optional().default(5000),

  // Phase 3: OpenAI-compatible chat for distillation / reflect / compress (defaults to embeddings base URL).
  DISTILLATION_ENABLED: z
    .preprocess(v => parseBooleanEnv(v), z.boolean().optional())
    .default(false),
  DISTILLATION_BASE_URL: z.string().min(1).optional(),
  DISTILLATION_API_KEY: z.string().optional(),
  DISTILLATION_MODEL: z.string().min(1).optional(),
  DISTILLATION_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(12_000),
  REFLECT_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(5000),

  // Optional dedicated rerank model endpoint (fallbacks to DISTILLATION_* then EMBEDDINGS_*).
  RERANK_BASE_URL: z.string().min(1).optional(),
  RERANK_API_KEY: z.string().optional(),
  RERANK_MODEL: z.string().min(1).optional(),
  RERANK_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(1800),
  RERANK_CACHE_TTL_SECONDS: z.coerce.number().int().positive().optional().default(3600),

  // Optional dedicated QA agent model endpoint for FAQ/RAPTOR synthesis.
  QA_AGENT_BASE_URL: z.string().min(1).optional(),
  QA_AGENT_API_KEY: z.string().optional(),
  QA_AGENT_MODEL: z.string().min(1).optional(),
  QA_AGENT_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(12_000),
  /** One-shot summarization input cap; longer text uses head+tail excerpt (RAPTOR, qaSummarize). */
  QA_SUMMARIZE_MAX_INPUT_CHARS: z.coerce.number().int().positive().optional().default(120_000),
  /** Upper bound for dynamic `max_tokens` in summarization / compression. */
  LLM_COMPLETION_MAX_TOKENS_CAP: z.coerce.number().int().positive().optional().default(4096),

  // Optional dedicated Builder/QC/Judge agent model endpoints for Phase 6+ loops.
  // All are optional and may fallback to DISTILLATION_* (then EMBEDDINGS_* in callers).
  BUILDER_AGENT_BASE_URL: z.string().min(1).optional(),
  BUILDER_AGENT_API_KEY: z.string().optional(),
  BUILDER_AGENT_MODEL: z.string().min(1).optional(),
  /** Single-pass / hierarchical builder memory chat; large repo samples need well above 12s on local LLMs. */
  BUILDER_AGENT_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(120_000),
  QC_AGENT_BASE_URL: z.string().min(1).optional(),
  QC_AGENT_API_KEY: z.string().optional(),
  QC_AGENT_MODEL: z.string().min(1).optional(),
  QC_AGENT_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(12_000),
  JUDGE_AGENT_BASE_URL: z.string().min(1).optional(),
  JUDGE_AGENT_API_KEY: z.string().optional(),
  JUDGE_AGENT_MODEL: z.string().min(1).optional(),
  JUDGE_AGENT_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(12_000),

  // Phase 7: optional Redis cache for retrieval + rerank.
  REDIS_ENABLED: z
    .preprocess(v => parseBooleanEnv(v), z.boolean().optional())
    .default(false),
  REDIS_URL: z.string().min(1).optional().default('redis://redis:6379'),
  REDIS_PREFIX: z.string().min(1).optional().default('contexthub'),
  REDIS_RETRIEVAL_TTL_SECONDS: z.coerce.number().int().positive().optional().default(900),
  REDIS_RERANK_TTL_SECONDS: z.coerce.number().int().positive().optional().default(7200),

  // Production rollout: opt-in hybrid retrieval (semantic + lexical candidate expansion).
  RETRIEVAL_HYBRID_ENABLED: z
    .preprocess(v => parseBooleanEnv(v), z.boolean().optional())
    .default(false),
  RETRIEVAL_HYBRID_LEXICAL_LIMIT: z.coerce.number().int().positive().optional().default(12),

  // Phase 4: optional Neo4j graph store.
  KG_ENABLED: z
    .preprocess(v => parseBooleanEnv(v), z.boolean().optional())
    .default(false),
  NEO4J_URI: z.string().min(1).optional().default('bolt://127.0.0.1:7687'),
  NEO4J_USERNAME: z.string().min(1).optional().default('neo4j'),
  NEO4J_PASSWORD: z.string().min(1).optional().default('neo4jpassword'),

  // Phase 5: optional git intelligence automation.
  GIT_INGEST_ENABLED: z
    .preprocess(v => parseBooleanEnv(v), z.boolean().optional())
    .default(false),
  GIT_MAX_COMMITS_PER_RUN: z.coerce.number().int().positive().optional().default(200),

  // Async pipeline / queue worker.
  QUEUE_ENABLED: z
    .preprocess(v => parseBooleanEnv(v), z.boolean().optional())
    .default(false),
  QUEUE_BACKEND: z.enum(['postgres', 'rabbitmq']).optional().default('postgres'),
  JOB_QUEUE_NAME: z.string().min(1).optional().default('default'),
  RABBITMQ_URL: z.string().optional(),
  RABBITMQ_EXCHANGE: z.string().min(1).optional().default('contexthub.jobs'),

  // Repo/workspace source modes.
  REPO_CACHE_ROOT: z.string().min(1).optional().default('/data/repos'),
  SOURCE_STORAGE_MODE: z.enum(['local', 's3', 'hybrid']).optional().default('local'),
  WORKSPACE_SCAN_ENABLED: z
    .preprocess(v => parseBooleanEnv(v), z.boolean().optional())
    .default(false),

  // S3-compatible object storage (used by source artifacts in s3/hybrid mode).
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .preprocess(v => parseBooleanEnv(v), z.boolean().optional())
    .default(true),

  // Knowledge loop (FAQ/RAPTOR/deep jobs) + quality.eval gates — opt-in.
  KNOWLEDGE_LOOP_ENABLED: z
    .preprocess(v => parseBooleanEnv(v), z.boolean().optional())
    .default(false),
  QUALITY_EVAL_MIN_RECALL_AT3: z.coerce.number().optional().default(0),
  QUALITY_EVAL_MIN_RECALL_DELTA: z.coerce.number().optional().default(0),
  /** 0 = disabled. When set, candidate totals.p95_ms must be <= this value. */
  QUALITY_EVAL_MAX_P95_MS: z.coerce.number().int().min(0).optional().default(0),
  /** Comma-separated group names: when a baseline artifact exists, recall@3 must not drop vs baseline for these groups. */
  QUALITY_EVAL_NO_REGRESS_GROUPS: z.string().optional().default(''),
  QUALITY_EVAL_QUERIES_PATH: z.string().min(1).optional().default('qc/queries.json'),
  QUALITY_EVAL_KG_ASSIST: z
    .preprocess(v => parseBooleanEnv(v), z.boolean().optional())
    .default(false),
  /** Stored benchmark_artifact doc_key for baseline JSON (quality eval). */
  QUALITY_EVAL_BASELINE_DOC_KEY: z.string().min(1).optional().default('quality_eval/baseline'),
  /** When true, deep loop round 1 may synthesize builder-memory artifacts (uses BUILDER_AGENT_* or DISTILLATION_*). */
  BUILDER_MEMORY_ENABLED: z
    .preprocess(v => parseBooleanEnv(v), z.boolean().optional())
    .default(true),
  /** Estimated LOC above this uses hierarchical builder memory in deep loop (unless disabled). 0 = only `payload.large_repo`. */
  BUILDER_MEMORY_LARGE_REPO_LOC_THRESHOLD: z.coerce.number().int().min(0).optional().default(500_000),
  /** Max directory/language shards for `knowledge.memory.build` and inline large-repo path. */
  MEMORY_BUILD_MAX_SHARDS: z.coerce.number().int().positive().optional().default(50),
  MEMORY_BUILD_SHARD_MAX_FILES: z.coerce.number().int().positive().optional().default(32),
  MEMORY_BUILD_SHARD_MAX_CHARS: z.coerce.number().int().positive().optional().default(80_000),
  MEMORY_BUILD_SHARD_MAX_FILE_CHARS: z.coerce.number().int().positive().optional().default(6000),
  MEMORY_BUILD_MODULE_MAX_INPUT_CHARS: z.coerce.number().int().positive().optional().default(100_000),
  MEMORY_BUILD_GLOBAL_MAX_INPUT_CHARS: z.coerce.number().int().positive().optional().default(120_000),
  MEMORY_BUILD_LEAF_MAX_TOKENS: z.coerce.number().int().positive().optional().default(4096),
  MEMORY_BUILD_MODULE_MAX_TOKENS: z.coerce.number().int().positive().optional().default(6144),
  MEMORY_BUILD_GLOBAL_MAX_TOKENS: z.coerce.number().int().positive().optional().default(8192),
}).superRefine((val, ctx) => {
  if (val.MCP_AUTH_ENABLED && (!val.CONTEXT_HUB_WORKSPACE_TOKEN || val.CONTEXT_HUB_WORKSPACE_TOKEN.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CONTEXT_HUB_WORKSPACE_TOKEN'],
      message: 'CONTEXT_HUB_WORKSPACE_TOKEN is required when MCP_AUTH_ENABLED=true',
    });
  }
  if (val.DISTILLATION_ENABLED && (!val.DISTILLATION_MODEL || !val.DISTILLATION_MODEL.trim())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DISTILLATION_MODEL'],
      message: 'DISTILLATION_MODEL is required when DISTILLATION_ENABLED=true',
    });
  }
  if (val.KG_ENABLED) {
    if (!val.NEO4J_URI || !val.NEO4J_URI.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NEO4J_URI'],
        message: 'NEO4J_URI is required when KG_ENABLED=true',
      });
    }
    if (!val.NEO4J_USERNAME || !val.NEO4J_USERNAME.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NEO4J_USERNAME'],
        message: 'NEO4J_USERNAME is required when KG_ENABLED=true',
      });
    }
    if (!val.NEO4J_PASSWORD || !val.NEO4J_PASSWORD.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NEO4J_PASSWORD'],
        message: 'NEO4J_PASSWORD is required when KG_ENABLED=true',
      });
    }
  }
  if (val.QUEUE_ENABLED && val.QUEUE_BACKEND === 'rabbitmq' && (!val.RABBITMQ_URL || !val.RABBITMQ_URL.trim())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['RABBITMQ_URL'],
      message: 'RABBITMQ_URL is required when QUEUE_ENABLED=true and QUEUE_BACKEND=rabbitmq',
    });
  }
  if ((val.SOURCE_STORAGE_MODE === 's3' || val.SOURCE_STORAGE_MODE === 'hybrid')
    && (!val.S3_ENDPOINT || !val.S3_BUCKET || !val.S3_ACCESS_KEY_ID || !val.S3_SECRET_ACCESS_KEY)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SOURCE_STORAGE_MODE'],
      message: 'S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY are required when SOURCE_STORAGE_MODE is s3/hybrid',
    });
  }
  if (val.DISTILLATION_COMPRESS_MAX_OUTPUT_CHARS < val.DISTILLATION_COMPRESS_MIN_OUTPUT_CHARS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DISTILLATION_COMPRESS_MAX_OUTPUT_CHARS'],
      message: 'must be >= DISTILLATION_COMPRESS_MIN_OUTPUT_CHARS',
    });
  }
  if (val.RAPTOR_L1_SUMMARY_MAX_CHARS < val.RAPTOR_L1_SUMMARY_MIN_CHARS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['RAPTOR_L1_SUMMARY_MAX_CHARS'],
      message: 'must be >= RAPTOR_L1_SUMMARY_MIN_CHARS',
    });
  }
  if (val.RAPTOR_L2_SUMMARY_MAX_CHARS < val.RAPTOR_L2_SUMMARY_MIN_CHARS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['RAPTOR_L2_SUMMARY_MAX_CHARS'],
      message: 'must be >= RAPTOR_L2_SUMMARY_MIN_CHARS',
    });
  }
  if (val.QA_SUMMARY_SCALED_MAX_CHARS < val.QA_SUMMARY_SCALED_MIN_CHARS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['QA_SUMMARY_SCALED_MAX_CHARS'],
      message: 'must be >= QA_SUMMARY_SCALED_MIN_CHARS',
    });
  }
  if (val.QA_SUMMARY_HARD_MAX_CHARS < val.QA_SUMMARY_SCALED_MAX_CHARS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['QA_SUMMARY_HARD_MAX_CHARS'],
      message: 'must be >= QA_SUMMARY_SCALED_MAX_CHARS',
    });
  }
  if (val.QA_EVIDENCE_SCALED_MAX_CHARS < val.QA_EVIDENCE_SCALED_MIN_CHARS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['QA_EVIDENCE_SCALED_MAX_CHARS'],
      message: 'must be >= QA_EVIDENCE_SCALED_MIN_CHARS',
    });
  }
  if (val.QA_EVIDENCE_ANSWER_HARD_MAX_CHARS < val.QA_EVIDENCE_SCALED_MAX_CHARS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['QA_EVIDENCE_ANSWER_HARD_MAX_CHARS'],
      message: 'must be >= QA_EVIDENCE_SCALED_MAX_CHARS',
    });
  }
});

export type Env = z.infer<typeof EnvSchema>;

export function getEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(migrateLegacyEnvKeys(raw));
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}

