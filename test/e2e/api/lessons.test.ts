/**
 * Layer 2 — Lessons CRUD Scenario Tests (8 tests)
 *
 * Tests full lifecycle: create, list, search, update, version, status, export/import, validation.
 */

import type { TestFn } from '../shared/testContext.js';
import { pass, fail, skip } from '../shared/testContext.js';
import { expectStatus } from '../shared/apiClient.js';

const GROUP = 'lessons';

const st: {
  lessonIds: string[];
  marker: string;
} = { lessonIds: [], marker: '' };

function lessonTest(name: string, fn: (ctx: any) => Promise<void>): TestFn {
  return async (ctx) => {
    if (!st.marker) st.marker = ctx.runMarker;
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

export const allLessonTests: TestFn[] = [
  // ── Test 1: Full CRUD lifecycle ──
  lessonTest('lesson-crud-full-lifecycle', async ({ api, projectId, cleanup }) => {
    // Create
    const createR = await api.post('/api/lessons', {
      project_id: projectId,
      lesson_type: 'decision',
      title: `CRUD lifecycle ${st.marker}`,
      content: 'Testing full CRUD lifecycle',
      tags: ['e2e-crud'],
    });
    expectStatus(createR, 201);
    const lessonId = createR.body?.lesson_id;
    if (!lessonId) throw new Error('No lesson_id returned');
    cleanup.lessonIds.push(lessonId);
    st.lessonIds.push(lessonId);

    // Read via list
    const listR = await api.get(`/api/lessons?project_id=${projectId}&q=${encodeURIComponent(st.marker)}`);
    expectStatus(listR, 200);
    const found = (listR.body?.items ?? []).some((l: any) => l.lesson_id === lessonId);
    if (!found) throw new Error('Created lesson not found in list');

    // Update
    const updateR = await api.put(`/api/lessons/${lessonId}`, {
      project_id: projectId,
      title: `CRUD lifecycle ${st.marker} (updated)`,
      content: 'Updated content',
    });
    expectStatus(updateR, 200);

    // Version history
    const versionsR = await api.get(`/api/lessons/${lessonId}/versions?project_id=${projectId}`);
    expectStatus(versionsR, 200);
    const versions = versionsR.body?.versions ?? [];
    if (versions.length < 1) throw new Error(`Expected at least 1 version, got ${versions.length}`);

    // Status change
    const statusR = await api.patch(`/api/lessons/${lessonId}/status`, {
      project_id: projectId,
      status: 'superseded',
    });
    expectStatus(statusR, 200);
  }),

  // ── Test 2: Pagination and sorting ──
  lessonTest('lesson-pagination-and-sorting', async ({ api, projectId, cleanup }) => {
    // Create 3 lessons with ordered titles
    for (const suffix of ['AAA', 'BBB', 'CCC']) {
      const r = await api.post('/api/lessons', {
        project_id: projectId,
        lesson_type: 'decision',
        title: `Pagination ${suffix} ${st.marker}`,
        content: `Pagination test ${suffix}`,
        tags: ['e2e-pagination'],
      });
      expectStatus(r, 201);
      if (r.body?.lesson_id) { cleanup.lessonIds.push(r.body.lesson_id); st.lessonIds.push(r.body.lesson_id); }
    }

    // Paginate: page 1 of 2
    const page1 = await api.get(`/api/lessons?project_id=${projectId}&tags_any=e2e-pagination&limit=2&offset=0&sort=title&order=asc`);
    expectStatus(page1, 200);
    if ((page1.body?.items?.length ?? 0) !== 2) throw new Error(`Expected 2 items on page 1, got ${page1.body?.items?.length}`);

    // Page 2
    const page2 = await api.get(`/api/lessons?project_id=${projectId}&tags_any=e2e-pagination&limit=2&offset=2&sort=title&order=asc`);
    expectStatus(page2, 200);
    if ((page2.body?.items?.length ?? 0) < 1) throw new Error(`Expected at least 1 item on page 2`);

    // Verify sort order on page 1
    const titles = (page1.body.items ?? []).map((l: any) => l.title);
    if (titles[0] > titles[1]) throw new Error(`Sort order wrong: "${titles[0]}" should be before "${titles[1]}"`);
  }),

  // ── Test 3: Filter by type ──
  lessonTest('lesson-filter-by-type', async ({ api, projectId, cleanup }) => {
    // Create one decision, one workaround
    const tag = `e2e-type-${st.marker}`;
    const r1 = await api.post('/api/lessons', {
      project_id: projectId, lesson_type: 'decision',
      title: `Type filter decision ${st.marker}`, content: 'Decision', tags: [tag],
    });
    const r2 = await api.post('/api/lessons', {
      project_id: projectId, lesson_type: 'workaround',
      title: `Type filter workaround ${st.marker}`, content: 'Workaround', tags: [tag],
    });
    expectStatus(r1, 201); expectStatus(r2, 201);
    if (r1.body?.lesson_id) { cleanup.lessonIds.push(r1.body.lesson_id); st.lessonIds.push(r1.body.lesson_id); }
    if (r2.body?.lesson_id) { cleanup.lessonIds.push(r2.body.lesson_id); st.lessonIds.push(r2.body.lesson_id); }

    // Filter by decision
    const filtered = await api.get(`/api/lessons?project_id=${projectId}&lesson_type=decision&tags_any=${tag}`);
    expectStatus(filtered, 200);
    const items = filtered.body?.items ?? [];
    if (items.length !== 1) throw new Error(`Expected 1 decision, got ${items.length}`);
    if (items[0].lesson_type !== 'decision') throw new Error(`Expected decision type, got ${items[0].lesson_type}`);

    // Tags_any returns both
    const both = await api.get(`/api/lessons?project_id=${projectId}&tags_any=${tag}`);
    expectStatus(both, 200);
    if ((both.body?.items?.length ?? 0) < 2) throw new Error(`Expected 2+ with tag filter, got ${both.body?.items?.length}`);
  }),

  // ── Test 4: Semantic search ──
  lessonTest('lesson-semantic-search', async ({ api, projectId }) => {
    const r = await api.post('/api/lessons/search', {
      project_id: projectId,
      query: `CRUD lifecycle ${st.marker}`,
      limit: 5,
    });
    expectStatus(r, 200);
    const matches = r.body?.matches ?? [];
    if (matches.length === 0) throw new Error('Semantic search returned 0 matches');
    // Superseded lessons should be excluded by default
    const superseded = matches.filter((m: any) => m.status === 'superseded');
    if (superseded.length > 0) throw new Error('Superseded lesson should not appear in default search');
  }),

  // ── Test 5: Multi-project search graceful ──
  lessonTest('lesson-search-multi-project', async ({ api, projectId }) => {
    const r = await api.post('/api/lessons/search', {
      project_ids: [projectId, 'nonexistent-project-xyz'],
      query: 'test',
      limit: 3,
    });
    expectStatus(r, 200);
    // Should not 500 from the nonexistent project
  }),

  // ── Test 6: Batch status update ──
  lessonTest('lesson-batch-status-update', async ({ api, projectId }) => {
    if (st.lessonIds.length < 2) throw new Error('SKIP: need at least 2 lesson IDs');
    const idsToArchive = st.lessonIds.slice(0, 2);
    const r = await api.post('/api/lessons/batch-status', {
      project_id: projectId,
      lesson_ids: idsToArchive,
      status: 'archived',
    });
    expectStatus(r, 200);
    const updated = r.body?.updated_count ?? r.body?.updated ?? 0;
    if (updated < 1) throw new Error(`Expected at least 1 updated, got ${updated}`);
  }),

  // ── Test 7: Export and import ──
  lessonTest('lesson-export-and-import', async ({ api, projectId, cleanup }) => {
    // Export
    const exportR = await api.get(`/api/lessons/export?project_id=${projectId}&limit=5`);
    expectStatus(exportR, 200);
    const exported = Array.isArray(exportR.body) ? exportR.body : (exportR.body?.lessons ?? []);

    // Import with modified titles
    const toImport = exported.slice(0, 1).map((l: any) => ({
      ...l,
      title: `Imported ${st.marker} ${l.title?.slice(0, 30)}`,
      lesson_id: undefined, // force new ID
    }));

    if (toImport.length === 0) throw new Error('SKIP: nothing to import');

    const importR = await api.post('/api/lessons/import', {
      project_id: projectId,
      lessons: toImport,
      skip_duplicates: true,
    });
    expectStatus(importR, 200);
    const imported = importR.body?.imported_count ?? importR.body?.imported ?? 0;
    if (imported < 1) throw new Error(`Expected at least 1 imported, got ${imported}`);

    // Track for cleanup
    const importedIds = importR.body?.lesson_ids ?? [];
    for (const id of importedIds) cleanup.lessonIds.push(id);
  }),

  // ── Test 8: Missing required fields → 400 ──
  lessonTest('lesson-missing-fields-400', async ({ api }) => {
    // Missing project_id
    const r1 = await api.post('/api/lessons', {
      lesson_type: 'decision',
      title: 'No project',
      content: 'Missing project_id',
    });
    if (r1.status !== 400 && r1.status !== 500) throw new Error(`Expected 400 or 500 for missing project_id, got ${r1.status}`);

    // Missing title
    const r2 = await api.post('/api/lessons', {
      project_id: 'e2e-test-project',
      lesson_type: 'decision',
      content: 'Missing title',
    });
    if (r2.status !== 400 && r2.status !== 500) throw new Error(`Expected 400/500 for missing title, got ${r2.status}`);
  }),

  // ── Test 9 (Sprint 12.0.2): dedup wiring — full-stack integration ──
  // Proves `dedupLessonMatches` is invoked inside `searchLessons`'s pipeline
  // at the right position (post-rerank, pre-trim). Closes the 12.1a
  // COSMETIC-1 + COSMETIC-2 gap (benchmark-wiring-gap friction class).
  lessonTest('dedup-wiring-collapses-near-duplicate-cluster', async ({ api, projectId, cleanup }) => {
    // Seed a 4-member cluster with identical title + snippet + same project + same type.
    const clusterTitle = `Dedup wiring test ${st.marker}`;
    const clusterContent = `Identical body for dedup wiring integration test marker=${st.marker}`;
    for (let i = 0; i < 4; i++) {
      const r = await api.post('/api/lessons', {
        project_id: projectId,
        lesson_type: 'decision',
        title: clusterTitle,
        content: clusterContent,
        tags: ['e2e-dedup-wiring'],
      });
      expectStatus(r, 201);
      cleanup.lessonIds.push(r.body?.lesson_id);
    }

    // Seed a distinct lesson so we know dedup isn't nuking everything.
    const distinctTitle = `Dedup wiring distinct ${st.marker}`;
    const distinctR = await api.post('/api/lessons', {
      project_id: projectId,
      lesson_type: 'decision',
      title: distinctTitle,
      content: `Different body for dedup wiring integration test marker=${st.marker}`,
      tags: ['e2e-dedup-wiring'],
    });
    expectStatus(distinctR, 201);
    cleanup.lessonIds.push(distinctR.body?.lesson_id);

    // Search — uses the REST route which goes through searchLessons →
    // post-rerank dedup → trim. Cluster should collapse to 1; distinct stays.
    const searchR = await api.post('/api/lessons/search', {
      project_id: projectId,
      query: `wiring test ${st.marker}`,
      limit: 20,
    });
    expectStatus(searchR, 200);
    const matches = (searchR.body?.matches ?? []) as Array<{ title: string; lesson_id: string }>;

    const clusterMatches = matches.filter((m) => m.title === clusterTitle);
    if (clusterMatches.length !== 1) {
      throw new Error(
        `Dedup wiring broken: expected exactly 1 cluster representative in search output, got ${clusterMatches.length} copies of "${clusterTitle}"`,
      );
    }

    const distinctMatches = matches.filter((m) => m.title === distinctTitle);
    if (distinctMatches.length !== 1) {
      throw new Error(
        `Distinct lesson missing from search output (got ${distinctMatches.length}) — dedup may be collapsing too aggressively`,
      );
    }
  }),

  // ── Test 10 (Sprint 12.0.2): dedup explanation always emitted ──
  // Closes 12.1a LOW-3. Whether dedup collapsed anything or not, the
  // explanations array should always tell the caller what dedup did.
  lessonTest('dedup-explanation-always-emitted', async ({ api, projectId, cleanup: _cleanup }) => {
    const r = await api.post('/api/lessons/search', {
      project_id: projectId,
      query: `zephyr-ninja-pyramid no lessons match this ${st.marker}`,
      limit: 10,
    });
    expectStatus(r, 200);
    const explanations = (r.body?.explanations ?? []) as string[];
    const hasDedupEntry = explanations.some((e) => e.startsWith('dedup:'));
    if (!hasDedupEntry) {
      throw new Error(
        `Expected a 'dedup:' entry in explanations even on zero-collapse runs. Got: ${JSON.stringify(explanations)}`,
      );
    }
  }),
];
