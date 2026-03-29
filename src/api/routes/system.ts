import { Router } from 'express';
import { getEnv } from '../../core/index.js';

const router = Router();

/** GET /api/system/health — basic health check */
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/** GET /api/system/info — non-sensitive server info */
router.get('/info', (_req, res) => {
  const env = getEnv();
  res.json({
    name: 'contexthub-self-hosted',
    version: '0.1.0',
    mcp_port: env.MCP_PORT,
    api_port: env.API_PORT,
    kg_enabled: env.KG_ENABLED,
    queue_enabled: env.QUEUE_ENABLED,
    git_ingest_enabled: env.GIT_INGEST_ENABLED,
  });
});

export { router as systemRouter };
