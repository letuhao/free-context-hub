import { pass, fail } from '../testTypes.js';
import type { TestContext, TestFn } from '../testTypes.js';

const GROUP = 'lessons' as const;
const API_BASE = process.env.API_BASE_URL?.trim() || 'http://localhost:3001';

/** Test: Global search across entities */
export const globalSearchTest: TestFn = async (ctx) => {
  const name = 'global-search';
  const start = Date.now();

  try {
    // Ensure at least one lesson exists with known content.
    await fetch(`${API_BASE}/api/lessons`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: ctx.projectId, lesson_type: 'decision', title: 'Global search test retry pattern', content: 'Use exponential backoff for retry', tags: ['integration-test', 'global-search'] }),
    });

    // Search for "retry".
    const res = await (await fetch(`${API_BASE}/api/search/global?project_id=${ctx.projectId}&q=retry`)).json() as any;

    if (res.query !== 'retry') return fail(name, GROUP, Date.now() - start, `Query mismatch: ${res.query}`);
    if (!Array.isArray(res.lessons)) return fail(name, GROUP, Date.now() - start, 'Missing lessons array');
    if (!Array.isArray(res.documents)) return fail(name, GROUP, Date.now() - start, 'Missing documents array');
    if (!Array.isArray(res.guardrails)) return fail(name, GROUP, Date.now() - start, 'Missing guardrails array');
    if (!Array.isArray(res.commits)) return fail(name, GROUP, Date.now() - start, 'Missing commits array');
    if (res.total_count === undefined) return fail(name, GROUP, Date.now() - start, 'Missing total_count');

    // Should find our lesson.
    const found = res.lessons.some((l: any) => l.title?.includes('Global search test retry'));
    if (!found) return fail(name, GROUP, Date.now() - start, 'Lesson not found in global search');

    // Empty query returns empty.
    const empty = await (await fetch(`${API_BASE}/api/search/global?project_id=${ctx.projectId}&q=`)).json() as any;
    if (empty.total_count !== 0) return fail(name, GROUP, Date.now() - start, `Empty query should return 0, got ${empty.total_count}`);

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/** Test: Agent trust levels CRUD */
export const agentTrustTest: TestFn = async (ctx) => {
  const name = 'agent-trust-levels';
  const start = Date.now();

  try {
    const agentId = `test-agent-${Date.now()}`;

    // 1. Get (auto-creates with default 'new').
    const get = await (await fetch(`${API_BASE}/api/agents/${agentId}?project_id=${ctx.projectId}`)).json() as any;
    if (get.trust_level !== 'new') return fail(name, GROUP, Date.now() - start, `Expected 'new', got '${get.trust_level}'`);
    if (get.auto_approve !== false) return fail(name, GROUP, Date.now() - start, `Expected auto_approve=false`);

    // 2. Update to 'trusted' with auto_approve.
    const updated = await (await fetch(`${API_BASE}/api/agents/${agentId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: ctx.projectId, trust_level: 'trusted', auto_approve: true }),
    })).json() as any;
    if (updated.trust_level !== 'trusted') return fail(name, GROUP, Date.now() - start, `Update: expected 'trusted', got '${updated.trust_level}'`);
    if (updated.auto_approve !== true) return fail(name, GROUP, Date.now() - start, `Update: auto_approve should be true`);

    // 3. List agents.
    const list = await (await fetch(`${API_BASE}/api/agents?project_id=${ctx.projectId}`)).json() as any;
    if (!Array.isArray(list.agents)) return fail(name, GROUP, Date.now() - start, 'Missing agents array');
    const found = list.agents.some((a: any) => a.agent_id === agentId);
    if (!found) return fail(name, GROUP, Date.now() - start, 'Agent not in list');

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const allSearchAgentTests: TestFn[] = [globalSearchTest, agentTrustTest];
