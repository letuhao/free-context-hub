/**
 * Agent test context — combines MCP client + Playwright browser
 * for cross-layer visual verification tests.
 */

import { chromium, type Browser, type Page } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connectMcp, callTool, withAuth } from '../shared/mcpClient.js';
import { CleanupRegistry } from '../shared/cleanup.js';
import { MCP_URL, GUI_URL, ADMIN_TOKEN, RUN_MARKER } from '../shared/constants.js';

/** Agent tests use the GUI's default project so MCP changes appear in the browser. */
const AGENT_PROJECT_ID = process.env.AGENT_PROJECT_ID ?? 'free-context-hub';

export type AgentTestContext = {
  mcp: Client;
  browser: Browser;
  page: Page;
  projectId: string;
  token: string;
  runMarker: string;
  cleanup: CleanupRegistry;
};

export async function bootstrapAgentContext(): Promise<AgentTestContext> {
  const mcp = await connectMcp(MCP_URL);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();

  // Ensure project exists
  try {
    await callTool(mcp, 'add_lesson', withAuth({
      lesson_payload: {
        project_id: AGENT_PROJECT_ID,
        lesson_type: 'decision',
        title: `Agent context bootstrap ${RUN_MARKER}`,
        content: 'Bootstrap lesson for agent tests — will be archived.',
        tags: ['e2e-agent-bootstrap'],
      },
    }, ADMIN_TOKEN), 60_000);
  } catch {
    // Project may already exist
  }

  const cleanup = new CleanupRegistry();

  return { mcp, browser, page, projectId: AGENT_PROJECT_ID, token: ADMIN_TOKEN, runMarker: RUN_MARKER, cleanup };
}

export async function teardownAgentContext(ctx: AgentTestContext): Promise<void> {
  await ctx.cleanup.runAll(ctx.projectId);
  try { await ctx.browser.close(); } catch {}
  try { await ctx.mcp.close(); } catch {}
}

export { callTool, withAuth };
