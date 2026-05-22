/**
 * DEFERRED-008 — lesson_types.scope round-trips through the exchange path.
 *
 * Verifies the export SELECT carries `scope`, the import INSERT/UPDATE persists it,
 * and a pre-fix bundle (no `scope` field) defaults to 'global' (prior behavior).
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { mkdtempSync, rmSync, createWriteStream, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { exportProject } from './exportProject.js';
import { importProject } from './importProject.js';
import { encodeBundle, openBundle, type BundleData } from './bundleFormat.js';
import { getDbPool } from '../../db/client.js';

const PROJ = '__test_d008__';
const PROJ_TARGET = '__test_d008_target__'; // DEFERRED-023 import target
const PROFILE_TYPE = '__test_d008_profile_type';
const GLOBAL_TYPE = '__test_d008_global_type';
const NOSCOPE_TYPE = '__test_d008_noscope_type';

let tmpDir: string;

async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM lesson_types WHERE type_key = ANY($1::text[])`,
    [[PROFILE_TYPE, GLOBAL_TYPE, NOSCOPE_TYPE]]);
  for (const p of [PROJ, PROJ_TARGET]) {
    await pool.query(`DELETE FROM taxonomy_profiles WHERE owner_project_id = $1`, [p]);
    await pool.query(`DELETE FROM lessons WHERE project_id = $1`, [p]);
    await pool.query(`DELETE FROM guardrails WHERE project_id = $1`, [p]);
    await pool.query(`DELETE FROM projects WHERE project_id = $1`, [p]);
  }
}

before(() => { tmpDir = mkdtempSync(path.join(os.tmpdir(), 'd008-')); });
after(async () => { rmSync(tmpDir, { recursive: true, force: true }); await cleanup(); });
beforeEach(cleanup);

async function exportToFile(): Promise<string> {
  const file = path.join(tmpDir, `export-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
  const ws = createWriteStream(file);
  await exportProject({ projectId: PROJ }, ws);
  await once(ws, 'finish').catch(() => {}); // exportProject ends the stream
  return file;
}

async function encodeToFile(data: BundleData): Promise<string> {
  const file = path.join(tmpDir, `bundle-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
  const chunks: Buffer[] = [];
  const sink = new PassThrough();
  sink.on('data', (c: Buffer) => chunks.push(c));
  const done = once(sink, 'end');
  await encodeBundle(data, sink);
  sink.end();
  await done;
  writeFileSync(file, Buffer.concat(chunks));
  return file;
}

test('DEFERRED-008 AC1: exportProject lesson_types JSONL carries scope', async () => {
  const pool = getDbPool();
  await pool.query(`INSERT INTO projects (project_id, name) VALUES ($1, 'D008')`, [PROJ]);
  await pool.query(
    `INSERT INTO lesson_types (type_key, display_name, scope, is_builtin) VALUES ($1, 'Profile Type', 'profile', false)`,
    [PROFILE_TYPE],
  );

  const file = await exportToFile();
  const reader = await openBundle(file);
  try {
    const rows: any[] = [];
    for await (const lt of reader.lesson_types()) rows.push(lt);
    const profileRow = rows.find((r) => r.type_key === PROFILE_TYPE);
    assert.ok(profileRow, 'exported bundle includes the profile type');
    assert.equal(profileRow.scope, 'profile', 'export SELECT carries scope (not dropped)');
  } finally {
    await reader.close();
  }
});

test('DEFERRED-008 AC4: a scope=profile type round-trips as profile (import create path)', async () => {
  const pool = getDbPool();
  // import a hand-built bundle whose lesson_types row carries scope='profile'
  const bundle = await encodeToFile({
    project: { project_id: PROJ, name: 'D008', description: null },
    lessons: [],
    guardrails: [],
    lesson_types: [
      { type_key: PROFILE_TYPE, display_name: 'Profile Type', description: null, color: '#888888', template: null, is_builtin: false, scope: 'profile', created_at: null },
    ],
  });
  const res = await importProject({ targetProjectId: PROJ, bundlePath: bundle, policy: 'overwrite' });
  assert.equal(res.counts.lesson_types.created, 1);

  const r = await pool.query<{ scope: string }>(`SELECT scope FROM lesson_types WHERE type_key=$1`, [PROFILE_TYPE]);
  assert.equal(r.rows[0].scope, 'profile', 'imported type preserves scope=profile (no silent global)');
});

test('DEFERRED-008 AC4: a scope=global type round-trips as global', async () => {
  const pool = getDbPool();
  const bundle = await encodeToFile({
    project: { project_id: PROJ, name: 'D008', description: null },
    lessons: [], guardrails: [],
    lesson_types: [
      { type_key: GLOBAL_TYPE, display_name: 'Global Type', description: null, color: '#888888', template: null, is_builtin: false, scope: 'global', created_at: null },
    ],
  });
  await importProject({ targetProjectId: PROJ, bundlePath: bundle, policy: 'overwrite' });
  const r = await pool.query<{ scope: string }>(`SELECT scope FROM lesson_types WHERE type_key=$1`, [GLOBAL_TYPE]);
  assert.equal(r.rows[0].scope, 'global');
});

test('DEFERRED-008 AC5: a pre-fix bundle row (no scope field) defaults to global', async () => {
  const pool = getDbPool();
  const bundle = await encodeToFile({
    project: { project_id: PROJ, name: 'D008', description: null },
    lessons: [], guardrails: [],
    lesson_types: [
      // NO `scope` field — simulates a bundle produced before the DEFERRED-008 fix
      { type_key: NOSCOPE_TYPE, display_name: 'Legacy Type', description: null, color: '#888888', template: null, is_builtin: false, created_at: null },
    ],
  });
  await importProject({ targetProjectId: PROJ, bundlePath: bundle, policy: 'overwrite' });
  const r = await pool.query<{ scope: string }>(`SELECT scope FROM lesson_types WHERE type_key=$1`, [NOSCOPE_TYPE]);
  assert.equal(r.rows[0].scope, 'global', 'pre-fix bundle defaults to global (no regression, no CHECK violation)');
});

// ── DEFERRED-023: taxonomy_profiles bundle round-trip ───────────────────────

test('DEFERRED-023: a project-owned taxonomy profile is exported in the bundle', async () => {
  const pool = getDbPool();
  await pool.query(`INSERT INTO projects (project_id, name) VALUES ($1,'D008') ON CONFLICT DO NOTHING`, [PROJ]);
  await pool.query(
    `INSERT INTO taxonomy_profiles (slug, name, description, version, lesson_types, is_builtin, owner_project_id)
     VALUES ('custom-prof','Custom','d','2.0','[{"type_key":"rfc"}]'::jsonb, false, $1)`,
    [PROJ],
  );

  const file = await exportToFile();
  const reader = await openBundle(file);
  try {
    const rows: any[] = [];
    for await (const p of reader.taxonomy_profiles()) rows.push(p);
    const prof = rows.find((r) => r.slug === 'custom-prof');
    assert.ok(prof, 'exported bundle includes the project-owned profile');
    assert.equal(prof.version, '2.0');
    assert.equal(prof.is_builtin, false);
    // owner_project_id is NOT carried in the row (rebound on import) — but lesson_types are
    assert.deepEqual(prof.lesson_types, [{ type_key: 'rfc' }]);
  } finally {
    await reader.close();
  }
});

test('DEFERRED-023: a taxonomy profile round-trips into a fresh target, owner rebound', async () => {
  const pool = getDbPool();
  const bundle = await encodeToFile({
    project: { project_id: PROJ, name: 'D008', description: null },
    lessons: [], guardrails: [],
    taxonomy_profiles: [
      { slug: 'imported-prof', name: 'Imported', description: null, version: '1.5', lesson_types: [{ type_key: 'decision' }], is_builtin: false, created_at: null, updated_at: null },
    ],
  });
  const res = await importProject({ targetProjectId: PROJ_TARGET, bundlePath: bundle, policy: 'overwrite' });
  assert.equal(res.counts.taxonomy_profiles.created, 1);

  const r = await pool.query<{ owner_project_id: string; version: string; is_builtin: boolean }>(
    `SELECT owner_project_id, version, is_builtin FROM taxonomy_profiles WHERE slug='imported-prof' AND owner_project_id=$1`,
    [PROJ_TARGET],
  );
  assert.equal(r.rowCount, 1, 'profile imported under the TARGET project (owner rebound)');
  assert.equal(r.rows[0].version, '1.5');
  assert.equal(r.rows[0].is_builtin, false);
});

test('DEFERRED-023: importing a built-in profile over an existing built-in is refused (overwrite)', async () => {
  const pool = getDbPool();
  // seed a built-in profile in the target
  await pool.query(`INSERT INTO projects (project_id, name) VALUES ($1,'T') ON CONFLICT DO NOTHING`, [PROJ_TARGET]);
  await pool.query(
    `INSERT INTO taxonomy_profiles (slug, name, lesson_types, is_builtin, owner_project_id)
     VALUES ('builtin-prof','B','[]'::jsonb, true, $1)`,
    [PROJ_TARGET],
  );
  const bundle = await encodeToFile({
    project: { project_id: PROJ, name: 'D008', description: null },
    lessons: [], guardrails: [],
    taxonomy_profiles: [
      { slug: 'builtin-prof', name: 'Hacked', description: null, version: '9', lesson_types: [], is_builtin: false, created_at: null, updated_at: null },
    ],
  });
  const res = await importProject({ targetProjectId: PROJ_TARGET, bundlePath: bundle, policy: 'overwrite' });
  assert.equal(res.counts.taxonomy_profiles.skipped, 1, 'built-in overwrite refused');
  const r = await pool.query<{ name: string }>(`SELECT name FROM taxonomy_profiles WHERE slug='builtin-prof' AND owner_project_id=$1`, [PROJ_TARGET]);
  assert.equal(r.rows[0].name, 'B', 'built-in profile untouched');
});

test('DEFERRED-023: a pre-fix bundle without taxonomy_profiles imports cleanly (backward compat)', async () => {
  const bundle = await encodeToFile({
    project: { project_id: PROJ, name: 'D008', description: null },
    lessons: [], guardrails: [],
    // no taxonomy_profiles entry at all
  });
  const res = await importProject({ targetProjectId: PROJ_TARGET, bundlePath: bundle, policy: 'overwrite' });
  assert.equal(res.counts.taxonomy_profiles.total, 0, 'missing entry → 0 profiles, no error');
});
