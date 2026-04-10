/**
 * Layer 2 — Search Scenario Tests (4 tests)
 *
 * Tests global search, tiered code search, empty queries, and limits.
 */

import type { TestFn } from '../shared/testContext.js';
import { pass, fail, skip } from '../shared/testContext.js';
import { expectStatus } from '../shared/apiClient.js';

const GROUP = 'search';

function searchTest(name: string, fn: (ctx: any) => Promise<void>): TestFn {
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

export const allSearchTests: TestFn[] = [
  // ── Test 1: Global search returns all entity types ──
  searchTest('global-search-returns-all-entity-types', async ({ api, projectId }) => {
    const r = await api.get(`/api/search/global?project_id=${projectId}&q=test`);
    expectStatus(r, 200);
    // Verify response shape has expected arrays
    const body = r.body ?? {};
    if (!('lessons' in body) && !('results' in body)) {
      throw new Error(`Expected lessons or results in response, got keys: ${Object.keys(body).join(', ')}`);
    }
  }),

  // ── Test 2: Global search empty query → zero results ──
  searchTest('global-search-empty-query-returns-zeros', async ({ api, projectId }) => {
    const r = await api.get(`/api/search/global?project_id=${projectId}&q=`);
    expectStatus(r, 200);
    const total = r.body?.total_count ?? 0;
    if (total !== 0) throw new Error(`Expected total_count=0 for empty query, got ${total}`);
  }),

  // ── Test 3: Global search with limit ──
  searchTest('global-search-limit-per-group', async ({ api, projectId }) => {
    const r = await api.get(`/api/search/global?project_id=${projectId}&q=test&limit=1`);
    expectStatus(r, 200);
    // Each entity array should have at most 1 item
    const lessons = r.body?.lessons ?? [];
    if (lessons.length > 1) throw new Error(`Expected at most 1 lesson with limit=1, got ${lessons.length}`);
  }),

  // ── Test 4: Tiered code search graceful response ──
  searchTest('tiered-search-code-graceful', async ({ api, projectId }) => {
    const r = await api.post('/api/search/code-tiered', {
      project_id: projectId,
      query: 'function',
      limit: 3,
    });
    expectStatus(r, 200);
    // Should return a results object (possibly empty if not indexed)
    if (!r.body || typeof r.body !== 'object') throw new Error('Expected object response');
  }),
];
