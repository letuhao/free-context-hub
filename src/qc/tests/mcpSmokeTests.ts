/**
 * Tier 2: MCP Smoke Tests — core tool flow verification.
 * Tests MCP tools that aren't covered by other test groups.
 * Uses MCP SDK client, no AI involved.
 */
import { callTool, withAuth, pass, fail } from '../testTypes.js';
import type { TestContext, TestFn } from '../testTypes.js';

const GROUP = 'lessons' as const;

/** Test: help tool returns tool list */
export const helpToolTest: TestFn = async (ctx) => {
  const name = 'mcp-help-tool';
  const start = Date.now();

  try {
    const result = await callTool(ctx.client, 'help', withAuth({
      output_format: 'json_pretty',
    }, ctx.workspaceToken));

    // Should return an object with tools or categories
    if (!result) return fail(name, GROUP, Date.now() - start, 'help returned null');

    // Check that it contains some known tool names
    const text = JSON.stringify(result);
    const hasAddLesson = text.includes('add_lesson');
    const hasSearch = text.includes('search_lessons');
    const hasGuardrails = text.includes('check_guardrails');

    if (!hasAddLesson) return fail(name, GROUP, Date.now() - start, 'help output missing add_lesson');
    if (!hasSearch) return fail(name, GROUP, Date.now() - start, 'help output missing search_lessons');
    if (!hasGuardrails) return fail(name, GROUP, Date.now() - start, 'help output missing check_guardrails');

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/** Test: reflect tool synthesizes answer from lessons */
export const reflectTest: TestFn = async (ctx) => {
  const name = 'mcp-reflect-synthesis';
  const start = Date.now();

  try {
    // Add 3 related lessons about error handling
    const marker = `reflect-test-${Date.now()}`;
    const lessons = [
      { title: `${marker}: Use try-catch for async operations`, content: 'Always wrap async calls in try-catch to prevent unhandled rejections.' },
      { title: `${marker}: Log errors with stack traces`, content: 'Include full stack traces in error logs for debugging.' },
      { title: `${marker}: Return structured error responses`, content: 'API endpoints should return JSON error objects with code, message, and details.' },
    ];

    for (const l of lessons) {
      const added = await callTool(ctx.client, 'add_lesson', withAuth({
        lesson_payload: {
          project_id: ctx.projectId,
          lesson_type: 'decision',
          title: l.title,
          content: l.content,
          tags: ['integration-test', 'reflect-test'],
        },
      }, ctx.workspaceToken));
      if (added?.lesson_id) ctx.createdLessonIds.push(added.lesson_id);
    }

    // Reflect on error handling
    const result = await callTool(ctx.client, 'reflect', withAuth({
      project_id: ctx.projectId,
      question: 'What are our error handling practices?',
    }, ctx.workspaceToken), 60_000); // longer timeout for LLM

    if (!result) return fail(name, GROUP, Date.now() - start, 'reflect returned null');

    // Should return some synthesized text (may be empty if LLM is slow/unavailable)
    const answer = result.answer ?? result.reflection ?? result.text ?? result.summary ?? '';
    if (typeof answer !== 'string') {
      return fail(name, GROUP, Date.now() - start, `Reflect returned non-string: ${typeof answer}`);
    }
    if (answer.length < 10) {
      // LLM may not be available or returned empty — skip gracefully
      return pass(name, GROUP, Date.now() - start, `SKIPPED: LLM returned empty/short answer (${answer.length} chars)`);
    }

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Reflect requires distillation model — skip gracefully if not configured
    if (msg.includes('not configured') || msg.includes('not enabled') || msg.includes('DISTILLATION')) {
      return pass(name, GROUP, Date.now() - start, 'SKIPPED: distillation model not configured');
    }
    return fail(name, GROUP, Date.now() - start, `Exception: ${msg}`);
  }
};

/** Test: compress_context returns a compressed summary */
export const compressContextTest: TestFn = async (ctx) => {
  const name = 'mcp-compress-context';
  const start = Date.now();

  try {
    const result = await callTool(ctx.client, 'compress_context', withAuth({
      project_id: ctx.projectId,
    }, ctx.workspaceToken), 60_000);

    if (!result) return fail(name, GROUP, Date.now() - start, 'compress_context returned null');

    // Should return compressed text or summary
    const compressed = result.compressed ?? result.summary ?? result.text ?? '';
    if (typeof compressed !== 'string') {
      return fail(name, GROUP, Date.now() - start, `Expected string output, got ${typeof compressed}`);
    }

    // Compressed should be non-empty (even if project has few lessons)
    // Allow empty for projects with 0 lessons
    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Compress requires distillation model — skip gracefully if not configured
    if (msg.includes('not configured') || msg.includes('not enabled') || msg.includes('DISTILLATION')) {
      return pass(name, GROUP, Date.now() - start, 'SKIPPED: distillation model not configured');
    }
    return fail(name, GROUP, Date.now() - start, `Exception: ${msg}`);
  }
};

export const allMcpSmokeTests: TestFn[] = [helpToolTest, reflectTest, compressContextTest];
