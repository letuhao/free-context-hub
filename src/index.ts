import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';

import {
  getEnv,
  createModuleLogger,
  applyMigrations,
  bootstrapKgIfEnabled,
  logStartupEnvSummary,
  prewarmReranker,
} from './core/index.js';
import { createMcpToolsServer } from './mcp/index.js';
import { createApiApp } from './api/index.js';
import { startSweepScheduler } from './services/sweepScheduler.js';  // Phase 13 Sprint 13.2
import { startClaimsSweepScheduler } from './services/coordinationSweep.js';  // Phase 15 Sprint 15.2

const logger = createModuleLogger('main');

async function main() {
  const env = getEnv();
  logStartupEnvSummary();
  await applyMigrations();
  await bootstrapKgIfEnabled().catch(err => {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'kg bootstrap failed');
  });

  // 2026-06-16 — prewarm the cross-encoder rerank model (non-blocking, best-effort).
  void prewarmReranker();

  // Phase 13 Sprint 13.2 — background TTL sweep for artifact_leases.
  startSweepScheduler();

  // Phase 15 Sprint 15.2 — background sweep that recovers abandoned claims.
  startClaimsSweepScheduler();

  // Phase 13 Sprint 13.5 — seed built-in taxonomy profiles from config/taxonomy-profiles/.
  const { bootstrapBuiltinTaxonomyProfiles } = await import('./services/taxonomyBootstrap.js');
  await bootstrapBuiltinTaxonomyProfiles().catch((err) => {
    logger.error({ err: String(err) }, 'taxonomy bootstrap failed (non-fatal)');
  });

  // ── MCP Server (:3000) ──
  // Keep the SDK's DNS-rebinding protection, but allow the hostnames the MCP
  // endpoint is reached under — localhost (host-side tooling) plus the internal
  // service name the single-port gateway proxies from (Host: mcp). Configurable
  // via MCP_ALLOWED_HOSTS for other deployments/proxy hostnames.
  const allowedHosts = env.MCP_ALLOWED_HOSTS.split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  const mcpApp = createMcpExpressApp({ allowedHosts });

  // Stateless MCP server: each request gets a fresh transport.
  // No session IDs, no stale session errors.
  mcpApp.post('/mcp', async (req: any, res: any) => {
    try {
      const server = createMcpToolsServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req as any, res as any, req.body);
    } catch (error) {
      logger.error({ error }, 'mcp request error');
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  mcpApp.get('/mcp', async (req: any, res: any) => {
    try {
      const server = createMcpToolsServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req as any, res as any);
    } catch (error) {
      logger.error({ error }, 'mcp GET error');
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  mcpApp.listen(env.MCP_PORT, () => {
    logger.info({ port: env.MCP_PORT, path: '/mcp' }, 'MCP server listening');
  });

  // ── REST API (:3001) ──
  const apiApp = createApiApp();

  apiApp.listen(env.API_PORT, () => {
    logger.info({ port: env.API_PORT, prefix: '/api' }, 'REST API listening');
  });

  // Security posture warning: with auth off, the single-port gateway is an
  // unauthenticated proxy to the full MCP/REST surface. Safe for a loopback /
  // trusted-network self-host; dangerous if the gateway port is publicly
  // exposed. The gateway's cross-site guard still blocks browser-driven attacks,
  // but does not authenticate direct (curl/SDK) callers.
  if (!env.MCP_AUTH_ENABLED) {
    logger.warn(
      'MCP_AUTH_ENABLED=false — backend is UNAUTHENTICATED. Anyone who can reach '
        + 'the gateway port can call all MCP tools and REST endpoints. Set '
        + 'MCP_AUTH_ENABLED=true and use scoped api_keys for any non-localhost deployment.',
    );
  }

  process.on('SIGINT', () => process.exit(0));
}

main().catch(err => {
  logger.fatal({ error: err instanceof Error ? err.message : String(err) }, 'Fatal startup error');
  process.exit(1);
});
