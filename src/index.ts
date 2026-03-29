import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';

import {
  getEnv,
  createModuleLogger,
  applyMigrations,
  bootstrapKgIfEnabled,
  logStartupEnvSummary,
} from './core/index.js';
import { createMcpToolsServer } from './mcp/index.js';
import { createApiApp } from './api/index.js';

const logger = createModuleLogger('main');

async function main() {
  const env = getEnv();
  logStartupEnvSummary();
  await applyMigrations();
  await bootstrapKgIfEnabled().catch(err => {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'kg bootstrap failed');
  });

  // ── MCP Server (:3000) ──
  const mcpApp = createMcpExpressApp();

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

  process.on('SIGINT', () => process.exit(0));
}

main().catch(err => {
  logger.fatal({ error: err instanceof Error ? err.message : String(err) }, 'Fatal startup error');
  process.exit(1);
});
