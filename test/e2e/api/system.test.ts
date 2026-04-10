/**
 * Layer 2 — System Scenario Tests (3 tests)
 *
 * Tests health check, system info, and lesson types CRUD.
 */

import type { TestFn } from '../shared/testContext.js';
import { pass, fail, skip } from '../shared/testContext.js';
import { expectStatus } from '../shared/apiClient.js';

const GROUP = 'system';

function sysTest(name: string, fn: (ctx: any) => Promise<void>): TestFn {
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

export const allSystemTests: TestFn[] = [
  // ── Test 1: Health check ──
  sysTest('system-health-check', async ({ api }) => {
    const r = await api.get('/api/system/health');
    expectStatus(r, 200);
    if (r.body?.status !== 'ok') throw new Error(`Expected status=ok, got ${r.body?.status}`);
    if (!r.body?.timestamp) throw new Error('Missing timestamp in health response');
    // Validate ISO date
    const d = new Date(r.body.timestamp);
    if (isNaN(d.getTime())) throw new Error(`Invalid timestamp: ${r.body.timestamp}`);
  }),

  // ── Test 2: System info with feature flags ──
  sysTest('system-info-feature-flags', async ({ api }) => {
    const r = await api.get('/api/system/info');
    expectStatus(r, 200);
    const features = r.body?.features;
    if (!features || typeof features !== 'object') throw new Error('Missing features object');

    const expected = ['embeddings', 'distillation', 'knowledge_graph', 'queue', 'git_ingest'];
    for (const key of expected) {
      if (!(key in features)) throw new Error(`Missing feature key: ${key}`);
    }
    // Each feature should have an enabled boolean
    if (typeof features.embeddings?.enabled !== 'boolean' && typeof features.embeddings?.model !== 'string') {
      throw new Error('embeddings feature missing enabled/model field');
    }
  }),

  // ── Test 3: Lesson types CRUD ──
  sysTest('lesson-types-crud', async ({ api, runMarker, cleanup }) => {
    // Baseline count
    const beforeR = await api.get('/api/lesson-types');
    expectStatus(beforeR, 200);
    const before = (beforeR.body?.types ?? beforeR.body ?? []).length;

    // Create
    const key = `e2e_sys_${runMarker.slice(4, 14).replace(/[^a-z0-9_]/g, '')}`;
    const createR = await api.post('/api/lesson-types', {
      type_key: key,
      display_name: 'E2E System Test Type',
      color: 'cyan',
    });
    expectStatus(createR, 201);
    cleanup.lessonTypeKeys.push(key);

    // Verify count increased
    const afterR = await api.get('/api/lesson-types');
    expectStatus(afterR, 200);
    const after = (afterR.body?.types ?? afterR.body ?? []).length;
    if (after <= before) throw new Error(`Expected type count to increase: before=${before}, after=${after}`);

    // Update
    const updateR = await api.put(`/api/lesson-types/${key}`, {
      display_name: 'E2E System Test Type (Updated)',
    });
    expectStatus(updateR, 200);

    // Delete
    const delR = await api.delete(`/api/lesson-types/${key}`);
    expectStatus(delR, 200);
    cleanup.lessonTypeKeys = cleanup.lessonTypeKeys.filter((k: string) => k !== key);

    // Verify back to baseline
    const finalR = await api.get('/api/lesson-types');
    const finalCount = (finalR.body?.types ?? finalR.body ?? []).length;
    if (finalCount !== before) throw new Error(`Expected count back to ${before}, got ${finalCount}`);
  }),
];
