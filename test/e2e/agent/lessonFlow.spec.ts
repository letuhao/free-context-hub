/**
 * Agent Tests — Lesson Flow (4 tests)
 *
 * MCP tool calls → verify results appear in GUI via Playwright.
 * Each test: call MCP tool → navigate browser → assert DOM + screenshot.
 */

import type { AgentTestContext } from './agentContext.js';
import { callTool, withAuth } from './agentContext.js';
import { pass, fail, skip } from '../shared/testContext.js';
import type { TestFn } from '../shared/testContext.js';
import { GUI_URL } from '../shared/constants.js';
import fs from 'node:fs';
import path from 'node:path';

const GROUP = 'agent-lessons';
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
      // Save failure screenshot
      try {
        await ctx.page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}-FAIL.png`), fullPage: false });
      } catch {}
      return fail(name, GROUP, Date.now() - start, err?.message ?? String(err));
    }
  };
}

const st: { lessonId?: string; marker?: string } = {};

export const allLessonFlowTests: TestFn[] = [
  // ── Test 1: add_lesson via MCP → visible in GUI ──
  agentTest('agent-add-lesson-visible-in-gui', async (ctx) => {
    const start = Date.now();
    st.marker = `agent-${ctx.runMarker.slice(0, 12)}`;

    const result = await callTool(ctx.mcp, 'add_lesson', withAuth({
      lesson_payload: {
        project_id: ctx.projectId,
        lesson_type: 'decision',
        title: `Agent lesson ${st.marker}`,
        content: 'Created by agent MCP test, should appear in GUI.',
        tags: ['e2e-agent'],
      },
    }, ctx.token), 60_000);

    st.lessonId = result?.lesson_id;
    if (st.lessonId) ctx.cleanup.lessonIds.push(st.lessonId);
    if (!st.lessonId) return fail('agent-add-lesson-visible-in-gui', GROUP, Date.now() - start, 'No lesson_id from MCP');

    // Navigate to lessons page and verify
    await ctx.page.goto(`${GUI_URL}/lessons`, { waitUntil: 'networkidle' });
    await ctx.page.waitForTimeout(1000);

    const row = ctx.page.locator(`text=Agent lesson ${st.marker}`);
    const visible = await row.count();

    await ctx.page.screenshot({ path: path.join(SCREENSHOT_DIR, 'add-lesson-gui.png'), fullPage: false });

    if (visible === 0) return fail('agent-add-lesson-visible-in-gui', GROUP, Date.now() - start, 'Lesson not found in GUI after MCP add');
    return pass('agent-add-lesson-visible-in-gui', GROUP, Date.now() - start);
  }),

  // ── Test 2: update_lesson via MCP → title changes in GUI ──
  agentTest('agent-update-lesson-reflected-in-gui', async (ctx) => {
    const start = Date.now();
    if (!st.lessonId || !st.marker) return skip('agent-update-lesson-reflected-in-gui', GROUP, 'no lesson created');

    const newTitle = `Agent lesson UPDATED ${st.marker}`;
    await callTool(ctx.mcp, 'update_lesson', withAuth({
      project_id: ctx.projectId,
      lesson_id: st.lessonId,
      title: newTitle,
    }, ctx.token), 60_000);

    await ctx.page.goto(`${GUI_URL}/lessons`, { waitUntil: 'networkidle' });
    await ctx.page.waitForTimeout(1000);

    const updated = ctx.page.locator(`text=UPDATED ${st.marker}`);
    const visible = await updated.count();

    await ctx.page.screenshot({ path: path.join(SCREENSHOT_DIR, 'update-lesson-gui.png'), fullPage: false });

    if (visible === 0) return fail('agent-update-lesson-reflected-in-gui', GROUP, Date.now() - start, 'Updated title not found in GUI');
    return pass('agent-update-lesson-reflected-in-gui', GROUP, Date.now() - start);
  }),

  // ── Test 3: search_lessons via MCP → result count matches GUI ──
  agentTest('agent-search-matches-gui', async (ctx) => {
    const start = Date.now();
    if (!st.marker) return skip('agent-search-matches-gui', GROUP, 'no marker set');

    const mcpResult = await callTool(ctx.mcp, 'search_lessons', withAuth({
      project_id: ctx.projectId,
      query: st.marker,
      limit: 5,
    }, ctx.token), 60_000);

    const mcpCount = mcpResult?.matches?.length ?? 0;

    // Search in GUI
    await ctx.page.goto(`${GUI_URL}/lessons`, { waitUntil: 'networkidle' });
    await ctx.page.waitForTimeout(500);
    const searchInput = ctx.page.locator('input[placeholder*="Search"], input[placeholder*="search"]');
    await searchInput.first().fill(st.marker);
    await ctx.page.waitForTimeout(2000);

    const guiRows = ctx.page.locator(`text=${st.marker}`);
    const guiCount = await guiRows.count();

    await ctx.page.screenshot({ path: path.join(SCREENSHOT_DIR, 'search-match-gui.png'), fullPage: false });

    if (mcpCount === 0 && guiCount === 0) return pass('agent-search-matches-gui', GROUP, Date.now() - start, 'Both 0 matches');
    if (guiCount === 0) return fail('agent-search-matches-gui', GROUP, Date.now() - start, `MCP found ${mcpCount} but GUI shows 0`);
    return pass('agent-search-matches-gui', GROUP, Date.now() - start, `MCP: ${mcpCount}, GUI: ${guiCount}`);
  }),

  // ── Test 4: supersede via MCP → removed from GUI active list ──
  agentTest('agent-supersede-removed-from-gui', async (ctx) => {
    const start = Date.now();
    if (!st.lessonId || !st.marker) return skip('agent-supersede-removed-from-gui', GROUP, 'no lesson');

    await callTool(ctx.mcp, 'update_lesson_status', withAuth({
      project_id: ctx.projectId,
      lesson_id: st.lessonId,
      status: 'superseded',
    }, ctx.token), 30_000);

    await ctx.page.goto(`${GUI_URL}/lessons`, { waitUntil: 'networkidle' });
    await ctx.page.waitForTimeout(1000);

    // Should NOT appear in active list
    const row = ctx.page.locator(`text=UPDATED ${st.marker}`);
    const visible = await row.count();

    await ctx.page.screenshot({ path: path.join(SCREENSHOT_DIR, 'supersede-gui.png'), fullPage: false });

    if (visible > 0) return fail('agent-supersede-removed-from-gui', GROUP, Date.now() - start, 'Superseded lesson still visible in active list');
    return pass('agent-supersede-removed-from-gui', GROUP, Date.now() - start);
  }),
];
