import { callTool, withAuth, pass, fail } from '../testTypes.js';
import type { TestContext, TestFn } from '../testTypes.js';

const GROUP = 'guardrails' as const;

/**
 * Test 4: Guardrail enforcement
 * Add guardrail → check matching action → blocked → check non-matching → passes
 */
export const guardrailEnforcement: TestFn = async (ctx) => {
  const name = 'guardrail-enforcement';
  const start = Date.now();
  const tag = `it-guardrail-${Date.now()}`;

  try {
    // Add a guardrail lesson (nested in lesson_payload).
    const added = await callTool(ctx.client, 'add_lesson', withAuth({
      lesson_payload: {
        project_id: ctx.projectId,
        lesson_type: 'guardrail',
        title: `Test guardrail: ${tag}`,
        content: 'Always run tests before pushing to remote.',
        tags: ['integration-test', tag],
        guardrail: {
          trigger: 'git push',
          requirement: 'tests must pass before push',
          verification_method: 'user_confirmation',
        },
      },
    }, ctx.workspaceToken));

    const lessonId = added?.lesson_id;
    if (!lessonId) return fail(name, GROUP, Date.now() - start, `add_lesson returned no lesson_id: ${JSON.stringify(added)}`);
    ctx.createdLessonIds.push(lessonId);

    // Check guardrails for matching action — should block.
    const checkBlocked = await callTool(ctx.client, 'check_guardrails', withAuth({
      action_context: { action: 'git push', project_id: ctx.projectId },
    }, ctx.workspaceToken));

    if (checkBlocked?.pass !== false) {
      return fail(name, GROUP, Date.now() - start,
        `check_guardrails should return pass:false for 'git push', got pass:${checkBlocked?.pass}`);
    }

    // Check guardrails for non-matching action — should pass.
    const checkPassed = await callTool(ctx.client, 'check_guardrails', withAuth({
      action_context: { action: 'read file', project_id: ctx.projectId },
    }, ctx.workspaceToken));

    if (checkPassed?.pass !== true) {
      return fail(name, GROUP, Date.now() - start,
        `check_guardrails should return pass:true for 'read file', got pass:${checkPassed?.pass}`);
    }

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/**
 * Test 5: Superseded guardrails should not block
 * Add guardrail → blocks → supersede → passes
 */
export const guardrailSuperseded: TestFn = async (ctx) => {
  const name = 'guardrail-superseded';
  const start = Date.now();
  const tag = `it-guardrail-sup-${Date.now()}`;

  try {
    // Add a guardrail.
    const added = await callTool(ctx.client, 'add_lesson', withAuth({
      lesson_payload: {
        project_id: ctx.projectId,
        lesson_type: 'guardrail',
        title: `Supersedable guardrail: ${tag}`,
        content: 'Must review before deploy.',
        tags: ['integration-test', tag],
        guardrail: {
          trigger: 'deploy',
          requirement: 'peer review required',
          verification_method: 'user_confirmation',
        },
      },
    }, ctx.workspaceToken));

    const lessonId = added?.lesson_id;
    if (!lessonId) return fail(name, GROUP, Date.now() - start, `add_lesson returned no lesson_id: ${JSON.stringify(added)}`);
    ctx.createdLessonIds.push(lessonId);

    // Should block.
    const checkBefore = await callTool(ctx.client, 'check_guardrails', withAuth({
      action_context: { action: 'deploy', project_id: ctx.projectId },
    }, ctx.workspaceToken));

    if (checkBefore?.pass !== false) {
      return fail(name, GROUP, Date.now() - start, `Expected block before supersede, got pass:${checkBefore?.pass}`);
    }

    // Supersede it.
    await callTool(ctx.client, 'update_lesson_status', withAuth({
      project_id: ctx.projectId,
      lesson_id: lessonId,
      status: 'superseded',
    }, ctx.workspaceToken));

    // Should pass now.
    const checkAfter = await callTool(ctx.client, 'check_guardrails', withAuth({
      action_context: { action: 'deploy', project_id: ctx.projectId },
    }, ctx.workspaceToken));

    if (checkAfter?.pass !== true) {
      return fail(name, GROUP, Date.now() - start, `Expected pass after supersede, got pass:${checkAfter?.pass}`);
    }

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const allGuardrailTests: TestFn[] = [guardrailEnforcement, guardrailSuperseded];
