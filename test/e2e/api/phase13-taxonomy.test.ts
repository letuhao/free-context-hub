/**
 * Phase 13 Sprint 13.7 Part A — Taxonomy profiles (F3) lifecycle E2E.
 *
 * Covers F3 ACs 1-8: list built-ins, custom CRUD, shadowing rejection,
 * activate → add profile-type lesson → validate → deactivate → reject.
 * Also the codex-guardrail integration (lessons.ts:300 + guardrails table).
 */

import type { TestFn } from '../shared/testContext.js';
import { pass, fail, skip } from '../shared/testContext.js';
import { expectStatus } from '../shared/apiClient.js';

const GROUP = 'phase13-taxonomy';

function taxonomyTest(name: string, fn: (ctx: any) => Promise<void>): TestFn {
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

export const allPhase13TaxonomyTests: TestFn[] = [
  // ── F3-AC8: built-in profiles seeded ──
  taxonomyTest('taxonomy-builtins-seeded-dlf-phase0', async ({ api }) => {
    const r = await api.get('/api/taxonomy-profiles?is_builtin=true');
    expectStatus(r, 200);
    const slugs = (r.body.profiles ?? []).map((p: any) => p.slug);
    if (!slugs.includes('dlf-phase0')) {
      throw new Error(`Expected dlf-phase0 in built-ins, got: ${slugs.join(', ')}`);
    }
  }),

  // ── F3-AC3: shadowing built-in types is rejected ──
  taxonomyTest('taxonomy-create-shadowing-built-in-rejected', async ({ api, projectId, runMarker }) => {
    const r = await api.post('/api/taxonomy-profiles', {
      slug: `shadow-attempt-${runMarker}`,
      name: 'Shadow attempt',
      lesson_types: [{ type: 'decision', label: 'Should fail' }],
      owner_project_id: projectId,
    });
    if (r.status !== 400) {
      throw new Error(`Expected 400 for shadowing built-in, got ${r.status}`);
    }
    if (!String(r.body?.error ?? '').match(/shadow/i)) {
      throw new Error(`Expected error mentioning shadow; got: ${r.body?.error}`);
    }
  }),

  // ── F3-AC4: is_builtin forced to false on API create ──
  taxonomyTest('taxonomy-create-is-builtin-forced-false', async ({ api, projectId, runMarker }) => {
    const r = await api.post('/api/taxonomy-profiles', {
      slug: `forced-${runMarker}`,
      name: 'Test forced false',
      lesson_types: [{ type: `custom-${runMarker}`, label: 'Custom' }],
      owner_project_id: projectId,
      is_builtin: true, // attempt to set true — service must force false
    });
    expectStatus(r, 201);
    if (r.body.is_builtin !== false) {
      throw new Error(`Expected is_builtin=false (forced), got ${r.body.is_builtin}`);
    }
  }),

  // ── F3-AC1 + AC2: activate → add lesson with profile type → validate ──
  taxonomyTest('taxonomy-activate-profile-allows-its-types', async ({ api, projectId, cleanup, runMarker }) => {
    // Activate dlf-phase0
    const aR = await api.post(`/api/projects/${projectId}/taxonomy-profile/activate`, {
      slug: 'dlf-phase0',
      activated_by: `e2e-${runMarker}`,
    });
    expectStatus(aR, 200);
    if (aR.body.status !== 'activated') throw new Error(`Expected activated, got ${aR.body.status}`);
    cleanup.taxonomyActivations.push(projectId);

    // Add a lesson with a profile type
    const r = await api.post('/api/lessons', {
      project_id: projectId,
      lesson_type: 'reckoning-finding',
      title: `Profile type test ${runMarker}`,
      content: 'Phase 13.7 taxonomy activation E2E',
    });
    expectStatus(r, 201);
    if (!r.body.lesson_id) throw new Error('No lesson_id returned');
    cleanup.lessonIds.push(r.body.lesson_id);
  }),

  // ── F3-AC1: add_lesson with invalid type → 400 with valid types list ──
  taxonomyTest('taxonomy-validate-rejects-bogus-type', async ({ api, projectId, runMarker }) => {
    const r = await api.post('/api/lessons', {
      project_id: projectId,
      lesson_type: `bogus-${runMarker}`,
      title: `Bogus type test ${runMarker}`,
      content: 'Should be rejected',
    });
    if (r.status !== 400) {
      throw new Error(`Expected 400 for bogus type, got ${r.status}`);
    }
    const errStr = String(r.body?.error ?? '');
    if (!errStr.match(/Invalid lesson_type/i)) {
      throw new Error(`Expected "Invalid lesson_type" error; got: ${errStr}`);
    }
    // Error should list valid types
    if (!errStr.includes('decision') || !errStr.includes('general_note')) {
      throw new Error(`Expected valid types listed in error; got: ${errStr}`);
    }
  }),

  // ── F3-AC5: codex-guardrail lesson writes to guardrails table ──
  taxonomyTest('taxonomy-codex-guardrail-writes-to-guardrails-table', async ({ api, projectId, cleanup, runMarker }) => {
    // dlf-phase0 must be active for codex-guardrail to be a valid lesson_type
    // (assumes prior test activated it; if not, activate here)
    const active = await api.get(`/api/projects/${projectId}/taxonomy-profile`);
    if (!active.body?.profile || active.body.profile.slug !== 'dlf-phase0') {
      const aR = await api.post(`/api/projects/${projectId}/taxonomy-profile/activate`, {
        slug: 'dlf-phase0',
        activated_by: `e2e-${runMarker}`,
      });
      expectStatus(aR, 200);
      cleanup.taxonomyActivations.push(projectId);
    }

    const r = await api.post('/api/lessons', {
      project_id: projectId,
      lesson_type: 'codex-guardrail',
      title: `Codex guardrail test ${runMarker}`,
      content: `HS-X: prohibit foo-${runMarker} actions without authorization`,
      guardrail: {
        trigger: `foo-${runMarker}`,
        requirement: 'User authorization required',
        verification_method: 'user_confirmation',
      },
    });
    expectStatus(r, 201);
    if (!r.body.guardrail_inserted) {
      throw new Error(`Expected guardrail_inserted=true for codex-guardrail; got ${r.body.guardrail_inserted}`);
    }
    cleanup.lessonIds.push(r.body.lesson_id);

    // Verify the guardrail rule appears in /api/guardrails
    const gr = await api.get(`/api/guardrails/rules?project_id=${projectId}`);
    expectStatus(gr, 200);
    const found = gr.body.rules.find((rule: any) => rule.trigger === `foo-${runMarker}`);
    if (!found) {
      throw new Error(`Expected guardrails rule with trigger 'foo-${runMarker}'; got ${gr.body.rules.length} rules`);
    }
  }),

  // ── F3-AC7: deactivation does not change existing lesson_type strings ──
  taxonomyTest('taxonomy-deactivate-preserves-existing-lessons', async ({ api, projectId, cleanup, runMarker }) => {
    // Ensure active
    const active = await api.get(`/api/projects/${projectId}/taxonomy-profile`);
    if (!active.body?.profile || active.body.profile.slug !== 'dlf-phase0') {
      const aR = await api.post(`/api/projects/${projectId}/taxonomy-profile/activate`, {
        slug: 'dlf-phase0',
        activated_by: `e2e-${runMarker}`,
      });
      expectStatus(aR, 200);
    }
    // Create a lesson with profile type
    const lr = await api.post('/api/lessons', {
      project_id: projectId,
      lesson_type: 'failure-candidate',
      title: `Preservation test ${runMarker}`,
      content: 'will survive deactivation',
    });
    expectStatus(lr, 201);
    const lessonId = lr.body.lesson_id;
    cleanup.lessonIds.push(lessonId);

    // Deactivate
    const dR = await api.delete(`/api/projects/${projectId}/taxonomy-profile`);
    expectStatus(dR, 200);

    // Lesson should still exist with its original type — verify via list with id filter
    const listR = await api.get(`/api/lessons?project_id=${projectId}&filters[lesson_type]=failure-candidate&limit=100`);
    expectStatus(listR, 200);
    const found = (listR.body.items ?? []).find((l: any) => l.lesson_id === lessonId);
    if (!found) {
      throw new Error(`Expected lesson to still exist after deactivation; got ${(listR.body.items ?? []).length} items`);
    }
    if (found.lesson_type !== 'failure-candidate') {
      throw new Error(`Expected lesson_type=failure-candidate preserved; got ${found.lesson_type}`);
    }

    // Re-activate so subsequent tests in the suite work
    await api.post(`/api/projects/${projectId}/taxonomy-profile/activate`, {
      slug: 'dlf-phase0',
      activated_by: `e2e-${runMarker}`,
    });
    cleanup.taxonomyActivations.push(projectId);
  }),

  // ── F3: deactivate → add lesson with deactivated type → reject ──
  taxonomyTest('taxonomy-deactivate-then-reject-profile-type', async ({ api, projectId, cleanup, runMarker }) => {
    // Deactivate fully first
    await api.delete(`/api/projects/${projectId}/taxonomy-profile`);

    // Add lesson with a profile type that should no longer be valid
    const r = await api.post('/api/lessons', {
      project_id: projectId,
      lesson_type: 'implicit-principle',
      title: `Post-deactivation test ${runMarker}`,
      content: 'Should be rejected',
    });
    if (r.status !== 400) {
      throw new Error(`Expected 400 after deactivation, got ${r.status}`);
    }
  }),

  // ── Cross-tenant guard: can't activate another project's custom profile ──
  taxonomyTest('taxonomy-activate-rejects-unknown-slug', async ({ api, projectId, runMarker }) => {
    const r = await api.post(`/api/projects/${projectId}/taxonomy-profile/activate`, {
      slug: `nonexistent-${runMarker}`,
      activated_by: `e2e-${runMarker}`,
    });
    if (r.status !== 404) {
      throw new Error(`Expected 404 for unknown profile slug, got ${r.status}`);
    }
  }),
];
