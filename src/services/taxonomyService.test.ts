/**
 * Phase 13 Sprint 13.5 — taxonomyService unit tests.
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { randomUUID } from 'node:crypto';

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
import { getDbPool } from '../db/client.js';

const TEST_PROJECT = '__test_taxonomy__';
const TEST_PROJECT_B = '__test_taxonomy_B__';

async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM project_taxonomy_profiles WHERE project_id IN ($1, $2)`, [TEST_PROJECT, TEST_PROJECT_B]);
  await pool.query(`DELETE FROM taxonomy_profiles WHERE owner_project_id IN ($1, $2)`, [TEST_PROJECT, TEST_PROJECT_B]);
  await pool.query(`DELETE FROM taxonomy_profiles WHERE slug LIKE '__test%'`);
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
});

test('createTaxonomyProfile happy path (custom profile)', async () => {
  const p = await createTaxonomyProfile({
    slug: '__test-prof-1',
    name: 'Test Profile 1',
    lesson_types: [
      { type: 'custom-type-a', label: 'Custom A' },
      { type: 'custom-type-b', label: 'Custom B' },
    ],
    owner_project_id: TEST_PROJECT,
  });
  assert.equal(p.slug, '__test-prof-1');
  assert.equal(p.is_builtin, false);
  assert.equal(p.owner_project_id, TEST_PROJECT);
  assert.equal(p.lesson_types.length, 2);
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
        { type: 'a', label: 'A' },
        { type: 'a', label: 'A2' },
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
    lesson_types: [{ type: 'bt-a', label: 'A' }],
  });
  await upsertBuiltinProfile({
    slug: '__test-builtin',
    name: 'Built-in test v2',
    lesson_types: [{ type: 'bt-a', label: 'A' }, { type: 'bt-b', label: 'B' }],
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
    lesson_types: [{ type: 'active-t', label: 'AT' }],
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
    lesson_types: [{ type: 'b-t', label: 'B-T' }],
    owner_project_id: TEST_PROJECT_B,
  });
  // Project A tries to activate B's profile by slug — should fail (not in their scope)
  const r = await activateProfile({ project_id: TEST_PROJECT, slug: '__test-private', activated_by: 'tester' });
  assert.equal(r.status, 'profile_not_found');
});

test('getValidLessonTypes returns built-ins only when no active profile (F3-AC1 baseline)', async () => {
  const types = await getValidLessonTypes(TEST_PROJECT);
  // Should include the 5 built-ins
  assert.ok(types.includes('decision'));
  assert.ok(types.includes('preference'));
  assert.ok(types.includes('guardrail'));
  assert.ok(types.includes('workaround'));
  assert.ok(types.includes('general_note'));
  // None of our test types should be in there
  assert.equal(types.includes('custom-type-a'), false);
});

test('getValidLessonTypes includes active profile types additively (F3-AC2)', async () => {
  await createTaxonomyProfile({
    slug: '__test-valid',
    name: 'Valid test',
    lesson_types: [{ type: 'profile-t1', label: 'PT1' }, { type: 'profile-t2', label: 'PT2' }],
    owner_project_id: TEST_PROJECT,
  });
  await activateProfile({ project_id: TEST_PROJECT, slug: '__test-valid' });
  const types = await getValidLessonTypes(TEST_PROJECT);
  // built-ins still present
  assert.ok(types.includes('decision'));
  // profile types also present
  assert.ok(types.includes('profile-t1'));
  assert.ok(types.includes('profile-t2'));
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
    lesson_types: [{ type: 'la', label: 'LA' }],
    owner_project_id: TEST_PROJECT,
  });
  await createTaxonomyProfile({
    slug: '__test-list-b', name: 'list b',
    lesson_types: [{ type: 'lb', label: 'LB' }],
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
