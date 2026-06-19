import { Router } from 'express';
import { getEnv } from '../../core/index.js';

// Public router: liveness only. Mounted BEFORE bearerAuth so health checks /
// load balancers can probe without a token. Must not leak any configuration.
const publicRouter = Router();

/** GET /api/system/health — basic health check (public) */
publicRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Authed router: server info + feature flags. Mounted AFTER bearerAuth — this
// payload (model names, enabled features, ports) is useful recon for an
// attacker, so it must not be reachable unauthenticated through the gateway.
const router = Router();

/** GET /api/system/info — server info + feature flags (requires auth) */
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

export { router as systemRouter, publicRouter as publicSystemRouter };
