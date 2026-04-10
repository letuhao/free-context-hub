/**
 * Layer 2 — Auth & Role Enforcement Scenario Tests (7 tests)
 *
 * Tests the role hierarchy: reader < writer < admin.
 * Creates real API keys per role and verifies 401/403 behavior.
 */

import type { TestFn } from '../shared/testContext.js';
import { pass, fail, skip } from '../shared/testContext.js';
import { makeApiClient } from '../shared/apiClient.js';
import { createTestApiKey, revokeTestKeys } from '../shared/authHelpers.js';
import { API_BASE, ADMIN_TOKEN } from '../shared/constants.js';

const GROUP = 'auth';

/** Shared state for keys created in this test group. */
const keys: { reader?: { key: string; key_id: string }; writer?: { key: string; key_id: string } } = {};

function authTest(name: string, fn: (ctx: any) => Promise<void>): TestFn {
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

export const allAuthTests: TestFn[] = [
  // ── Setup: create reader + writer keys ──
  authTest('setup-create-test-keys', async (ctx) => {
    if (!ADMIN_TOKEN) throw new Error('SKIP: no ADMIN_TOKEN set, cannot test auth');
    keys.reader = await createTestApiKey('reader', `e2e-reader-${ctx.runMarker}`);
    ctx.cleanup.apiKeyIds.push(keys.reader.key_id);
    keys.writer = await createTestApiKey('writer', `e2e-writer-${ctx.runMarker}`);
    ctx.cleanup.apiKeyIds.push(keys.writer.key_id);
  }),

  // ── Test 1: No token → 401 ──
  authTest('auth-no-token-returns-401', async ({ projectId }) => {
    if (!ADMIN_TOKEN) throw new Error('SKIP: auth not enabled');
    const noAuthClient = makeApiClient(API_BASE); // no token
    const r = await noAuthClient.get(`/api/lessons?project_id=${projectId}`);
    if (r.status !== 401) throw new Error(`Expected 401, got ${r.status}`);
  }),

  // ── Test 2: Invalid token → 401 ──
  authTest('auth-invalid-token-returns-401', async ({ projectId }) => {
    if (!ADMIN_TOKEN) throw new Error('SKIP: auth not enabled');
    const badClient = makeApiClient(API_BASE, 'invalid-garbage-token-xyz');
    const r = await badClient.get(`/api/lessons?project_id=${projectId}`);
    if (r.status !== 401) throw new Error(`Expected 401, got ${r.status}`);
  }),

  // ── Test 3: Reader can GET lessons ──
  authTest('auth-reader-can-GET-lessons', async ({ projectId }) => {
    if (!keys.reader) throw new Error('SKIP: no reader key');
    const readerClient = makeApiClient(API_BASE, keys.reader.key);
    const r = await readerClient.get(`/api/lessons?project_id=${projectId}`);
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  }),

  // ── Test 4: Reader cannot POST lesson → 403 ──
  authTest('auth-reader-cannot-POST-lesson', async ({ projectId }) => {
    if (!keys.reader) throw new Error('SKIP: no reader key');
    const readerClient = makeApiClient(API_BASE, keys.reader.key);
    const r = await readerClient.post('/api/lessons', {
      project_id: projectId,
      lesson_type: 'decision',
      title: 'Should be blocked',
      content: 'Reader trying to write',
    });
    if (r.status !== 403) throw new Error(`Expected 403, got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
    if (!r.body?.error?.includes('writer')) throw new Error(`Expected error mentioning 'writer' role, got: ${r.body?.error}`);
  }),

  // ── Test 5: Writer can POST lesson ──
  authTest('auth-writer-can-POST-lesson', async ({ projectId, cleanup }) => {
    if (!keys.writer) throw new Error('SKIP: no writer key');
    const writerClient = makeApiClient(API_BASE, keys.writer.key);
    const r = await writerClient.post('/api/lessons', {
      project_id: projectId,
      lesson_type: 'decision',
      title: 'Writer-created lesson',
      content: 'Created by writer role key',
      tags: ['e2e-auth-test'],
    });
    if (r.status !== 201) throw new Error(`Expected 201, got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
    if (r.body?.lesson_id) cleanup.lessonIds.push(r.body.lesson_id);
  }),

  // ── Test 6: Writer cannot DELETE project → 403 ──
  authTest('auth-writer-cannot-DELETE-project', async ({ projectId }) => {
    if (!keys.writer) throw new Error('SKIP: no writer key');
    const writerClient = makeApiClient(API_BASE, keys.writer.key);
    const r = await writerClient.delete(`/api/projects/${projectId}`);
    if (r.status !== 403) throw new Error(`Expected 403, got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  }),

  // ── Test 7: Admin env token has full access ──
  authTest('auth-admin-env-token-full-access', async ({ projectId }) => {
    if (!ADMIN_TOKEN) throw new Error('SKIP: no ADMIN_TOKEN');
    const adminClient = makeApiClient(API_BASE, ADMIN_TOKEN);
    // Admin can read
    const readR = await adminClient.get(`/api/lessons?project_id=${projectId}`);
    if (readR.status !== 200) throw new Error(`Admin GET failed: ${readR.status}`);
    // Admin can access admin-only routes
    const keysR = await adminClient.get('/api/api-keys');
    if (keysR.status !== 200) throw new Error(`Admin GET /api-keys failed: ${keysR.status}`);
    // Admin can access lesson-types (admin-gated)
    const typesR = await adminClient.get('/api/lesson-types');
    if (typesR.status !== 200) throw new Error(`Admin GET /lesson-types failed: ${typesR.status}`);
  }),
];
