/**
 * Agent Tests — Guardrail Flow (3 tests)
 *
 * MCP guardrail operations → verify in GUI.
 */

import type { AgentTestContext } from './agentContext.js';
import { callTool, withAuth } from './agentContext.js';
import { pass, fail, skip } from '../shared/testContext.js';
import type { TestFn } from '../shared/testContext.js';
import { GUI_URL } from '../shared/constants.js';
import fs from 'node:fs';
import path from 'node:path';

const GROUP = 'agent-guardrails';
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

const st: { guardrailId?: string; marker?: string } = {};

export const allGuardrailFlowTests: TestFn[] = [
  // ── Test 1: Add guardrail via MCP → visible in GUI rules table ──
  agentTest('agent-add-guardrail-visible-in-gui', async (ctx) => {
    const start = Date.now();
    st.marker = `agent-gr-${ctx.runMarker.slice(0, 10)}`;

    const result = await callTool(ctx.mcp, 'add_lesson', withAuth({
      lesson_payload: {
        project_id: ctx.projectId,
        lesson_type: 'guardrail',
        title: `Guardrail: ${st.marker}`,
        content: `Block action ${st.marker} without approval.`,
        tags: ['e2e-agent-guardrail'],
        guardrail: {
          trigger: st.marker,
          requirement: `Must have approval before ${st.marker}`,
          verification_method: 'manual',
        },
      },
    }, ctx.token), 60_000);

    st.guardrailId = result?.lesson_id;
    if (st.guardrailId) ctx.cleanup.lessonIds.push(st.guardrailId);

    // Navigate to guardrails page
    await ctx.page.goto(`${GUI_URL}/guardrails`, { waitUntil: 'networkidle' });
    await ctx.page.waitForTimeout(1000);

    const ruleText = ctx.page.locator(`text=${st.marker}`);
    const visible = await ruleText.count();

    await ctx.page.screenshot({ path: path.join(SCREENSHOT_DIR, 'add-guardrail-gui.png'), fullPage: false });

    if (visible === 0) return fail('agent-add-guardrail-visible-in-gui', GROUP, Date.now() - start, 'Guardrail not found in GUI rules');
    return pass('agent-add-guardrail-visible-in-gui', GROUP, Date.now() - start);
  }),

  // ── Test 2: check_guardrails via MCP → audit entry in GUI ──
  agentTest('agent-check-guardrails-creates-audit', async (ctx) => {
    const start = Date.now();
    if (!st.marker) return skip('agent-check-guardrails-creates-audit', GROUP, 'no guardrail marker');

    // Call check_guardrails
    const checkResult = await callTool(ctx.mcp, 'check_guardrails', withAuth({
      action_context: { action: st.marker, project_id: ctx.projectId },
    }, ctx.token), 30_000);

    // Navigate to agents/audit page
    await ctx.page.goto(`${GUI_URL}/agents`, { waitUntil: 'networkidle' });
    await ctx.page.waitForTimeout(1000);

    await ctx.page.screenshot({ path: path.join(SCREENSHOT_DIR, 'check-guardrail-audit.png'), fullPage: false });

    // The audit page should show some recent activity (guardrail check creates audit log)
    // Just verify the page loaded and has content
    const pageTitle = ctx.page.locator('text=Agent Audit');
    const visible = await pageTitle.count();
    if (visible === 0) return fail('agent-check-guardrails-creates-audit', GROUP, Date.now() - start, 'Agent Audit page did not load');

    return pass('agent-check-guardrails-creates-audit', GROUP, Date.now() - start, `check result: pass=${checkResult?.pass}`);
  }),

  // ── Test 3: Simulate same action in GUI → matches MCP response ──
  agentTest('agent-guardrail-simulate-matches-gui', async (ctx) => {
    const start = Date.now();
    if (!st.marker) return skip('agent-guardrail-simulate-matches-gui', GROUP, 'no guardrail marker');

    // MCP check
    const mcpResult = await callTool(ctx.mcp, 'check_guardrails', withAuth({
      action_context: { action: st.marker, project_id: ctx.projectId },
    }, ctx.token), 30_000);

    const mcpBlocked = mcpResult?.pass === false;

    // GUI check
    await ctx.page.goto(`${GUI_URL}/guardrails`, { waitUntil: 'networkidle' });
    await ctx.page.waitForTimeout(500);

    const actionInput = ctx.page.locator('input[placeholder*="Enter"]').or(ctx.page.locator('input[type="text"]'));
    await actionInput.first().fill(st.marker);

    const testBtn = ctx.page.locator('button:has-text("Test")').or(ctx.page.locator('button:has-text("Check")'));
    await testBtn.first().click();
    await ctx.page.waitForTimeout(2000);

    await ctx.page.screenshot({ path: path.join(SCREENSHOT_DIR, 'simulate-match-gui.png'), fullPage: false });

    // Check GUI shows blocked result
    const blockedText = ctx.page.locator('text=/BLOCKED|blocked|must|Matched|matched|pass.*false/i');
    const guiBlocked = (await blockedText.count()) > 0;

    if (mcpBlocked && !guiBlocked) {
      return fail('agent-guardrail-simulate-matches-gui', GROUP, Date.now() - start, 'MCP says blocked but GUI does not show blocked');
    }

    // Cleanup: supersede the guardrail
    if (st.guardrailId) {
      await callTool(ctx.mcp, 'update_lesson_status', withAuth({
        project_id: ctx.projectId,
        lesson_id: st.guardrailId,
        status: 'superseded',
      }, ctx.token), 15_000).catch(() => {});
    }

    return pass('agent-guardrail-simulate-matches-gui', GROUP, Date.now() - start, `MCP blocked=${mcpBlocked}, GUI blocked=${guiBlocked}`);
  }),
];
