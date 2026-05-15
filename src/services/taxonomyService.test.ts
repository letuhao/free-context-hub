/**
 * Phase 13 Sprint 13.5 — taxonomyService unit tests.
 * Phase 13 bug-fix SS2 — updated for the unified registry model: profiles store
 * type_key refs into the `lesson_types` registry; getValidLessonTypes resolves
 * from the registry (scope='global' types + active-profile types).
 *
 * Test type_keys are prefixed `zztest-` so cleanup can target them. (`createLessonType`
 * requires a leading letter, so the prefix starts with 'z', not '_'.)
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';

import {
  listTaxonomyProfiles,
  getTaxonomyProfileBySlug,
  createTaxonomyProfile,
  upsertBuiltinProfile,
  getActiveProfile,
  activateProfile,
  deactivateProfile,
  getValidLessonTypes,
  validateLessonType,
} from './taxonomyService.js';
import { createLessonType } from './lessonTypes.js';
import { getDbPool } from '../db/client.js';

const TEST_PROJECT = '__test_taxonomy__';
const TEST_PROJECT_B = '__test_taxonomy_B__';

async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM project_taxonomy_profiles WHERE project_id IN ($1, $2)`, [TEST_PROJECT, TEST_PROJECT_B]);
  await pool.query(`DELETE FROM taxonomy_profiles WHERE owner_project_id IN ($1, $2)`, [TEST_PROJECT, TEST_PROJECT_B]);
  await pool.query(`DELETE FROM taxonomy_profiles WHERE slug LIKE '__test%'`);
  // SS2: also clear the registry rows the tests create (profile-scoped + global).
  await pool.query(`DELETE FROM lesson_types WHERE type_key LIKE 'zztest-%'`);
  await pool.query(`DELETE FROM projects WHERE project_id IN ($1, $2)`, [TEST_PROJECT, TEST_PROJECT_B]);
}

before(async () => {
  await cleanup();
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO projects (project_id, name) VALUES ($1, 'Test taxonomy'), ($2, 'Test taxonomy B')
     ON CONFLICT (project_id) DO NOTHING`,
    [TEST_PROJECT, TEST_PROJECT_B],
  );
});
after(async () => { await cleanup(); });
beforeEach(async () => {
  const pool = getDbPool();
  await pool.query(`DELETE FROM project_taxonomy_profiles WHERE project_id IN ($1, $2)`, [TEST_PROJECT, TEST_PROJECT_B]);
  await pool.query(`DELETE FROM taxonomy_profiles WHERE owner_project_id IN ($1, $2)`, [TEST_PROJECT, TEST_PROJECT_B]);
  await pool.query(`DELETE FROM taxonomy_profiles WHERE slug LIKE '__test%'`);
  await pool.query(`DELETE FROM lesson_types WHERE type_key LIKE 'zztest-%'`);
});

test('createTaxonomyProfile happy path — stores type_key refs, returns hydrated types', async () => {
  const p = await createTaxonomyProfile({
    slug: '__test-prof-1',
    name: 'Test Profile 1',
    lesson_types: [
      { type: 'zztest-cta', label: 'Custom A' },
      { type: 'zztest-ctb', label: 'Custom B' },
    ],
    owner_project_id: TEST_PROJECT,
  });
  assert.equal(p.slug, '__test-prof-1');
  assert.equal(p.is_builtin, false);
  assert.equal(p.owner_project_id, TEST_PROJECT);
  assert.equal(p.lesson_types.length, 2);
  // Returned shape is hydrated from the registry — label survives the round-trip.
  const ctaa = p.lesson_types.find((t) => t.type === 'zztest-cta');
  assert.ok(ctaa);
  assert.equal(ctaa!.label, 'Custom A');

  // The profile's types are registered in lesson_types with scope='profile'.
  const pool = getDbPool();
  const reg = await pool.query(`SELECT scope FROM lesson_types WHERE type_key = 'zztest-cta'`);
  assert.equal(reg.rows[0]?.scope, 'profile');
});

test('createTaxonomyProfile REJECTS shadowing of built-in types (F3-AC3)', async () => {
  await assert.rejects(
    () => createTaxonomyProfile({
      slug: '__test-shadow',
      name: 'Shadow attempt',
      lesson_types: [{ type: 'decision', label: 'Decision' }],
      owner_project_id: TEST_PROJECT,
    }),
    /cannot shadow built-in/,
  );
});

test('createTaxonomyProfile rejects duplicate types within profile', async () => {
  await assert.rejects(
    () => createTaxonomyProfile({
      slug: '__test-dup',
      name: 'Duplicate types',
      lesson_types: [
        { type: 'zztest-dup', label: 'A' },
        { type: 'zztest-dup', label: 'A2' },
      ],
      owner_project_id: TEST_PROJECT,
    }),
    /duplicate type/,
  );
});

test('upsertBuiltinProfile is idempotent', async () => {
  await upsertBuiltinProfile({
    slug: '__test-builtin',
    name: 'Built-in test',
    lesson_types: [{ type: 'zztest-bta', label: 'A' }],
  });
  await upsertBuiltinProfile({
    slug: '__test-builtin',
    name: 'Built-in test v2',
    lesson_types: [{ type: 'zztest-bta', label: 'A' }, { type: 'zztest-btb', label: 'B' }],
  });
  const p = await getTaxonomyProfileBySlug('__test-builtin', null);
  assert.ok(p);
  assert.equal(p!.name, 'Built-in test v2');
  assert.equal(p!.lesson_types.length, 2);
});

test('activateProfile + getActiveProfile + deactivateProfile (F3-AC2)', async () => {
  await createTaxonomyProfile({
    slug: '__test-active',
    name: 'Active test',
    lesson_types: [{ type: 'zztest-active', label: 'AT' }],
    owner_project_id: TEST_PROJECT,
  });
  const before = await getActiveProfile(TEST_PROJECT);
  assert.equal(before, null);

  const r = await activateProfile({ project_id: TEST_PROJECT, slug: '__test-active', activated_by: 'tester' });
  assert.equal(r.status, 'activated');
  const after = await getActiveProfile(TEST_PROJECT);
  assert.ok(after);
  assert.equal(after!.slug, '__test-active');

  const d = await deactivateProfile(TEST_PROJECT);
  assert.equal(d.status, 'deactivated');
  const final = await getActiveProfile(TEST_PROJECT);
  assert.equal(final, null);

  // Idempotent: re-deactivate yields no_active_profile
  const d2 = await deactivateProfile(TEST_PROJECT);
  assert.equal(d2.status, 'no_active_profile');
});

test('activateProfile rejects unknown slug', async () => {
  const r = await activateProfile({ project_id: TEST_PROJECT, slug: '__nonexistent', activated_by: 'tester' });
  assert.equal(r.status, 'profile_not_found');
});

test('activateProfile cannot activate another project\'s custom profile', async () => {
  await createTaxonomyProfile({
    slug: '__test-private',
    name: 'Owned by B',
    lesson_types: [{ type: 'zztest-bt', label: 'B-T' }],
    owner_project_id: TEST_PROJECT_B,
  });
  // Project A tries to activate B's profile by slug — should fail (not in their scope)
  const r = await activateProfile({ project_id: TEST_PROJECT, slug: '__test-private', activated_by: 'tester' });
  assert.equal(r.status, 'profile_not_found');
});

test('getValidLessonTypes returns built-ins when no active profile (F3-AC1 baseline)', async () => {
  const types = await getValidLessonTypes(TEST_PROJECT);
  // Should include the 5 built-ins
  for (const b of ['decision', 'preference', 'guardrail', 'workaround', 'general_note']) {
    assert.ok(types.includes(b), `expected built-in '${b}'`);
  }
  // A profile-scoped test type that nothing created should not be present.
  assert.equal(types.includes('zztest-neverexists'), false);
});

test('getValidLessonTypes includes active profile types additively (F3-AC2)', async () => {
  await createTaxonomyProfile({
    slug: '__test-valid',
    name: 'Valid test',
    lesson_types: [{ type: 'zztest-pt1', label: 'PT1' }, { type: 'zztest-pt2', label: 'PT2' }],
    owner_project_id: TEST_PROJECT,
  });
  await activateProfile({ project_id: TEST_PROJECT, slug: '__test-valid' });
  const types = await getValidLessonTypes(TEST_PROJECT);
  assert.ok(types.includes('decision'), 'built-ins still present');
  assert.ok(types.includes('zztest-pt1'), 'profile type pt1 present');
  assert.ok(types.includes('zztest-pt2'), 'profile type pt2 present');
});

test('BUG-13.5-1: a global custom lesson type (Phase 8 path) is valid for any project', async () => {
  // Reproduces BUG-13.5-1: pre-fix, getValidLessonTypes ignored the lesson_types
  // table, so a custom type created via createLessonType was rejected by add_lesson.
  await createLessonType({ type_key: 'zztest-bug131', display_name: 'Bug 13.5-1 type' });
  const types = await getValidLessonTypes(TEST_PROJECT);
  assert.ok(types.includes('zztest-bug131'), 'global custom type must be a valid lesson_type');
  await assert.doesNotReject(() => validateLessonType(TEST_PROJECT, 'zztest-bug131'));
});

test('validateLessonType throws for unknown type (F3-AC1)', async () => {
  await assert.rejects(
    () => validateLessonType(TEST_PROJECT, 'unknown-xyz'),
    /Invalid lesson_type/,
  );
});

test('validateLessonType accepts built-in', async () => {
  await assert.doesNotReject(() => validateLessonType(TEST_PROJECT, 'decision'));
});

test('listTaxonomyProfiles filters by owner_project_id', async () => {
  await createTaxonomyProfile({
    slug: '__test-list-a', name: 'list a',
    lesson_types: [{ type: 'zztest-la', label: 'LA' }],
    owner_project_id: TEST_PROJECT,
  });
  await createTaxonomyProfile({
    slug: '__test-list-b', name: 'list b',
    lesson_types: [{ type: 'zztest-lb', label: 'LB' }],
    owner_project_id: TEST_PROJECT_B,
  });

  const onlyA = await listTaxonomyProfiles({ owner_project_id: TEST_PROJECT });
  const slugsA = onlyA.map((p) => p.slug);
  assert.ok(slugsA.includes('__test-list-a'));
  assert.equal(slugsA.includes('__test-list-b'), false);

  const builtinsOnly = await listTaxonomyProfiles({ owner_project_id: null, is_builtin: true });
  // Shouldn't include our test profiles (they're not built-ins)
  assert.equal(builtinsOnly.find((p) => p.slug === '__test-list-a'), undefined);
});
