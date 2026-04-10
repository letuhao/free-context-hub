/**
 * Layer 2 — Guardrails Scenario Tests (6 tests)
 *
 * Tests guardrail enforcement: create rules, check blocking, simulate, supersede.
 */

import type { TestFn } from '../shared/testContext.js';
import { pass, fail, skip } from '../shared/testContext.js';
import { expectStatus } from '../shared/apiClient.js';

const GROUP = 'guardrails';

const st: { guardrailId?: string } = {};

function grTest(name: string, fn: (ctx: any) => Promise<void>): TestFn {
  return async (ctx) => {
    const start = Date.now();
    try {
      await fn(ctx);
      return pass(name, GROUP, Date.now() - start);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (msg.includes('SKIP:')) return skip(name, GROUP, msg.replace('SKIP: ', ''));
      return fail(name, GROUP, Date.now() - start, msg);
    }
  };
}

export const allGuardrailTests: TestFn[] = [
  // ── Test 1: Rules list returns correct count after adding guardrail ──
  grTest('guardrail-rules-list', async ({ api, projectId, runMarker, cleanup }) => {
    // Baseline count
    const before = await api.get(`/api/guardrails/rules?project_id=${projectId}`);
    expectStatus(before, 200);
    const countBefore = before.body?.total_count ?? before.body?.rules?.length ?? 0;

    // Add a guardrail lesson
    const addR = await api.post('/api/lessons', {
      project_id: projectId,
      lesson_type: 'guardrail',
      title: `Guardrail: block deploy to staging ${runMarker}`,
      content: 'NEVER deploy to staging without running tests first. This guardrail blocks any deploy to staging action.',
      tags: ['e2e-guardrail'],
      guardrail: {
        trigger: 'deploy to staging',
        requirement: 'Must run full test suite before deploying to staging',
        verification_method: 'manual',
      },
    });
    expectStatus(addR, 201);
    st.guardrailId = addR.body?.lesson_id;
    if (st.guardrailId) cleanup.lessonIds.push(st.guardrailId);

    // Count after
    const after = await api.get(`/api/guardrails/rules?project_id=${projectId}`);
    expectStatus(after, 200);
    const countAfter = after.body?.total_count ?? after.body?.rules?.length ?? 0;
    if (countAfter <= countBefore) throw new Error(`Expected rules count to increase: before=${countBefore}, after=${countAfter}`);
  }),

  // ── Test 2: Check blocks matching action ──
  grTest('guardrail-check-blocks-matching-action', async ({ api, projectId }) => {
    if (!st.guardrailId) throw new Error('SKIP: no guardrail created');
    const r = await api.post('/api/guardrails/check', {
      project_id: projectId,
      action_context: { action: 'deploy to staging' },
    });
    expectStatus(r, 200);
    if (r.body?.pass !== false) throw new Error(`Expected pass=false, got ${r.body?.pass}`);
    if (!r.body?.matched_rules?.length) throw new Error('Expected matched_rules to be non-empty');
    const rule = r.body.matched_rules[0];
    if (!rule.rule_id) throw new Error('matched_rule missing rule_id');
  }),

  // ── Test 3: Check passes unrelated action ──
  grTest('guardrail-check-passes-unrelated-action', async ({ api, projectId }) => {
    const r = await api.post('/api/guardrails/check', {
      project_id: projectId,
      action_context: { action: 'read a configuration file' },
    });
    expectStatus(r, 200);
    if (r.body?.pass !== true) throw new Error(`Expected pass=true for unrelated action, got ${r.body?.pass}`);
  }),

  // ── Test 4: Simulate bulk (3 actions) ──
  grTest('guardrail-simulate-bulk', async ({ api, projectId }) => {
    const r = await api.post('/api/guardrails/simulate', {
      project_id: projectId,
      actions: ['deploy to staging', 'read a file', 'deploy to staging without tests'],
    });
    expectStatus(r, 200);
    const results = r.body?.results ?? [];
    if (results.length !== 3) throw new Error(`Expected 3 results, got ${results.length}`);

    // At least one should block (deploy to staging)
    const blocked = results.filter((r: any) => r.pass === false);
    if (blocked.length === 0) throw new Error('Expected at least 1 blocked action in simulate');

    // The read action should pass
    const readResult = results.find((r: any) => r.action === 'read a file');
    if (readResult && readResult.pass !== true) throw new Error('Expected "read a file" to pass');
  }),

  // ── Test 5: Simulate max 50 limit ──
  grTest('guardrail-simulate-max-50-limit', async ({ api, projectId }) => {
    const actions = Array.from({ length: 51 }, (_, i) => `action ${i}`);
    const r = await api.post('/api/guardrails/simulate', {
      project_id: projectId,
      actions,
    });
    if (r.status !== 400) throw new Error(`Expected 400 for 51 actions, got ${r.status}`);
    if (!r.body?.error?.includes('50')) throw new Error(`Expected error mentioning 50, got: ${r.body?.error}`);
  }),

  // ── Test 6: Superseded guardrail no longer blocks ──
  grTest('guardrail-superseded-no-longer-blocks', async ({ api, projectId }) => {
    if (!st.guardrailId) throw new Error('SKIP: no guardrail created');

    // Supersede the guardrail
    const supersedeR = await api.patch(`/api/lessons/${st.guardrailId}/status`, {
      project_id: projectId,
      status: 'superseded',
    });
    expectStatus(supersedeR, 200);

    // Check the same action — should now pass
    const r = await api.post('/api/guardrails/check', {
      project_id: projectId,
      action_context: { action: 'deploy to staging' },
    });
    expectStatus(r, 200);
    if (r.body?.pass !== true) throw new Error(`Expected pass=true after superseding guardrail, got ${r.body?.pass}`);
  }),
];
