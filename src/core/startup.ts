import { getEnv } from '../env.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('startup');

function maskDatabaseUrl(databaseUrl: string) {
  try {
    const u = new URL(databaseUrl);
    if (u.password) u.password = '***';
    if (u.username) u.username = u.username; // keep username
    return u.toString();
  } catch {
    // Fallback: remove anything that looks like "://user:pass@"
    return databaseUrl.replace(/:\/\/([^:@\/\s]+):([^@\/\s]+)@/g, '://$1:***@');
  }
}

export function logStartupEnvSummary() {
  const env = getEnv();
  const safe = {
    MCP_PORT: env.MCP_PORT,
    API_PORT: env.API_PORT,
    MCP_AUTH_ENABLED: env.MCP_AUTH_ENABLED,
    DEFAULT_PROJECT_ID: env.DEFAULT_PROJECT_ID ?? null,
    DATABASE_URL: maskDatabaseUrl(env.DATABASE_URL),
    EMBEDDINGS_BASE_URL: env.EMBEDDINGS_BASE_URL,
    EMBEDDINGS_MODEL: env.EMBEDDINGS_MODEL,
    EMBEDDINGS_DIM: env.EMBEDDINGS_DIM,
    CHUNK_LINES: env.CHUNK_LINES,
    INDEX_MAX_FILE_BYTES: env.INDEX_MAX_FILE_BYTES,
    INDEX_EMBEDDING_BATCH_SIZE: env.INDEX_EMBEDDING_BATCH_SIZE,
    GENERATED_INDEX_MAX_DOCS: env.GENERATED_INDEX_MAX_DOCS,
    RETRIEVAL_SNIPPET_MAX_CHARS: env.RETRIEVAL_SNIPPET_MAX_CHARS,
    RERANK_LLM_MAX_TOKENS: env.RERANK_LLM_MAX_TOKENS,
    LLM_SUMMARY_SOURCE_CHAR_CEILING: env.LLM_SUMMARY_SOURCE_CHAR_CEILING,
    // Never print secrets (token / API key)
    CONTEXT_HUB_WORKSPACE_TOKEN: env.CONTEXT_HUB_WORKSPACE_TOKEN ? '[set]' : '[not set]',
    EMBEDDINGS_API_KEY: env.EMBEDDINGS_API_KEY ? '[set]' : '[not set]',
    DISTILLATION_ENABLED: env.DISTILLATION_ENABLED,
    DISTILLATION_BASE_URL: env.DISTILLATION_BASE_URL ?? null,
    DISTILLATION_MODEL: env.DISTILLATION_MODEL ?? null,
    KG_ENABLED: env.KG_ENABLED,
    NEO4J_URI: env.NEO4J_URI,
    NEO4J_USERNAME: env.NEO4J_USERNAME ? '[set]' : '[not set]',
    GIT_INGEST_ENABLED: env.GIT_INGEST_ENABLED,
    GIT_MAX_COMMITS_PER_RUN: env.GIT_MAX_COMMITS_PER_RUN,
    QUEUE_ENABLED: env.QUEUE_ENABLED,
    QUEUE_BACKEND: env.QUEUE_BACKEND,
    JOB_QUEUE_NAME: env.JOB_QUEUE_NAME,
    RABBITMQ_URL: env.RABBITMQ_URL ? '[set]' : '[not set]',
    RABBITMQ_EXCHANGE: env.RABBITMQ_EXCHANGE,
    REPO_CACHE_ROOT: env.REPO_CACHE_ROOT,
    SOURCE_STORAGE_MODE: env.SOURCE_STORAGE_MODE,
    WORKSPACE_SCAN_ENABLED: env.WORKSPACE_SCAN_ENABLED,
    S3_ENDPOINT: env.S3_ENDPOINT ?? null,
    S3_REGION: env.S3_REGION ?? null,
    S3_BUCKET: env.S3_BUCKET ?? null,
    S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID ? '[set]' : '[not set]',
    S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY ? '[set]' : '[not set]',
    S3_FORCE_PATH_STYLE: env.S3_FORCE_PATH_STYLE,
    KNOWLEDGE_LOOP_ENABLED: env.KNOWLEDGE_LOOP_ENABLED,
    BUILDER_MEMORY_ENABLED: env.BUILDER_MEMORY_ENABLED,
  };
  logger.info({ env: safe }, 'startup env summary');
}
