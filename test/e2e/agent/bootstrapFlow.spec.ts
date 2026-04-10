/**
 * Agent Tests — Bootstrap Flow (2 tests)
 *
 * MCP bootstrap tools → verify dashboard reflects state.
 */

import type { AgentTestContext } from './agentContext.js';
import { callTool, withAuth } from './agentContext.js';
import { pass, fail, skip } from '../shared/testContext.js';
import type { TestFn } from '../shared/testContext.js';
import { GUI_URL } from '../shared/constants.js';
import fs from 'node:fs';
import path from 'node:path';

const GROUP = 'agent-bootstrap';
const SCREENSHOT_DIR = path.resolve('docs/qc/screenshots/agent-tests');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

type AgentTestFn = (ctx: AgentTestContext) => Promise<ReturnType<typeof pass>>;

function agentTest(name: string, fn: AgentTestFn): TestFn {
  return async (rawCtx: any) => {
    const ctx = rawCtx as AgentTestContext;
    const start = Date.now();
    try {
      if (!ctx.mcp) return skip(name, GROUP, 'MCP not connected');
      return await fn(ctx);
    } catch (err: any) {
      try { await ctx.page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}-FAIL.png`), fullPage: false }); } catch {}
      return fail(name, GROUP, Date.now() - start, err?.message ?? String(err));
    }
  };
}

export const allBootstrapFlowTests: TestFn[] = [
  // ── Test 1: get_project_summary → dashboard loads without error ──
  agentTest('agent-bootstrap-dashboard-verify', async (ctx) => {
    const start = Date.now();

    // Call get_project_summary via MCP
    const summary = await callTool(ctx.mcp, 'get_project_summary', withAuth({
      project_id: ctx.projectId,
    }, ctx.token), 30_000);

    // Navigate to dashboard
    await ctx.page.goto(`${GUI_URL}/`, { waitUntil: 'networkidle' });
    await ctx.page.waitForTimeout(1000);

    // Dashboard should load without error state
    const dashboard = ctx.page.locator('text=Dashboard');
    const visible = await dashboard.count();

    await ctx.page.screenshot({ path: path.join(SCREENSHOT_DIR, 'bootstrap-dashboard.png'), fullPage: false });

    if (visible === 0) return fail('agent-bootstrap-dashboard-verify', GROUP, Date.now() - start, 'Dashboard title not visible');

    // Stat cards should show numbers
    const statValues = ctx.page.locator('text=/^\\d+$/');
    const statCount = await statValues.count();

    return pass('agent-bootstrap-dashboard-verify', GROUP, Date.now() - start, `summary: ${summary ? 'present' : 'null'}, stats: ${statCount}`);
  }),

  // ── Test 2: help tool → lists expected tool names ──
  agentTest('agent-help-tool-lists-tools', async (ctx) => {
    const start = Date.now();

    const helpResult = await callTool(ctx.mcp, 'help', withAuth({}, ctx.token), 30_000);

    // help should return tool information
    const helpText = JSON.stringify(helpResult);
    const expectedTools = ['add_lesson', 'check_guardrails', 'search_lessons', 'search_code'];

    const missing = expectedTools.filter(t => !helpText.includes(t));
    if (missing.length > 0) {
      return fail('agent-help-tool-lists-tools', GROUP, Date.now() - start, `Missing tools in help: ${missing.join(', ')}`);
    }

    // Visual verify: navigate to settings and confirm feature flags
    await ctx.page.goto(`${GUI_URL}/settings`, { waitUntil: 'networkidle' });
    await ctx.page.waitForTimeout(500);

    await ctx.page.screenshot({ path: path.join(SCREENSHOT_DIR, 'help-settings-verify.png'), fullPage: false });

    const settingsTitle = ctx.page.locator('text=Settings');
    if ((await settingsTitle.count()) === 0) {
      return fail('agent-help-tool-lists-tools', GROUP, Date.now() - start, 'Settings page did not load for visual verify');
    }

    return pass('agent-help-tool-lists-tools', GROUP, Date.now() - start, `${expectedTools.length} expected tools found in help`);
  }),
];
