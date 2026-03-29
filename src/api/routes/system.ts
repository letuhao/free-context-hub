import { Router } from 'express';
import { getEnv } from '../../core/index.js';

const router = Router();

/** GET /api/system/health — basic health check */
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/** GET /api/system/info — server info + feature flags */
router.get('/info', (_req, res) => {
  const env = getEnv();
  res.json({
    name: 'contexthub-self-hosted',
    version: '0.1.0',
    mcp_port: env.MCP_PORT,
    api_port: env.API_PORT,
    features: {
      embeddings: { enabled: true, model: env.EMBEDDINGS_MODEL },
      distillation: { enabled: env.DISTILLATION_ENABLED, model: env.DISTILLATION_MODEL ?? null },
      rerank: { enabled: true, model: env.RERANK_MODEL ?? env.DISTILLATION_MODEL ?? null, type: env.RERANK_TYPE },
      knowledge_graph: { enabled: env.KG_ENABLED },
      queue: { enabled: env.QUEUE_ENABLED, backend: env.QUEUE_BACKEND },
      git_ingest: { enabled: env.GIT_INGEST_ENABLED },
      builder_memory: { enabled: env.BUILDER_MEMORY_ENABLED },
      knowledge_loop: { enabled: env.KNOWLEDGE_LOOP_ENABLED },
      redis_cache: { enabled: Boolean(env.REDIS_ENABLED) },
      workspace_scan: { enabled: env.WORKSPACE_SCAN_ENABLED },
    },
  });
});

export { router as systemRouter };
