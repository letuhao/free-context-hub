/**
 * Layer 2 — Phase 11 Sprint 11.5 Cross-Instance Pull Tests
 *
 * Covers POST /api/projects/:id/pull-from — cross-instance bundle pull.
 *
 * Strategy: self-pull. We create a source project on THIS instance,
 * then ask the same instance to pull it into a new target project.
 * The SSRF guard blocks loopback by default; we gate the whole suite
 * on ALLOW_PRIVATE_FETCH_FOR_TESTS=true (set in the dev .env and in
 * docker-compose for local runs).
 *
 * Important caveat for self-pull: because source and target share a
 * database, the Sprint 11.3 cross-tenant guard refuses to re-own a
 * lesson_id that already belongs to the source project. Net result:
 * `counts.lessons.skipped=1` + a conflict entry, NOT `created=1`.
 * That is the correct behavior — a real cross-instance pull targets
 * a separate DB where the UUIDs are fresh. The happy-path test asserts
 * the fetch + import ran end-to-end and the bundle was decoded, not
 * that rows materialized.
 *
 * Tests cover:
 *   - Happy path: source -> pull -> bundle fetched + import ran
 *   - Dry-run: counts reported, no rows written
 *   - 400s: missing remote_url, bad scheme, malformed URL
 *   - 502: remote project doesn't exist (upstream 404 -> 502)
 *   - 403: SSRF blocked — skipped when the test-env flag is on,
 *     because the flag disables the private-range check by design.
 *     Covered separately by urlFetch.ts unit-level tests.
 */

import type { TestFn } from '../shared/testContext.js';
import { pass, fail, skip } from '../shared/testContext.js';
import { expectStatus } from '../shared/apiClient.js';
import { API_BASE } from '../shared/constants.js';

const GROUP = 'phase11-pull';

function phaseTest(name: string, fn: (ctx: any) => Promise<void>): TestFn {
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

/** Preflight: the pull endpoint dials its own instance. That only works
 *  when the SSRF guard is relaxed via ALLOW_PRIVATE_FETCH_FOR_TESTS.
 *  We probe /test-static (which is only mounted under the same flag)
 *  to detect whether the API container has the flag set. */
async function assertLoopbackFetchAllowed(): Promise<void> {
  const r = await fetch(`${API_BASE}/test-static/sample.md`).catch(() => null);
  if (!r || r.status !== 200) {
    throw new Error(
      'SKIP: loopback fetch disabled (set ALLOW_PRIVATE_FETCH_FOR_TESTS=true on the API container)',
    );
  }
}

/** Create a throwaway source project with one lesson. Returns the
 *  project_id and the lesson_id for later verification. */
async function seedSourceProject(
  api: any,
  runMarker: string,
  cleanup: any,
): Promise<{ sourceProjectId: string; lessonId: string }> {
  const sourceProjectId = `sp115-src-${runMarker}-${Math.random().toString(36).slice(2, 8)}`;
  const createR = await api.post('/api/projects', {
    project_id: sourceProjectId,
    name: `Sprint 11.5 source ${runMarker}`,
  });
  expectStatus(createR, 201);
  cleanup.projectIds.push(sourceProjectId);

  const lessonR = await api.post('/api/lessons', {
    project_id: sourceProjectId,
    lesson_type: 'preference',
    title: `Phase 11.5 pull test lesson ${runMarker}`,
    content: 'This lesson should round-trip through a cross-instance pull.',
    tags: ['sprint-11.5', runMarker],
  });
  expectStatus(lessonR, 201);
  const lessonId = lessonR.body?.lesson_id ?? lessonR.body?.id;
  if (!lessonId) throw new Error('seed: lessons endpoint returned no lesson_id');

  return { sourceProjectId, lessonId };
}

export const allPhase11PullTests: TestFn[] = [
  // ──────────────────────────────────────────────────────────────────
  // Happy path: self-pull round-trips a lesson byte-identically
  // ──────────────────────────────────────────────────────────────────
  phaseTest('phase11-pull-happy-path', async ({ api, runMarker, cleanup }) => {
    await assertLoopbackFetchAllowed();
    const { sourceProjectId, lessonId } = await seedSourceProject(api, runMarker, cleanup);

    const targetProjectId = `sp115-dst-${runMarker}-${Math.random().toString(36).slice(2, 8)}`;
    cleanup.projectIds.push(targetProjectId);

    const pullR = await api.post(`/api/projects/${encodeURIComponent(targetProjectId)}/pull-from`, {
      remote_url: API_BASE,
      remote_project_id: sourceProjectId,
    });
    expectStatus(pullR, 200);
    const body = pullR.body;

    if (!body?.applied) throw new Error(`expected applied=true, got ${body?.applied}`);
    if (!body?.remote?.bytes_fetched || body.remote.bytes_fetched < 1) {
      throw new Error(`expected remote.bytes_fetched > 0, got ${body?.remote?.bytes_fetched}`);
    }
    if (body?.remote?.project_id !== sourceProjectId) {
      throw new Error(`remote.project_id mismatch: ${body?.remote?.project_id}`);
    }
    // Bundle contained exactly one lesson — regardless of self-pull vs.
    // true cross-instance, counts.lessons.total must reflect that.
    if (body?.counts?.lessons?.total !== 1) {
      throw new Error(`expected counts.lessons.total=1, got ${JSON.stringify(body?.counts?.lessons)}`);
    }
    // Either created (cross-DB) or skipped with cross-tenant conflict (self-pull).
    const lessonCounts = body?.counts?.lessons ?? {};
    const accounted = (lessonCounts.created ?? 0) + (lessonCounts.skipped ?? 0) + (lessonCounts.updated ?? 0);
    if (accounted !== 1) {
      throw new Error(`lesson accounting mismatch: ${JSON.stringify(lessonCounts)}`);
    }

    // If created (would happen in a real cross-instance DB), verify the
    // lesson landed on the target. If skipped, we trust the conflict
    // report and the counts — a real cross-instance test would need two
    // separate DBs.
    if ((lessonCounts.created ?? 0) >= 1) {
      const verifyR = await api.get(
        `/api/lessons?project_id=${encodeURIComponent(targetProjectId)}&limit=50`,
      );
      expectStatus(verifyR, 200);
      const lessons = verifyR.body?.lessons ?? verifyR.body?.results ?? [];
      const found = lessons.find((l: any) => (l.lesson_id ?? l.id) === lessonId);
      if (!found) {
        throw new Error(`pulled lesson not found on target: ids=${lessons.map((l: any) => l.lesson_id ?? l.id).join(',')}`);
      }
    } else {
      // Self-pull case: expect a cross-tenant conflict entry for the lesson
      const conflicts = body?.conflicts ?? [];
      const crossTenant = conflicts.find(
        (c: any) => c.entity === 'lessons' && c.id === lessonId,
      );
      if (!crossTenant) {
        throw new Error(
          `self-pull expected a cross-tenant conflict for lesson ${lessonId}, got ${JSON.stringify(conflicts)}`,
        );
      }
    }
  }),

  // ──────────────────────────────────────────────────────────────────
  // Dry-run: reports counts, does not write
  // ──────────────────────────────────────────────────────────────────
  phaseTest('phase11-pull-dry-run', async ({ api, runMarker, cleanup }) => {
    await assertLoopbackFetchAllowed();
    const { sourceProjectId } = await seedSourceProject(api, runMarker, cleanup);

    const targetProjectId = `sp115-dry-${runMarker}-${Math.random().toString(36).slice(2, 8)}`;
    cleanup.projectIds.push(targetProjectId);

    const pullR = await api.post(`/api/projects/${encodeURIComponent(targetProjectId)}/pull-from`, {
      remote_url: API_BASE,
      remote_project_id: sourceProjectId,
      dry_run: true,
    });
    expectStatus(pullR, 200);
    const body = pullR.body;

    if (body?.applied !== false) throw new Error(`expected applied=false in dry-run, got ${body?.applied}`);
    if (body?.dry_run !== true) throw new Error(`expected dry_run=true in result, got ${body?.dry_run}`);
    if (!body?.counts?.lessons?.total || body.counts.lessons.total < 1) {
      throw new Error(`expected counts.lessons.total >=1 in dry-run, got ${JSON.stringify(body?.counts?.lessons)}`);
    }

    // Target project was auto-created ONLY because of the first line —
    // dry_run itself does NOT create rows, but the project-exists check
    // in importProject runs before the dry-run gate. Either way, the
    // lessons table stays empty.
    const verifyR = await api.get(
      `/api/lessons?project_id=${encodeURIComponent(targetProjectId)}&limit=10`,
    );
    expectStatus(verifyR, 200);
    const lessons = verifyR.body?.lessons ?? verifyR.body?.results ?? [];
    if (lessons.length !== 0) {
      throw new Error(`expected 0 lessons on target after dry-run, got ${lessons.length}`);
    }
  }),

  // ──────────────────────────────────────────────────────────────────
  // 400s: body validation
  // ──────────────────────────────────────────────────────────────────
  phaseTest('phase11-pull-missing-remote-url', async ({ api, runMarker, cleanup }) => {
    const targetProjectId = `sp115-badreq-${runMarker}`;
    cleanup.projectIds.push(targetProjectId);
    const r = await api.post(`/api/projects/${encodeURIComponent(targetProjectId)}/pull-from`, {
      remote_project_id: 'anything',
    });
    expectStatus(r, 400);
    if (!r.body?.error?.toLowerCase?.().includes('remote_url')) {
      throw new Error(`expected error about remote_url, got ${JSON.stringify(r.body)}`);
    }
  }),

  phaseTest('phase11-pull-missing-remote-project-id', async ({ api, runMarker, cleanup }) => {
    const targetProjectId = `sp115-badreq2-${runMarker}`;
    cleanup.projectIds.push(targetProjectId);
    const r = await api.post(`/api/projects/${encodeURIComponent(targetProjectId)}/pull-from`, {
      remote_url: API_BASE,
    });
    expectStatus(r, 400);
    if (!r.body?.error?.toLowerCase?.().includes('remote_project_id')) {
      throw new Error(`expected error about remote_project_id, got ${JSON.stringify(r.body)}`);
    }
  }),

  phaseTest('phase11-pull-bad-scheme', async ({ api, runMarker, cleanup }) => {
    const targetProjectId = `sp115-scheme-${runMarker}`;
    cleanup.projectIds.push(targetProjectId);
    const r = await api.post(`/api/projects/${encodeURIComponent(targetProjectId)}/pull-from`, {
      remote_url: 'ftp://example.com',
      remote_project_id: 'whatever',
    });
    expectStatus(r, 400);
    if (r.body?.code !== 'bad_scheme') {
      throw new Error(`expected code=bad_scheme, got ${JSON.stringify(r.body)}`);
    }
  }),

  phaseTest('phase11-pull-invalid-url', async ({ api, runMarker, cleanup }) => {
    const targetProjectId = `sp115-badurl-${runMarker}`;
    cleanup.projectIds.push(targetProjectId);
    const r = await api.post(`/api/projects/${encodeURIComponent(targetProjectId)}/pull-from`, {
      remote_url: 'not a url at all',
      remote_project_id: 'whatever',
    });
    expectStatus(r, 400);
    if (r.body?.code !== 'invalid_url') {
      throw new Error(`expected code=invalid_url, got ${JSON.stringify(r.body)}`);
    }
  }),

  // Review-fix: api_key containing CR/LF must not reach fetch() (would echo
  // the credential through undici's TypeError message).
  phaseTest('phase11-pull-api-key-injection', async ({ api, runMarker, cleanup }) => {
    const targetProjectId = `sp115-inj-${runMarker}`;
    cleanup.projectIds.push(targetProjectId);
    const r = await api.post(`/api/projects/${encodeURIComponent(targetProjectId)}/pull-from`, {
      remote_url: API_BASE,
      remote_project_id: 'whatever',
      api_key: 'legit-prefix\r\nX-Injected: evil',
    });
    expectStatus(r, 400);
    if (r.body?.code !== 'invalid_api_key') {
      throw new Error(`expected code=invalid_api_key, got ${JSON.stringify(r.body)}`);
    }
    // Crucially: the error message must NOT echo the raw injected value.
    const msg: string = r.body?.error ?? '';
    if (msg.includes('legit-prefix') || msg.includes('X-Injected')) {
      throw new Error(`error message leaked the raw api_key: ${msg}`);
    }
  }),

  // Review-fix: remoteProjectId length cap.
  phaseTest('phase11-pull-long-project-id', async ({ api, runMarker, cleanup }) => {
    const targetProjectId = `sp115-long-${runMarker}`;
    cleanup.projectIds.push(targetProjectId);
    const longId = 'x'.repeat(500);
    const r = await api.post(`/api/projects/${encodeURIComponent(targetProjectId)}/pull-from`, {
      remote_url: API_BASE,
      remote_project_id: longId,
    });
    expectStatus(r, 400);
    if (r.body?.code !== 'invalid_project_id') {
      throw new Error(`expected code=invalid_project_id, got ${JSON.stringify(r.body)}`);
    }
  }),

  // ──────────────────────────────────────────────────────────────────
  // 502 upstream: remote project doesn't exist
  // ──────────────────────────────────────────────────────────────────
  phaseTest('phase11-pull-nonexistent-remote', async ({ api, runMarker, cleanup }) => {
    await assertLoopbackFetchAllowed();
    const targetProjectId = `sp115-404-${runMarker}`;
    cleanup.projectIds.push(targetProjectId);
    const r = await api.post(`/api/projects/${encodeURIComponent(targetProjectId)}/pull-from`, {
      remote_url: API_BASE,
      remote_project_id: `does-not-exist-${runMarker}`,
    });
    expectStatus(r, 502);
    if (r.body?.code !== 'upstream_error') {
      throw new Error(`expected code=upstream_error, got ${JSON.stringify(r.body)}`);
    }
  }),
];
