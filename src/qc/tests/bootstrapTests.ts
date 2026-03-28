import { callTool, withAuth, pass, fail } from '../testTypes.js';
import type { TestContext, TestFn } from '../testTypes.js';

const GROUP = 'bootstrap' as const;

/**
 * Test 6: get_context returns useful bootstrap data
 */
export const getContextBootstrap: TestFn = async (ctx) => {
  const name = 'get-context';
  const start = Date.now();

  try {
    const result = await callTool(ctx.client, 'get_context', withAuth({
      project_id: ctx.projectId,
      task: { intent: 'fix a bug in authentication' },
    }, ctx.workspaceToken));

    // Should return some structure with refs or suggested calls.
    if (!result || typeof result !== 'object') {
      return fail(name, GROUP, Date.now() - start, 'get_context returned empty or non-object');
    }

    // Check for key fields: refs, suggested_calls, or project_snapshot.
    const hasRefs = Array.isArray(result.refs) || Array.isArray(result.suggested_calls) || result.project_snapshot;
    if (!hasRefs) {
      return fail(name, GROUP, Date.now() - start,
        `get_context missing expected fields (refs/suggested_calls/project_snapshot). Keys: ${Object.keys(result).join(', ')}`);
    }

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/**
 * Test 7: get_project_summary returns non-empty briefing
 */
export const getProjectSummary: TestFn = async (ctx) => {
  const name = 'get-project-summary';
  const start = Date.now();

  try {
    const result = await callTool(ctx.client, 'get_project_summary', withAuth({
      project_id: ctx.projectId,
    }, ctx.workspaceToken));

    // Should return a summary string or object with content.
    const summary = typeof result === 'string' ? result : (result?.summary ?? result?.text ?? result?.body ?? '');
    if (!summary || (typeof summary === 'string' && summary.trim().length < 10)) {
      return fail(name, GROUP, Date.now() - start,
        `get_project_summary returned empty or very short result. Type: ${typeof result}, keys: ${result ? Object.keys(result).join(', ') : 'null'}`);
    }

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const allBootstrapTests: TestFn[] = [getContextBootstrap, getProjectSummary];
